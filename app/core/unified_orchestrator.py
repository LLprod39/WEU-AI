"""
Unified Orchestrator - единый оркестратор с поддержкой нескольких режимов
"""
from typing import AsyncGenerator, List, Dict, Any, Optional
from loguru import logger
from app.core.llm import LLMProvider
from app.rag.engine import RAGEngine
from app.tools.manager import get_tool_manager
from app.core.model_config import model_manager
from app.core.modes import ReActMode, RalphInternalMode, ChatMode


# Инструкции и ограничения агента: язык и безопасность
AGENT_SYSTEM_RULES_RU = """
ЯЗЫК И ОБЩИЕ ПРАВИЛА:
- Отвечай и рассуждай только на русском. Все сообщения пользователю — на русском.
- Не запрашивай и не используй пароли. Для SSH используй только переданный connection_id уже установленного соединения или инструменты servers_list / server_execute для серверов из раздела Servers.

ДИАЛОГОВЫЙ ПРОТОКОЛ:
- Если задачи не хватает данных или есть неоднозначности — задай 1-2 конкретных вопроса, предложи разумные дефолты и остановись, не делай ACTION.
- Если задача большая или рискованная — кратко перечисли шаги и запроси подтверждение перед выполнением.
- Не выдумывай факты. Если нужно — скажи, что нужно уточнить.

КОД-СТАНДАРТ:
- Пиши код аккуратно: проверяй граничные случаи, избегай заглушек и TODO, если не оговорено.
- При изменении логики — предлагай проверку (тесты/линтеры) и описывай риск.
- Сохраняй текущие соглашения проекта (стиль, структура).

СЕРВЕРЫ ИЗ РАЗДЕЛА SERVERS (WEU SERVER и др.):
- Сначала вызови servers_list — получи список серверов (id, name, host).
- Чтобы выполнить команду на сервере по имени (например WEU SERVER), вызови server_execute с server_name_or_id="WEU SERVER" и command="df -h" (или другой командой).

РАЗРЕШЁННЫЕ ОПЕРАЦИИ НА СЕРВЕРЕ:
- Чтение и проверка: df, свободное место, логи, статус сервисов, списки файлов, чтение конфигов.
- Выполняй только безопасные команды проверки (например: df -h, du, tail логов, systemctl status).

ЗАПРЕЩЕНО БЕЗ ЯВНОГО ПОДТВЕРЖДЕНИЯ:
- Удаление файлов и каталогов (rm -rf, rm и т.п.), перезапись критичных путей.
- mkfs, разметка дисков, отключение/перезапуск системных сервисов.
- Любые действия, необратимо меняющие состояние сервера.

ЗАДАЧИ (РАЗДЕЛ TASKS):
- Для списка задач используй tool: tasks_list (фильтр по статусу, поиск по тексту).
- Для подробной карточки используй tool: task_detail (id).
- Если пользователь просит сводку/список — ОБЯЗАТЕЛЬНО вызови tasks_list.

ФОРМАТ ВЫВОДА ЗАДАЧ (строго соблюдай):
```
## Task Overview
**3 total tasks** — 1 active, 2 in progress, 0 completed

### TODO
| # | Task | Priority | Assignee |
|---|------|----------|----------|
| #15 | Deploy Redis | MEDIUM | — |

### IN PROGRESS
| # | Task | Priority | Assignee |
|---|------|----------|----------|
| #12 | Setup monitoring | HIGH | @admin |
```

ПРАВИЛА ФОРМАТИРОВАНИЯ:
- Заголовки с ## и ###
- Таблицы для списков задач
- Жирный текст для чисел: **3 total tasks**
- БЕЗ emoji, только текст
- Все данные из JSON включены
"""


class UnifiedOrchestrator:
    """
    Единый оркестратор поддерживающий несколько режимов:
    
    1. ReAct Loop - итеративное рассуждение с инструментами (Reason + Act)
    2. Ralph Internal - итеративное самосовершенствование (внутри Python)
    3. Ralph CLI - выполнение через внешний Ralph binary
    
    Автоматически выбирает режим на основе конфигурации или параметров
    """
    
    MODES = {
        "chat": ChatMode,  # простой чат без loop
        "react": ReActMode,
        "ralph_internal": RalphInternalMode,
        # "ralph_cli" removed - Ralph is not a CLI tool, use ralph_internal instead
        # For CLI agents (cursor/claude), use use_ralph_loop=True in config
        "ralph": RalphInternalMode,  # alias for backward compatibility
        "ralph_cli": RalphInternalMode,  # legacy alias
    }
    
    def __init__(self):
        self.llm = LLMProvider()
        self.rag = RAGEngine()
        self.tool_manager = get_tool_manager()
        self.history: List[Dict[str, str]] = []
        
        # Инициализация режимов
        self._modes = {}
        for mode_name, mode_class in self.MODES.items():
            self._modes[mode_name] = mode_class(self)
    
    async def initialize(self):
        """Initialize the orchestrator"""
        logger.info("Initializing UnifiedOrchestrator...")
        logger.success("UnifiedOrchestrator initialized")
    
    async def process_user_message(
        self,
        message: str,
        model_preference: str = None,
        use_rag: bool = True,
        specific_model: str = None,
        user_id: int = None,
        initial_history: List[Dict[str, str]] = None,
        execution_context: Dict[str, Any] = None,
        mode: str = None,
    ) -> AsyncGenerator[str, None]:
        """
        Process user message в выбранном режиме
        
        Args:
            message: Сообщение пользователя
            model_preference: Предпочтительная модель
            use_rag: Использовать RAG
            specific_model: Конкретная модель
            user_id: ID пользователя
            initial_history: История диалога
            execution_context: Контекст выполнения
            mode: Режим работы (react | ralph_internal | ralph_cli)
                  Если None, использует default_orchestrator_mode из конфига
        
        Yields:
            str: Chunks of response
        """
        # Resolve mode
        if mode is None:
            mode = model_manager.config.default_orchestrator_mode
        
        # Validate mode
        if mode not in self.MODES:
            logger.warning(f"Unknown mode '{mode}', falling back to ralph_internal")
            mode = "ralph_internal"
        
        logger.info(f"UnifiedOrchestrator: using mode '{mode}'")
        
        # Get mode handler
        mode_handler = self._modes[mode]
        
        # Нормализовать model_preference: заменить "auto"/None на default_provider
        if not model_preference or model_preference == "auto":
            model_preference = model_manager.config.default_provider or "cursor"
        
        # Execute in selected mode
        async for chunk in mode_handler.execute(
            message=message,
            model_preference=model_preference,
            use_rag=use_rag,
            specific_model=specific_model,
            user_id=user_id,
            initial_history=initial_history,
            execution_context=execution_context,
        ):
            yield chunk
    
    def _build_system_prompt(
        self,
        user_message: str,
        rag_context: str,
        iteration: int,
        history_override: List[Dict[str, str]] = None,
        execution_context: Dict[str, Any] = None,
    ) -> str:
        """
        Build system prompt (для ReAct mode)
        Использует логику из Orchestrator
        """
        # AGENT_SYSTEM_RULES_RU is now defined in this module
        
        history_source = history_override if history_override is not None else self.history
        
        history_text = ""
        if len(history_source) > 1:
            recent = history_source[-6:]
            history_lines = []
            for msg in recent[:-1]:
                content = msg['content']
                # OBSERVATION (результаты инструментов) - больше лимит для полных данных
                if msg['role'] == 'system' and content.startswith('OBSERVATION:'):
                    truncated = content[:3000]
                else:
                    truncated = content[:200]
                history_lines.append(f"{msg['role'].upper()}: {truncated}")
            history_text = "\n".join(history_lines)
        
        ctx_block = ""
        exclude_tools = None
        servers_block = ""
        
        if execution_context:
            conn_id = execution_context.get("connection_id")
            allowed = execution_context.get("allowed_actions", "")
            target_server = execution_context.get("server", {})
            include_servers = execution_context.get("include_servers", False)
            
            if conn_id:
                exclude_tools = ["ssh_connect", "servers_list", "server_execute"]
                server_name = target_server.get("name", "целевой сервер")
                server_host = target_server.get("host", "")
                server_info = f"{server_name} ({server_host})" if server_host else server_name
                
                ctx_block = f"""
КОНТЕКСТ ВЫПОЛНЕНИЯ ЗАДАЧИ:
- Уже установлено SSH-соединение с сервером: **{server_info}**
- Используй ТОЛЬКО инструмент ssh_execute с параметром conn_id="{conn_id}" для выполнения команд.
- НЕ вызывай ssh_connect, servers_list, server_execute — работай только с установленным соединением!
- Разрешённые действия: {allowed or "readonly, проверка (df, логи, статус)"}.
"""
                servers_block = ""
            elif include_servers:
                user_id = execution_context.get("user_id")
                if user_id:
                    servers_block = self._get_user_servers_block(user_id)
            
            workspace_path = execution_context.get("workspace_path")
            from_ide = execution_context.get("from_ide", False)
            if workspace_path:
                workspace_block = f"""
РАБОЧАЯ ДИРЕКТОРИЯ (WORKSPACE):
- Рабочая директория проекта: **{workspace_path}**
- Все пути к файлам указывай относительно этой директории
"""
                ctx_block = (ctx_block + "\n" + workspace_block).strip() if ctx_block else workspace_block.strip()
            
            if from_ide:
                ide_rule = """
РЕЖИМ IDE:
- НЕ выводи данные серверов (хосты, пароли, команды ssh). Фокусируйся только на коде.
"""
                ctx_block = (ctx_block + "\n" + ide_rule).strip() if ctx_block else ide_rule.strip()
                servers_block = ""
        
        tools_description = self.tool_manager.get_tools_description(exclude_tools=exclude_tools)
        
        prompt = f"""You are WEU Agent — интеллектуальный ассистент с доступом к инструментам.
{AGENT_SYSTEM_RULES_RU}
{ctx_block}
{servers_block}

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
{tools_description}

БАЗА ЗНАНИЙ:
{rag_context if rag_context else "Нет релевантного контекста."}

ИСТОРИЯ ДИАЛОГА:
{history_text if history_text else "Нет предыдущего контекста."}

ИНСТРУКЦИИ:
1. Рассуждай по шагам на русском и кратко фиксируй, что проверяешь.
2. Если не хватает данных — задай 1-2 вопроса и остановись, не вызывай инструменты.
3. Если нужен инструмент, в ответе строго в формате:
THOUGHT: [твоё рассуждение]
ACTION: tool_name {{"param1": "value1", "param2": "value2"}}
4. После OBSERVATION продолжай рассуждение или дай итоговый ответ на русском.
5. Итоговый ответ пиши без строки ACTION.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ: {user_message}

Твой ответ:"""
        return prompt
    
    def _get_user_servers_block(self, user_id: int) -> str:
        """Возвращает блок с серверами пользователя"""
        if not user_id:
            return ""
        try:
            from servers.models import Server
            servers = list(Server.objects.filter(user_id=user_id).values("id", "name", "host", "port", "username"))
            if not servers:
                return ""
            lines = ["\nТВОИ СЕРВЕРЫ (доступны через server_execute):"]
            for s in servers:
                lines.append(f"  - {s['name']} (id={s['id']}): {s['username']}@{s['host']}:{s['port']}")
            lines.append("")
            lines.append("Используй server_execute с server_name_or_id='<имя сервера>' и command='<команда>'.")
            return "\n".join(lines)
        except Exception as e:
            logger.warning(f"_get_user_servers_block error: {e}")
            return ""
    
    def _parse_action(self, response: str) -> dict:
        """
        Parse action from LLM response
        Returns: {"tool": "tool_name", "args": {dict}} or None
        """
        import re
        import json
        
        pattern = r'ACTION:\s*([\w\-.]+)\s*(\{.*?\})'
        match = re.search(pattern, response, re.DOTALL)
        
        if match:
            tool_name = match.group(1)
            args_str = match.group(2)
            
            try:
                args = json.loads(args_str)
                return {"tool": tool_name, "args": args}
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse action arguments: {e}")
                return None
        
        return None
    
    def _format_tool_result(self, result: Any) -> str:
        """Format tool execution result"""
        import json
        
        if isinstance(result, dict):
            return json.dumps(result, indent=2, ensure_ascii=False)
        elif isinstance(result, str):
            return result
        else:
            return str(result)
    
    def get_available_tools(self) -> List[Dict]:
        """Get list of all available tools"""
        return [tool.to_dict() for tool in self.tool_manager.get_all_tools()]
    
    def clear_history(self):
        """Clear conversation history"""
        self.history = []
        logger.info("Conversation history cleared")
    
    async def add_to_knowledge_base(self, text: str, source: str = "manual", user_id=None):
        """Add text to RAG knowledge base"""
        import asyncio
        
        if self.rag.available and user_id is not None:
            doc_id = await asyncio.to_thread(
                self.rag.add_text, text, source, user_id
            )
            logger.info(f"Added to knowledge base: {doc_id}")
            return doc_id
        else:
            logger.warning("RAG not available or user_id missing")
            return None
