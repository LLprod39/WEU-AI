"""
ReAct Mode - текущий Orchestrator с ReAct loop
"""
import os
import asyncio
import re
import json
from typing import AsyncGenerator, List, Dict, Any, Optional
from loguru import logger
from app.core.modes.base import BaseMode


class ReActMode(BaseMode):
    """
    ReAct Mode (Reason + Act)
    
    Итеративный цикл:
    1. THOUGHT - рассуждение
    2. ACTION - вызов инструмента
    3. OBSERVATION - результат инструмента
    4. Повтор или финальный ответ
    """
    
    @property
    def description(self) -> str:
        return "ReAct loop (Reason + Act) - итеративное рассуждение с инструментами"
    
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
        Выполнение в ReAct режиме - копия логики из Orchestrator.process_user_message
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
        
        # RAG context
        rag_context = ""
        if use_rag and self.orchestrator.rag.available and user_id is not None:
            try:
                results = await asyncio.to_thread(
                    self.orchestrator.rag.query, message, 3, user_id
                )
                if results.get('documents') and results['documents'][0]:
                    docs = results['documents'][0]
                    if docs:
                        rag_context = "\n".join([f"📚 {doc}" for doc in docs])
                        logger.info(f"Retrieved {len(docs)} documents from RAG")
            except Exception as e:
                logger.warning(f"RAG query failed: {e}")
        
        # ReAct Loop (Enhanced for precision)
        iteration = 0
        final_answer = ""
        max_iterations = 7  # Increased for better reasoning
        tool_calls_made = []  # Track tool usage
        
        while iteration < max_iterations:
            iteration += 1
            logger.info(f"ReAct iteration {iteration}/{max_iterations}")
            
            # Build system prompt
            system_prompt = self.orchestrator._build_system_prompt(
                user_message=message,
                rag_context=rag_context,
                iteration=iteration,
                history_override=effective_history if initial_history else None,
                execution_context=execution_context,
            )
            
            # Get LLM response
            llm_response = ""
            async for chunk in self.orchestrator.llm.stream_chat(
                system_prompt, 
                model=model_preference,
                specific_model=specific_model
            ):
                llm_response += chunk
            
            # Parse response for actions
            action_match = self.orchestrator._parse_action(llm_response)
            
            if action_match:
                # Agent wants to use a tool
                tool_name = action_match['tool']
                tool_args = action_match['args']
                
                try:
                    ctx = (execution_context or {}).copy()
                    tool_context = {"user_id": ctx.get("user_id")} if ctx.get("user_id") else None
                    if ctx.get("master_password") and tool_context:
                        tool_context["master_password"] = ctx.get("master_password")
                    if ctx.get("workspace_path") and tool_context:
                        tool_context["workspace_path"] = ctx.get("workspace_path")
                    elif ctx.get("workspace_path"):
                        tool_context = {"workspace_path": ctx.get("workspace_path")}
                    
                    result = await self.orchestrator.tool_manager.execute_tool(
                        tool_name, _context=tool_context, **tool_args
                    )

                    result_str = self.orchestrator._format_tool_result(result)

                    # Track tool usage for verification
                    tool_calls_made.append({
                        "tool": tool_name,
                        "args": tool_args,
                        "iteration": iteration
                    })
                    
                    # IDE_FILE_CHANGED event
                    if tool_name == "write_file" and ctx.get("workspace_path"):
                        file_path = tool_args.get("path", "")
                        if file_path:
                            try:
                                from pathlib import Path
                                workspace_path_obj = Path(ctx.get("workspace_path"))
                                if os.path.isabs(file_path):
                                    try:
                                        file_path_obj = Path(file_path)
                                        if str(file_path_obj).startswith(str(workspace_path_obj)):
                                            rel_path = str(file_path_obj.relative_to(workspace_path_obj))
                                        else:
                                            rel_path = file_path
                                    except (ValueError, AttributeError):
                                        rel_path = file_path
                                else:
                                    rel_path = file_path
                                rel_path = rel_path.replace("\\", "/")
                                yield f"IDE_FILE_CHANGED:{rel_path}\n"
                            except Exception as e:
                                logger.debug(f"Could not compute relative path: {e}")
                    
                    # Add to history
                    effective_history.append({
                        "role": "assistant",
                        "content": f"ACTION: {tool_name} with {tool_args}"
                    })
                    effective_history.append({
                        "role": "system",
                        "content": f"OBSERVATION: {result_str}"
                    })
                    if not initial_history:
                        self.orchestrator.history.append({
                            "role": "assistant",
                            "content": f"ACTION: {tool_name} with {tool_args}"
                        })
                        self.orchestrator.history.append({
                            "role": "system",
                            "content": f"OBSERVATION: {result_str}"
                        })
                    
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
                        self.orchestrator.history.append({
                            "role": "system",
                            "content": f"ERROR: {str(e)}"
                        })
                    
                    # Stop early on tool failure to avoid noisy iterations
                    return
            else:
                # No action - final answer
                final_answer = llm_response
                break
        
        # If exhausted iterations without final answer
        if not final_answer:
            final_answer = "Достигнут лимит итераций. Вот что удалось выяснить:\n\n" + llm_response

        # VERIFICATION STEP: Review final answer for accuracy
        if tool_calls_made and final_answer and len(final_answer) > 50:
            verification_prompt = f"""Проверь свой ответ на точность и полноту.

ИСХОДНЫЙ ЗАПРОС: {message}

ИСПОЛЬЗОВАННЫЕ ИНСТРУМЕНТЫ: {', '.join([t['tool'] for t in tool_calls_made])}

ТВОЙ ОТВЕТ:
{final_answer}

ВОПРОСЫ ДЛЯ ПРОВЕРКИ:
1. Ответ полностью отвечает на запрос пользователя?
2. Все данные из инструментов использованы?
3. Нет ли противоречий или пропусков?

Если ответ ПОЛНЫЙ и ТОЧНЫЙ - выведи: VERIFIED: OK
Если нужны улучшения - выведи: IMPROVE: [краткое описание]
"""

            verification = ""
            async for chunk in self.orchestrator.llm.stream_chat(
                verification_prompt,
                model=model_preference,
                specific_model=specific_model
            ):
                verification += chunk

            # If verification suggests improvements, note it
            if "IMPROVE:" in verification:
                logger.info(f"ReAct verification suggests improvements: {verification}")
                # Could add another iteration here if needed

        # Add final answer to history
        effective_history.append({"role": "assistant", "content": final_answer})
        if not initial_history:
            self.orchestrator.history.append({"role": "assistant", "content": final_answer})
        
        # Add to RAG
        if len(final_answer) > 100 and user_id is not None:
            try:
                await asyncio.to_thread(
                    self.orchestrator.rag.add_text,
                    f"Q: {message}\nA: {final_answer}",
                    "conversation",
                    user_id,
                )
            except Exception as e:
                logger.warning(f"Failed to add to RAG: {e}")
        
        # Post-processing: конвертируем #ID в кликабельные ссылки
        if tool_calls_made:
            # Проверяем были ли вызовы tasks_list или task_detail
            task_tools_used = any(t['tool'] in ('tasks_list', 'task_detail') for t in tool_calls_made)
            if task_tools_used:
                import re
                def make_task_link(m):
                    task_id = m.group(1)
                    return f"**[#{task_id}](task:{task_id})**"
                final_answer = re.sub(r'(?<!\[)#(\d+)(?!\])', make_task_link, final_answer)

        # Stream final answer
        yield final_answer
