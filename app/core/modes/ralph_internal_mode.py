"""
Ralph Internal Mode - итеративный самосовершенствующийся агент (внутри Python)
"""
import asyncio
import re
from typing import AsyncGenerator, List, Dict, Any, Optional
from loguru import logger
from app.core.modes.base import BaseMode
from app.core.model_config import model_manager


class RalphInternalMode(BaseMode):
    """
    Ralph Internal Mode - итеративное выполнение с улучшением
    
    Основан на RalphWiggumAgent логике:
    - Многократные итерации
    - Проверка completion promise
    - Улучшение на основе предыдущих результатов
    """
    
    @property
    def description(self) -> str:
        return "Ralph Internal - итеративное самосовершенствование (внутри Python)"
    
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
        Выполнение в Ralph Internal режиме
        """
        # Параметры Ralph
        max_iterations = model_manager.config.ralph_max_iterations
        completion_promise = model_manager.config.ralph_completion_promise
        
        # Override from context
        if execution_context:
            max_iterations = execution_context.get('max_iterations', max_iterations)
            completion_promise = execution_context.get('completion_promise', completion_promise)
        
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
            except Exception as e:
                logger.warning(f"RAG query failed: {e}")
        
        # Iterative loop
        iteration = 0
        all_results = []
        last_result = ""
        completion_promise = (completion_promise or "").strip()
        stuck_guidance = (
            "Если задача заблокирована, явно опиши блокеры и что нужно для прогресса. "
            "Не выводи completion promise, если работа не завершена."
        )
        
        while iteration < max_iterations:
            iteration += 1
            logger.info(f"Ralph iteration {iteration}/{max_iterations}")
            
            # Build prompt for this iteration
            if iteration == 1:
                prompt = f"""You are working on the following task. Work on it step by step.

Task: {message}

{rag_context if rag_context else ""}

When you complete the task, output exactly: <promise>{completion_promise}</promise>
CRITICAL RULE: Do NOT output the promise unless it is completely and unequivocally TRUE.
If requirements are unclear, list 1-3 clarifying questions before proceeding and state your assumptions.
{stuck_guidance}

Begin working:"""
            else:
                # Include previous results for context
                prompt = f"""Continue working on this task. You've completed {iteration - 1} iteration(s).

Original Task: {message}

Previous Results:
{last_result}

Review your previous work, identify what needs improvement, and continue.
When you complete the task, output exactly: <promise>{completion_promise}</promise>
CRITICAL RULE: Do NOT output the promise unless it is completely and unequivocally TRUE.
If requirements are unclear, list 1-3 clarifying questions before proceeding and state your assumptions.
{stuck_guidance}

Continue:"""
            
            # Execute iteration
            iteration_result = ""
            async for chunk in self.orchestrator.llm.stream_chat(
                prompt, 
                model=model_preference, 
                specific_model=specific_model
            ):
                iteration_result += chunk
                # Stream to user
                if iteration == 1:
                    yield chunk
            
            last_result = iteration_result
            all_results.append(f"**Iteration {iteration}:**\n{iteration_result}\n")
            
            # Check for completion
            if completion_promise and self._has_completion_promise(iteration_result, completion_promise):
                logger.success(f"Ralph Internal completed at iteration {iteration}")
                
                # Add to history and RAG
                final_answer = "\n\n".join(all_results)
                if not initial_history:
                    self.orchestrator.history.append({"role": "assistant", "content": final_answer})
                
                if user_id is not None:
                    try:
                        await asyncio.to_thread(
                            self.orchestrator.rag.add_text,
                            f"Q: {message}\nA: {final_answer}",
                            "conversation",
                            user_id,
                        )
                    except Exception:
                        pass
                
                if iteration > 1:
                    yield f"\n\n✅ **Завершено на итерации {iteration}**\n"
                return
            
            # If at max iterations
            if iteration >= max_iterations:
                logger.warning(f"Ralph Internal reached max iterations ({max_iterations})")
                final_answer = "\n\n".join(all_results)
                final_answer += f"\n\n⚠️ Достигнут лимит итераций ({max_iterations})"
                
                if not initial_history:
                    self.orchestrator.history.append({"role": "assistant", "content": final_answer})
                
                if iteration > 1:
                    yield f"\n\n{final_answer}"
                return
            
            # Show iteration progress
            if iteration > 1:
                yield f"\n\n🔄 **Iteration {iteration}/{max_iterations}**\n\n"
    
    @staticmethod
    def _has_completion_promise(output: str, promise: str) -> bool:
        """
        Detect completion promise tag: <promise>TEXT</promise>.
        Must match exactly after whitespace normalization.
        """
        match = re.search(r"<promise>(.*?)</promise>", output, re.DOTALL | re.IGNORECASE)
        if not match:
            return False
        extracted = re.sub(r"\s+", " ", match.group(1).strip())
        target = re.sub(r"\s+", " ", promise.strip())
        return extracted == target
