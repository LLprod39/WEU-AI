"""
Ralph Wiggum Agent - iterative self-improving agent
Based on the Ralph Wiggum technique from https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
"""
from typing import Dict, Any, Optional
from loguru import logger
from app.agents.base_agent import BaseAgent
from app.core.model_config import model_manager


class RalphWiggumAgent(BaseAgent):
    """
    Ralph Wiggum Agent - iterative self-improving agent.
    
    Implements the Ralph technique:
    - Iteratively works on a task
    - Checks for completion criteria
    - Improves based on results
    - Continues until completion or max iterations
    """
    
    def __init__(self):
        super().__init__(
            name="Ralph Wiggum Agent",
            description="Iterative self-improving agent. Works on tasks repeatedly until completion criteria are met."
        )
        self.default_max_iterations = 10
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute task with iterative improvement loop.
        
        Context parameters:
            - completion_promise: str - phrase that signals completion (default: "COMPLETE")
            - max_iterations: int - maximum iterations (default: 10)
            - initial_prompt: str - optional initial prompt template
        """
        context = self.validate_context(context)
        
        try:
            completion_promise = context.get('completion_promise', 'COMPLETE')
            max_iterations = context.get('max_iterations', self.default_max_iterations)
            if isinstance(max_iterations, str) and max_iterations.isdigit():
                max_iterations = int(max_iterations)
            if max_iterations <= 0:
                max_iterations = 9999
            model_preference = context.get('model', model_manager.config.default_provider)
            specific_model = context.get('specific_model')
            use_rag = context.get('use_rag', True)
            
            logger.info(f"Ralph Agent starting: max_iterations={max_iterations}, completion_promise='{completion_promise}'")
            
            # Build initial prompt
            initial_prompt = context.get('initial_prompt', task)
            stuck_guidance = (
                "Если задача заблокирована, явно опиши блокеры и что нужно для прогресса. "
                "Не выводи completion promise, если работа не завершена."
            )
            
            # Iterative loop
            iteration = 0
            all_results = []
            last_result = ""
            completion_promise = (completion_promise or "").strip()
            
            while iteration < max_iterations:
                iteration += 1
                logger.info(f"Ralph iteration {iteration}/{max_iterations}")
                
                # Build prompt for this iteration
                if iteration == 1:
                    prompt = f"""You are working on the following task. Work on it step by step.

Task: {initial_prompt}

When you complete the task, output exactly: <promise>{completion_promise}</promise>
CRITICAL RULE: Do NOT output the promise unless it is completely and unequivocally TRUE.
If requirements are unclear, list 1-3 clarifying questions before proceeding and state your assumptions.
{stuck_guidance}

Begin working:"""
                else:
                    # Include previous results for context
                    prompt = f"""Continue working on this task. You've completed {iteration - 1} iteration(s).

Original Task: {initial_prompt}

Previous Results:
{last_result}

Review your previous work, identify what needs improvement, and continue.
When you complete the task, output exactly: <promise>{completion_promise}</promise>
CRITICAL RULE: Do NOT output the promise unless it is completely and unequivocally TRUE.
If requirements are unclear, list 1-3 clarifying questions before proceeding and state your assumptions.
{stuck_guidance}

Continue:"""
                
                # Get RAG context if available
                rag_context = ""
                if use_rag and self.rag_engine.available:
                    try:
                        results = self.rag_engine.query(task, n_results=3)
                        if results.get('documents') and results['documents'][0]:
                            docs = results['documents'][0]
                            if docs:
                                rag_context = "\n".join([f"📚 {doc}" for doc in docs[:3]])
                                if iteration == 1:
                                    prompt = f"{rag_context}\n\n{prompt}"
                    except Exception as e:
                        logger.warning(f"RAG query failed: {e}")
                
                # Execute iteration
                iteration_result = ""
                async for chunk in self.llm_provider.stream_chat(
                    prompt, 
                    model=model_preference, 
                    specific_model=specific_model
                ):
                    iteration_result += chunk
                
                last_result = iteration_result
                all_results.append(f"**Iteration {iteration}:**\n{iteration_result}\n")
                
                # Check for completion
                if completion_promise and self._has_completion_promise(iteration_result, completion_promise):
                    logger.success(f"Ralph Agent completed at iteration {iteration}")
                    return {
                        'success': True,
                        'result': "\n\n".join(all_results),
                        'error': None,
                        'metadata': {
                            'model': model_preference,
                            'agent_type': 'ralph',
                            'iterations': iteration,
                            'max_iterations': max_iterations,
                            'completed': True
                        }
                    }
                
                # If we're at max iterations, return what we have
                if iteration >= max_iterations:
                    logger.warning(f"Ralph Agent reached max iterations ({max_iterations}) without completion")
                    return {
                        'success': True,
                        'result': "\n\n".join(all_results),
                        'error': f"Reached max iterations ({max_iterations}) without completion",
                        'metadata': {
                            'model': model_preference,
                            'agent_type': 'ralph',
                            'iterations': iteration,
                            'max_iterations': max_iterations,
                            'completed': False
                        }
                    }
            
            # Should not reach here, but just in case
            return {
                'success': True,
                'result': "\n\n".join(all_results),
                'error': None,
                'metadata': {
                    'model': model_preference,
                    'agent_type': 'ralph',
                    'iterations': iteration,
                    'completed': False
                }
            }
            
        except Exception as e:
            logger.error(f"Ralph Agent execution failed: {e}")
            return {
                'success': False,
                'result': None,
                'error': str(e),
                'metadata': {'agent_type': 'ralph'}
            }

    @staticmethod
    def _has_completion_promise(output: str, promise: str) -> bool:
        """
        Detect completion promise tag: <promise>TEXT</promise>.
        Must match exactly after whitespace normalization.
        """
        import re

        match = re.search(r"<promise>(.*?)</promise>", output, re.DOTALL | re.IGNORECASE)
        if not match:
            return False
        extracted = re.sub(r"\s+", " ", match.group(1).strip())
        target = re.sub(r"\s+", " ", promise.strip())
        return extracted == target
