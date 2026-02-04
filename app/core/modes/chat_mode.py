"""
Chat Mode - простой режим для чата без ReAct loop

Использует native function calling (один запрос к LLM с инструментами).
Оптимизирован для быстрых ответов без множественных итераций.
"""
import asyncio
import json
import re
from typing import AsyncGenerator, List, Dict, Any
from loguru import logger
from app.core.modes.base import BaseMode


# Системные правила для чата (профессиональный стиль)
CHAT_SYSTEM_RULES = """
ПРАВИЛА:
1. Профессиональный тон - без emoji, чётко и по делу.
2. Используй инструменты когда нужны данные (tasks_list, task_detail, servers_list).
3. Форматируй ответы в markdown - таблицы, списки, badges.
4. Один вызов инструмента на запрос - эффективность важна.
5. Ссылки на задачи: [#ID](task:ID) для модального окна.
6. Используй badges: [STATUS] [PRIORITY] для визуальной структуры.
"""


class ChatMode(BaseMode):
    """
    Простой режим чата - один вызов LLM с инструментами.

    В отличие от ReAct:
    - Нет итераций (максимум 1-2 вызова инструментов)
    - Быстрый ответ
    - Оптимизирован для простых запросов
    """

    @property
    def description(self) -> str:
        return "Простой чат с инструментами (без ReAct loop)"

    async def execute(
        self,
        message: str,
        model_preference: str = None,
        use_rag: bool = True,
        specific_model: str = None,
        user_id: int = None,
        initial_history: List[Dict[str, str]] = None,
        execution_context: Dict[str, Any] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Выполнение в простом режиме чата
        """
        effective_history = list(initial_history) if initial_history else list(self.orchestrator.history)
        effective_history.append({"role": "user", "content": message})
        if not initial_history:
            self.orchestrator.history.append({"role": "user", "content": message})

        # Limit history
        if len(effective_history) > 10:
            effective_history = effective_history[-10:]
        if not initial_history and len(self.orchestrator.history) > 10:
            self.orchestrator.history = self.orchestrator.history[-10:]

        # RAG context (опционально)
        rag_context = ""
        if use_rag and self.orchestrator.rag.available and user_id is not None:
            try:
                results = await asyncio.to_thread(
                    self.orchestrator.rag.query, message, 2, user_id
                )
                if results.get('documents') and results['documents'][0]:
                    docs = results['documents'][0]
                    if docs:
                        rag_context = "\n".join(docs[:2])  # Только 2 документа для скорости
            except Exception as e:
                logger.warning(f"RAG query failed: {e}")

        # Build prompt
        system_prompt = self._build_chat_prompt(
            user_message=message,
            rag_context=rag_context,
            history=effective_history,
            execution_context=execution_context,
        )

        # Первый запрос к LLM
        llm_response = ""
        async for chunk in self.orchestrator.llm.stream_chat(
            system_prompt,
            model=model_preference,
            specific_model=specific_model
        ):
            llm_response += chunk

        # Проверяем нужен ли вызов инструмента
        action_match = self.orchestrator._parse_action(llm_response)

        if action_match:
            # Выполняем инструмент
            tool_name = action_match['tool']
            tool_args = action_match['args']

            try:
                ctx = (execution_context or {}).copy()
                tool_context = {"user_id": ctx.get("user_id")} if ctx.get("user_id") else None
                if ctx.get("master_password") and tool_context:
                    tool_context["master_password"] = ctx.get("master_password")

                result = await self.orchestrator.tool_manager.execute_tool(
                    tool_name, _context=tool_context, **tool_args
                )

                result_str = self.orchestrator._format_tool_result(result)

                # Формируем финальный ответ с данными инструмента
                final_prompt = self._build_final_prompt(
                    user_message=message,
                    tool_name=tool_name,
                    tool_result=result_str,
                    execution_context=execution_context,
                )

                final_response = ""
                async for chunk in self.orchestrator.llm.stream_chat(
                    final_prompt,
                    model=model_preference,
                    specific_model=specific_model
                ):
                    final_response += chunk

                # Post-process: конвертируем #ID в кликабельные ссылки
                if tool_name in ("tasks_list", "task_detail"):
                    import re
                    # Паттерн: #число (не внутри ссылки)
                    def make_link(m):
                        task_id = m.group(1)
                        return f"**[#{task_id}](task:{task_id})**"
                    final_response = re.sub(r'(?<!\[)#(\d+)(?!\])', make_link, final_response)

                yield final_response

            except Exception as e:
                error_msg = f"❌ Ошибка: {str(e)}"
                yield error_msg
                logger.error(f"Tool execution failed: {e}")
                final_response = error_msg
        else:
            # Нет действия - просто отдаём ответ
            final_response = llm_response
            yield final_response

        # Add to history
        effective_history.append({"role": "assistant", "content": final_response})
        if not initial_history:
            self.orchestrator.history.append({"role": "assistant", "content": final_response})

    def _build_chat_prompt(
        self,
        user_message: str,
        rag_context: str,
        history: List[Dict[str, str]],
        execution_context: Dict[str, Any] = None,
    ) -> str:
        """Построить промпт для чата"""

        # История (компактная)
        history_text = ""
        if len(history) > 1:
            recent = history[-4:]  # Последние 4 сообщения
            history_text = "\n".join([
                f"{msg['role'].upper()}: {msg['content'][:150]}"
                for msg in recent[:-1]
            ])

        # Инструменты
        tools_description = self.orchestrator.tool_manager.get_tools_description()

        # Контекст пользователя
        user_ctx = ""
        if execution_context:
            user_id = execution_context.get("user_id")
            if user_id:
                user_ctx = f"User ID: {user_id}"

        prompt = f"""Ты WEU Assistant — умный помощник в чате.
{CHAT_SYSTEM_RULES}

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
{tools_description}

{f"КОНТЕКСТ: {user_ctx}" if user_ctx else ""}
{f"ИСТОРИЯ: {history_text}" if history_text else ""}
{f"БАЗА ЗНАНИЙ: {rag_context}" if rag_context else ""}

ФОРМАТ ОТВЕТА:
- Если нужны данные, напиши ОДНУ строку:
ACTION: tool_name {{"param": "value"}}
- Если данные не нужны, сразу отвечай пользователю.

ЗАПРОС: {user_message}

Твой ответ:"""
        return prompt

    def _build_final_prompt(
        self,
        user_message: str,
        tool_name: str,
        tool_result: str,
        execution_context: Dict[str, Any] = None,
    ) -> str:
        """Построить финальный промпт с данными инструмента"""

        # Форматирование для задач
        format_instructions = ""
        if tool_name in ("tasks_list", "task_detail"):
            # Подсчитаем количество задач в JSON для верификации
            tasks_count_info = ""
            try:
                import json
                result_data = json.loads(tool_result)
                tasks_count = len(result_data.get('tasks', []))
                tasks_count_info = f"ВНИМАНИЕ: JSON содержит {tasks_count} задач(и). ВЫВЕДИ ВСЕ {tasks_count} задач(и)!\n\n"
            except:
                pass

            format_instructions = f"""{tasks_count_info}ШАБЛОН ВЫВОДА (СТРОГО КОПИРУЙ):

КАЖДАЯ строка задачи ОБЯЗАТЕЛЬНО в формате:
- **[#ID](task:ID)** Title — [STATUS] [PRIORITY] assignee

ПРИМЕР ПРАВИЛЬНОГО ВЫВОДА:
---
Overview: 3 total tasks (3 active, 0 completed)

### [TODO] (2 tasks)
- **[#15](task:15)** Deploy Redis cluster — [TODO] [MEDIUM] (unassigned)
- **[#12](task:12)** Setup monitoring — [TODO] [HIGH] @admin

### [IN_PROGRESS] (1 task)
- **[#8](task:8)** Fix authentication bug — [IN PROGRESS] [HIGH] @developer
---

ЗАПРЕЩЕНО писать так:
❌ #15 Deploy Redis — [TODO] [MEDIUM]
❌ 15. Deploy Redis — [TODO] [MEDIUM]

ОБЯЗАТЕЛЬНО писать так:
✅ **[#15](task:15)** Deploy Redis — [TODO] [MEDIUM] (unassigned)

НЕ пропускай ни одну задачу из JSON!
"""

        prompt = f"""Ты получил данные от инструмента {tool_name}. Отформатируй их для пользователя.

ЗАПРОС: {user_message}

JSON ДАННЫЕ:
{tool_result}

{format_instructions}

ИНСТРУКЦИЯ - ДЕЛАЙ ТОЧНО ТАК:
1. Прочитай JSON - там список задач в массиве "tasks"
2. ДЛЯ КАЖДОЙ задачи напиши строку В ТОЧНОСТИ так:
   - **[#ID](task:ID)** Title — [STATUS] [PRIORITY] assignee

3. Пример ПРАВИЛЬНОЙ строки (копируй этот формат):
   - **[#15](task:15)** Deploy Redis — [TODO] [MEDIUM] (unassigned)

4. НЕ пиши просто "#15" - это НЕПРАВИЛЬНО
5. ОБЯЗАТЕЛЬНО используй формат **[#ID](task:ID)**

Начинай ответ с "Overview: X total tasks..."
Группируй по статусам: ### [TODO], ### [IN_PROGRESS]
Отвечай на русском, без emoji.

НАЧИНАЙ ОТВЕТ:"""
        return prompt
