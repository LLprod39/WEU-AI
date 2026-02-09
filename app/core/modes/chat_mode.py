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
from app.core.task_board import build_task_board_payload


# Системные правила для чата (профессиональный стиль)
CHAT_SYSTEM_RULES = """
ПРАВИЛА:
1. Профессиональный тон - без emoji, чётко и по делу.
2. Для задач используй инструменты: tasks_list, task_detail, task_create, task_update, task_delete.
3. Форматируй ответы в markdown - таблицы, списки, badges.
4. Один вызов инструмента на запрос - эффективность важна.
5. Ссылки на задачи: [#ID](task:ID) для модального окна.
6. Используй badges: [STATUS] [PRIORITY] для визуальной структуры.
7. Если вопрос про срочность/сроки — вызывай tasks_list с sort_by="urgency", include_completed=false.
8. Удаляй задачу через task_delete только при явном запросе пользователя и с confirm=true.
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

        # Follow-up "покажи ещё задачи" — детерминированная пагинация из последнего task payload
        followup_payload = self._extract_last_task_payload(effective_history[:-1])
        if self._is_more_tasks_request(message) and followup_payload:
            summary = followup_payload.get("summary") or {}
            source_tool = followup_payload.get("source_tool")
            if source_tool == "tasks_list" and summary.get("has_more"):
                query_params = (followup_payload.get("query_params") or {}).copy()
                try:
                    prev_offset = int(summary.get("offset") or 0)
                except (TypeError, ValueError):
                    prev_offset = 0
                try:
                    prev_returned = int(summary.get("returned") or 0)
                except (TypeError, ValueError):
                    prev_returned = 0
                query_params["offset"] = prev_offset + prev_returned
                try:
                    query_params["limit"] = int(summary.get("limit") or 20)
                except (TypeError, ValueError):
                    query_params["limit"] = 20
                ctx = (execution_context or {}).copy()
                tool_context = {"user_id": ctx.get("user_id")} if ctx.get("user_id") else None
                if tool_context:
                    result = await self.orchestrator.tool_manager.execute_tool(
                        "tasks_list", _context=tool_context, **query_params
                    )
                    result_str = self.orchestrator._format_tool_result(result)
                    task_payload = build_task_board_payload("tasks_list", result_str, query=message)
                    if task_payload:
                        final_response = "WEU_TASKS_JSON:" + json.dumps(
                            task_payload,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )
                        yield final_response
                        effective_history.append({"role": "assistant", "content": final_response})
                        if not initial_history:
                            self.orchestrator.history.append({"role": "assistant", "content": final_response})
                        return

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

                # Для запросов-списков отдаём детерминированный JSON payload (для UI-парсинга карточек)
                if tool_name == "tasks_list" and self._is_task_list_request(message):
                    task_payload = build_task_board_payload(tool_name, result_str, query=message)
                    if task_payload:
                        final_response = "WEU_TASKS_JSON:" + json.dumps(
                            task_payload,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )
                        yield final_response
                        effective_history.append({"role": "assistant", "content": final_response})
                        if not initial_history:
                            self.orchestrator.history.append({"role": "assistant", "content": final_response})
                        return

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

    @staticmethod
    def _is_more_tasks_request(message: str) -> bool:
        text = (message or "").strip().lower()
        if not text:
            return False
        return bool(
            re.search(r"\b(еще|ещё|дальше|следующ|another|more)\b", text)
        )

    @staticmethod
    def _is_task_list_request(message: str) -> bool:
        text = (message or "").strip().lower()
        if not text:
            return False
        patterns = [
            r"сводк",
            r"\bкакие\b",
            r"покажи",
            r"список",
            r"активн(ые|ых)?",
            r"просроч",
            r"срок(и|ах)?",
            r"дедлайн",
            r"есть задачи",
            r"что по задачам",
        ]
        return any(re.search(p, text) for p in patterns)

    @staticmethod
    def _extract_last_task_payload(history: List[Dict[str, str]]) -> Dict[str, Any]:
        for msg in reversed(history or []):
            if msg.get("role") != "assistant":
                continue
            content = msg.get("content") or ""
            if "WEU_TASKS_JSON:" not in content:
                continue
            for line in reversed(content.splitlines()):
                line = line.strip()
                if not line.startswith("WEU_TASKS_JSON:"):
                    continue
                raw = line[len("WEU_TASKS_JSON:"):].strip()
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and payload.get("type") == "task_board":
                    return payload
        return {}

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
        task_ctx = ""
        skill_ctx = ""
        if execution_context:
            user_id = execution_context.get("user_id")
            if user_id:
                user_ctx = f"User ID: {user_id}"
            if execution_context.get("skill_context"):
                skill_ctx = str(execution_context.get("skill_context")).strip()
            tc = execution_context.get("task_context")
            if isinstance(tc, dict) and tc.get("id"):
                task_ctx = (
                    f"Текущая задача в контексте: {tc.get('title') or ''} "
                    f"(status={tc.get('status') or ''}, due_date={tc.get('due_date') or '—'}).\n"
                    f"Описание: {tc.get('description') or '—'}\n"
                    "Если пользователь спрашивает «эту/ту задачу», отвечай про эту задачу. "
                    "Не делай сводку всех задач, если не просили список."
                )

        prompt = f"""Ты WEU Assistant — умный помощник в чате.
{CHAT_SYSTEM_RULES}

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
{tools_description}

{f"КОНТЕКСТ: {user_ctx}" if user_ctx else ""}
{f"КОНТЕКСТ ЗАДАЧИ: {task_ctx}" if task_ctx else ""}
{f"SKILLS КОНТЕКСТ: {skill_ctx}" if skill_ctx else ""}
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

        if tool_name == "tasks_list":
            if self._is_task_list_request(user_message):
                return f"""Ты получил данные от инструмента tasks_list.

ЗАПРОС: {user_message}
JSON:
{tool_result}

Сделай краткую сводку:
1. Первая строка: «Сводка: всего N задач (активных: X, завершённых: Y)».
2. Затем блоки по статусам (TODO, IN_PROGRESS, BLOCKED, DONE, CANCELLED) только если там есть задачи.
3. В каждой строке задачи: название, приоритет, исполнитель, срок.
4. Русский язык, без emoji, без выдумок.
"""
            return f"""Ты получил данные от инструмента tasks_list.

ЗАПРОС: {user_message}
JSON:
{tool_result}

Ответь по сути вопроса пользователя, используя данные задач.
Если задач несколько и запрос про одну задачу неочевиден — выбери самую релевантную (обычно IN_PROGRESS, иначе ближайший срок) и явно укажи, какую выбрал.
Дай практический ответ, а не сводку списком.
Русский язык, без emoji.
"""

        if tool_name == "task_detail":
            return f"""Ты получил данные от инструмента task_detail.

ЗАПРОС: {user_message}
JSON:
{tool_result}

Дай конкретный ответ по этой задаче:
1. Если пользователь спрашивает «как выполнить» — дай пошаговый план.
2. Учитывай статус, приоритет, срок и описание.
3. Если данных мало — сформулируй короткие уточняющие вопросы.
4. Не делай общую сводку всех задач.
Русский язык, без emoji.
"""

        return f"""Ты получил данные от инструмента {tool_name}. Отформатируй их для пользователя на русском.

ЗАПРОС: {user_message}
ДАННЫЕ:
{tool_result}
"""
