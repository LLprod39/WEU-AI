"""
Enhanced Orchestrator with ReAct Loop and Full Tool Integration
Central brain of the agentic system
"""
from app.core.llm import LLMProvider
from app.rag.engine import RAGEngine
from app.tools.manager import get_tool_manager
from loguru import logger
import asyncio
import re
import json
from typing import AsyncGenerator, List, Dict, Any


# Инструкции и ограничения агента: язык и безопасность (одно место для переиспользования)
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
"""


class Orchestrator:
    """
    Central Orchestrator for the Agentic System.
    Implements ReAct (Reason + Act) pattern for intelligent task execution.
    
    Features:
    - Chat with RAG integration
    - Tool execution via ReAct loop
    - SSH operations
    - MCP server integration
    - Smart context management
    """
    
    def __init__(self):
        self.llm = LLMProvider()
        self.rag = RAGEngine()
        self.tool_manager = get_tool_manager()
        self.history: List[Dict[str, str]] = []
        self.max_iterations = 5  # Max ReAct loop iterations
        
    async def initialize(self):
        """
        Initialize the orchestrator and connect to external services
        """
        logger.info("Initializing Orchestrator...")
        
        # Example: Connect to MCP servers if needed
        # await self.tool_manager.connect_mcp_server_sse("filesystem", "http://localhost:8000/sse")
        
        logger.success("Orchestrator initialized")
    
    async def process_user_message(
        self,
        message: str,
        model_preference: str = None,
        use_rag: bool = True,
        specific_model: str = None,
        user_id=None,
        initial_history: List[Dict[str, str]] = None,
        execution_context: Dict[str, Any] = None,  # connection_id, allowed_actions и т.п. для делегированных задач
    ) -> AsyncGenerator[str, None]:
        """
        Process user message with full ReAct loop
        
        Flow:
        1. Retrieve context from RAG (if enabled)
        2. Enter ReAct loop:
           - Reason: LLM decides what to do
           - Act: Execute tool if needed
           - Observe: Get tool result
           - Repeat or Finish
        3. Stream final response
        
        If initial_history is provided, it is used for context instead of self.history
        and self.history is not mutated (для поточных запросов с chat_id).
        """
        effective_history = list(initial_history) if initial_history else list(self.history)
        effective_history.append({"role": "user", "content": message})
        if not initial_history:
            self.history.append({"role": "user", "content": message})
        
        # Resolve model preference
        if not model_preference:
            from app.core.model_config import model_manager
            model_preference = model_manager.config.default_provider
        
        # Limit history to last 10 messages (for prompt)
        if len(effective_history) > 10:
            effective_history = effective_history[-10:]
        if not initial_history and len(self.history) > 10:
            self.history = self.history[-10:]
        
        # Step 1: Retrieve RAG context (RAG.query — sync, вызываем в thread)
        rag_context = ""
        if use_rag and self.rag.available and user_id is not None:
            try:
                results = await asyncio.to_thread(
                    self.rag.query, message, 3, user_id
                )
                if results.get('documents') and results['documents'][0]:
                    docs = results['documents'][0]
                    if docs:
                        rag_context = "\n".join([f"📚 {doc}" for doc in docs])
                        logger.info(f"Retrieved {len(docs)} documents from RAG")
            except Exception as e:
                logger.warning(f"RAG query failed: {e}")
        
        # Step 2: ReAct Loop
        iteration = 0
        final_answer = ""
        
        while iteration < self.max_iterations:
            iteration += 1
            logger.info(f"ReAct iteration {iteration}/{self.max_iterations}")
            
            # Build system prompt (use effective_history when continuing saved chat)
            system_prompt = self._build_system_prompt(
                user_message=message,
                rag_context=rag_context,
                iteration=iteration,
                history_override=effective_history if initial_history else None,
                execution_context=execution_context,
            )
            
            # Get LLM response
            llm_response = ""
            async for chunk in self.llm.stream_chat(
                system_prompt, 
                model=model_preference,
                specific_model=specific_model
            ):
                llm_response += chunk
                # Stream thinking process to user (optional - can be disabled for cleaner UX)
                if iteration == 1:  # Only show first iteration thinking
                    yield chunk
            
            # Parse response for actions
            action_match = self._parse_action(llm_response)
            
            if action_match:
                # Agent wants to use a tool
                tool_name = action_match['tool']
                tool_args = action_match['args']
                
                yield f"\n\n🔧 **Using tool: {tool_name}**\n"
                
                try:
                    # Контекст для инструментов servers_list / server_execute (user_id, master_password)
                    ctx = (execution_context or {}).copy()
                    tool_context = {"user_id": ctx.get("user_id")} if ctx.get("user_id") else None
                    if ctx.get("master_password") and tool_context:
                        tool_context["master_password"] = ctx.get("master_password")
                    result = await self.tool_manager.execute_tool(
                        tool_name, _context=tool_context, **tool_args
                    )
                    
                    # Format result
                    result_str = self._format_tool_result(result)
                    yield f"✅ **Result:**\n```\n{result_str}\n```\n\n"
                    
                    # Add to effective history (and self.history if not override)
                    effective_history.append({
                        "role": "assistant",
                        "content": f"ACTION: {tool_name} with {tool_args}"
                    })
                    effective_history.append({
                        "role": "system",
                        "content": f"OBSERVATION: {result_str}"
                    })
                    if not initial_history:
                        self.history.append({
                            "role": "assistant",
                            "content": f"ACTION: {tool_name} with {tool_args}"
                        })
                        self.history.append({
                            "role": "system",
                            "content": f"OBSERVATION: {result_str}"
                        })
                    
                    # Continue loop with new observation
                    continue
                    
                except Exception as e:
                    error_msg = f"❌ Tool execution failed: {str(e)}"
                    yield f"{error_msg}\n\n"
                    logger.error(error_msg)
                    
                    effective_history.append({
                        "role": "system",
                        "content": f"ERROR: {str(e)}"
                    })
                    if not initial_history:
                        self.history.append({
                            "role": "system",
                            "content": f"ERROR: {str(e)}"
                        })
                    
                    # Continue loop to let agent handle error
                    continue
            else:
                # No action - this is the final answer
                final_answer = llm_response
                break
        
        # If we exhausted iterations without final answer, use last response
        if not final_answer:
            final_answer = "Достигнут лимит итераций. Вот что удалось выяснить:\n\n" + llm_response
        
        # Add final answer to history
        effective_history.append({"role": "assistant", "content": final_answer})
        if not initial_history:
            self.history.append({"role": "assistant", "content": final_answer})
        
        # Add to RAG if it's valuable information (RAG.add_text — sync, в thread)
        if len(final_answer) > 100 and user_id is not None:  # Only add substantial responses
            try:
                await asyncio.to_thread(
                    self.rag.add_text,
                    f"Q: {message}\nA: {final_answer}",
                    "conversation",
                    user_id,
                )
            except Exception as e:
                logger.warning(f"Failed to add to RAG: {e}")
        
        # If we already streamed the answer (iteration 1), don't stream again
        if iteration > 1:
            yield f"\n\n{final_answer}"
    
    def _build_system_prompt(
        self,
        user_message: str,
        rag_context: str,
        iteration: int,
        history_override: List[Dict[str, str]] = None,
        execution_context: Dict[str, Any] = None,
    ) -> str:
        """Build the ReAct system prompt. execution_context may contain connection_id, allowed_actions for delegated tasks."""
        history_source = history_override if history_override is not None else self.history

        history_text = ""
        if len(history_source) > 1:
            recent = history_source[-6:]
            history_text = "\n".join([
                f"{msg['role'].upper()}: {msg['content'][:200]}"
                for msg in recent[:-1]
            ])

        ctx_block = ""
        exclude_tools = None
        servers_block = ""
        
        if execution_context:
            conn_id = execution_context.get("connection_id")
            allowed = execution_context.get("allowed_actions", "")
            target_server = execution_context.get("server", {})
            # Флаг: показывать ли серверы в промпте (по умолчанию НЕТ для обычного чата)
            include_servers = execution_context.get("include_servers", False)
            
            if conn_id:
                # Когда есть connection_id — используем ТОЛЬКО этот сервер
                # Исключаем ssh_connect и server_execute (чтобы агент не переключился на другой сервер)
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
- ВАЖНО: Все команды выполняются на сервере {server_info}. Не пытайся подключиться к другим серверам!
"""
                # НЕ показываем список других серверов — работаем только с connection_id
                servers_block = ""
            elif include_servers:
                # Показываем серверы ТОЛЬКО если явно запрошено (например, для задач с серверами)
                user_id = execution_context.get("user_id")
                if user_id:
                    servers_block = self._get_user_servers_block(user_id)
            # else: обычный чат — НЕ показываем серверы автоматически
            # Пользователь может использовать инструмент servers_list если нужно

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

ВАЖНО: ответы пользователю — только на русском. Параметры ACTION — валидный JSON. Используй только перечисленные инструменты. Опасные операции выполнять только после явного подтверждения пользователя.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ: {user_message}

Твой ответ:"""
        return prompt
    
    def _get_user_servers_block(self, user_id: int) -> str:
        """
        Возвращает блок с актуальным списком серверов пользователя для системного промпта.
        """
        if not user_id:
            return ""
        try:
            from servers.models import Server
            servers = list(Server.objects.filter(user_id=user_id).values("id", "name", "host", "port", "username"))
            if not servers:
                return ""
            lines = [
                "\nТВОИ СЕРВЕРЫ (доступны через server_execute):",
            ]
            for s in servers:
                lines.append(f"  - {s['name']} (id={s['id']}): {s['username']}@{s['host']}:{s['port']}")
            lines.append("")
            lines.append("Используй server_execute с server_name_or_id='<имя сервера>' и command='<команда>'.")
            lines.append("НЕ ищи данные серверов в коде — бери их из этого списка!")
            lines.append("")
            return "\n".join(lines)
        except Exception as e:
            logger.warning(f"_get_user_servers_block error: {e}")
            return ""

    def _parse_action(self, response: str) -> dict:
        """
        Parse action from LLM response
        Returns: {"tool": "tool_name", "args": {dict}} or None
        """
        # Look for ACTION: tool_name {json}
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
        """Format tool execution result for display"""
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
        """Add text to RAG knowledge base (user_id required for per-user isolation)."""
        if self.rag.available and user_id is not None:
            doc_id = await asyncio.to_thread(
                self.rag.add_text, text, source, user_id
            )
            logger.info(f"Added to knowledge base: {doc_id}")
            return doc_id
        else:
            logger.warning("RAG not available or user_id missing")
            return None
