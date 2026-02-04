"""
Enhanced Orchestrator with ReAct Loop and Full Tool Integration
Central brain of the agentic system

DEPRECATED: This module is deprecated. Use UnifiedOrchestrator from
app.core.unified_orchestrator instead. It provides the same functionality
plus additional modes (ralph_internal, ralph_cli).

This module is kept for backward compatibility only.
"""
import warnings

warnings.warn(
    "app.core.orchestrator.Orchestrator is deprecated. "
    "Use app.core.unified_orchestrator.UnifiedOrchestrator instead.",
    DeprecationWarning,
    stacklevel=2
)

from app.core.llm import LLMProvider
from app.rag.engine import RAGEngine
from app.tools.manager import get_tool_manager
from loguru import logger
import asyncio
import re
import json
import os
from typing import AsyncGenerator, List, Dict, Any


# Re-export AGENT_SYSTEM_RULES_RU from unified_orchestrator for backward compatibility
from app.core.unified_orchestrator import AGENT_SYSTEM_RULES_RU


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
                    # Передаём workspace_path в tool_context для файловых инструментов
                    if ctx.get("workspace_path") and tool_context:
                        tool_context["workspace_path"] = ctx.get("workspace_path")
                    elif ctx.get("workspace_path"):
                        tool_context = {"workspace_path": ctx.get("workspace_path")}
                    
                    result = await self.tool_manager.execute_tool(
                        tool_name, _context=tool_context, **tool_args
                    )
                    
                    # Format result
                    result_str = self._format_tool_result(result)
                    yield f"✅ **Result:**\n```\n{result_str}\n```\n\n"
                    
                    # Если это write_file и есть workspace_path, выдаём событие IDE_FILE_CHANGED
                    if tool_name == "write_file" and ctx.get("workspace_path"):
                        file_path = tool_args.get("path", "")
                        if file_path:
                            # Вычисляем относительный путь от workspace_path
                            try:
                                from pathlib import Path
                                workspace_path_obj = Path(ctx.get("workspace_path"))
                                # Если путь абсолютный и внутри workspace, вычисляем относительный
                                if os.path.isabs(file_path):
                                    try:
                                        file_path_obj = Path(file_path)
                                        if file_path_obj.is_relative_to(workspace_path_obj):
                                            rel_path = str(file_path_obj.relative_to(workspace_path_obj))
                                        else:
                                            rel_path = file_path
                                    except (ValueError, AttributeError):
                                        rel_path = file_path
                                else:
                                    rel_path = file_path
                                # Нормализуем слеши для веб
                                rel_path = rel_path.replace("\\", "/")
                                yield f"IDE_FILE_CHANGED:{rel_path}\n"
                            except Exception as e:
                                logger.debug(f"Could not compute relative path for IDE_FILE_CHANGED: {e}")
                    
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
            
            # Добавляем информацию о workspace если есть
            workspace_path = execution_context.get("workspace_path")
            from_ide = execution_context.get("from_ide", False)
            if workspace_path:
                workspace_block = f"""
РАБОЧАЯ ДИРЕКТОРИЯ (WORKSPACE):
- Рабочая директория проекта: **{workspace_path}**
- Все пути к файлам указывай относительно этой директории (например: src/foo.py, main.py, config/settings.json)
- Или используй абсолютные пути внутри этой директории
- Инструменты read_file, write_file, list_directory автоматически разрешат относительные пути относительно workspace
"""
                ctx_block = (ctx_block + "\n" + workspace_block).strip() if ctx_block else workspace_block.strip()
            
            # Режим IDE: не выводить данные серверов и посторонние чек-листы
            if from_ide:
                ide_rule = """
РЕЖИМ IDE:
- НЕ выводи в ответе данные серверов (хосты, пароли, команды ssh). Не включай посторонние чек-листы задач.
- Фокусируйся только на коде и файлах проекта. Отвечай кратко по существу.
"""
                ctx_block = (ctx_block + "\n" + ide_rule).strip() if ctx_block else ide_rule.strip()
                # В режиме IDE не показываем блок серверов
                servers_block = ""

        # Chat capabilities summary (what data is available in this UI)
        rag_flag = None
        if execution_context and "rag_enabled" in execution_context:
            rag_flag = "ВКЛ" if execution_context.get("rag_enabled") else "ВЫКЛ"
        rag_line = f"- RAG: сейчас {rag_flag} (если ВКЛ — используй базу знаний)." if rag_flag else "- RAG: используется, если включено в чате (галочка) и база знаний доступна."
        chat_caps = f"""
КОНТЕКСТ ЧАТА (ДОСТУПНЫЕ ДАННЫЕ):
{rag_line}
- Задачи: доступны через инструменты tasks_list и task_detail (статус, описание, сроки, исполнитель).
- Серверы: доступны через servers_list / server_execute (безопасные команды; опасные — только после подтверждения).
- Файлы: пользователь может прикрепить файлы; при необходимости запроси файл.
"""

        tools_description = self.tool_manager.get_tools_description(exclude_tools=exclude_tools)
        prompt = f"""You are WEU Agent — интеллектуальный ассистент с доступом к инструментам.
{AGENT_SYSTEM_RULES_RU}
{ctx_block}
{servers_block}
{chat_caps}

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
{tools_description}

БАЗА ЗНАНИЙ:
{rag_context if rag_context else "Нет релевантного контекста."}

ИСТОРИЯ ДИАЛОГА:
{history_text if history_text else "Нет предыдущего контекста."}

ИНСТРУКЦИИ ReAct (Точность и Полнота):
1. Внимательно анализируй запрос пользователя.
2. Если нужны данные — вызывай инструмент в формате:
   ACTION: tool_name {{"param": "value"}}
3. После OBSERVATION анализируй результат:
   - ВСЕ ли данные получены?
   - Достаточно ли для полного ответа?
   - Нужны ли дополнительные инструменты?
4. Перед финальным ответом ПРОВЕРЬ:
   - Ответ полностью отвечает на вопрос?
   - Использованы все полученные данные?
   - Нет пропусков или противоречий?
5. Финальный ответ БЕЗ строки ACTION, на русском.

КАЧЕСТВО > СКОРОСТЬ. Лучше сделать дополнительную итерацию, чем дать неполный ответ.
Параметры ACTION — валидный JSON. Используй только перечисленные инструменты.

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
