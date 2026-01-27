"""
Complex Agent - for tasks requiring planning and tool usage
"""
from typing import Dict, Any, Optional, List
from loguru import logger
from app.agents.base_agent import BaseAgent
from app.core.model_config import model_manager


class ComplexAgent(BaseAgent):
    """
    Complex Agent - for tasks requiring planning, breakdown, and tool usage.
    Analyzes the task, creates a plan, and executes it step by step.
    """
    
    def __init__(self):
        super().__init__(
            name="Complex Agent",
            description="Advanced agent for complex tasks. Plans, breaks down tasks, and uses tools when needed."
        )
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute complex task with planning and tool usage.
        """
        context = self.validate_context(context)
        
        try:
            model_preference = context.get('model', model_manager.config.default_provider)
            specific_model = context.get('specific_model')
            use_rag = context.get('use_rag', True)
            
            # Step 1: Analyze and plan
            plan = await self._create_plan(task, model_preference, specific_model, use_rag)
            
            # Step 2: Execute plan
            execution_result = await self._execute_plan(plan, task, model_preference, specific_model, use_rag)
            
            return {
                'success': True,
                'result': execution_result,
                'error': None,
                'metadata': {
                    'model': model_preference,
                    'agent_type': 'complex',
                    'plan': plan,
                    'used_tools': True
                }
            }
            
        except Exception as e:
            logger.error(f"Complex Agent execution failed: {e}")
            return {
                'success': False,
                'result': None,
                'error': str(e),
                'metadata': {'agent_type': 'complex'}
            }
    
    async def _create_plan(self, task: str, model: str, specific_model: Optional[str], use_rag: bool) -> List[str]:
        """Create execution plan for the task"""
        # Get RAG context if available
        rag_context = ""
        if use_rag and self.rag_engine.available:
            try:
                results = self.rag_engine.query(task, n_results=3)
                if results.get('documents') and results['documents'][0]:
                    docs = results['documents'][0]
                    if docs:
                        rag_context = "\n".join([f"📚 {doc}" for doc in docs[:3]])
            except Exception as e:
                logger.warning(f"RAG query failed: {e}")
        
        # Get available tools
        tools_description = self.tool_manager.get_tools_description()
        
        prompt = f"""You are a task planning AI. Analyze the following task and create a step-by-step execution plan.

Task: {task}

{rag_context if rag_context else ""}

Available Tools:
{tools_description}

Create a detailed plan with specific steps. Return the plan as a JSON list of strings, where each string is a step.
Example: ["Step 1 description", "Step 2 description", ...]

Plan:"""
        
        response_text = ""
        async for chunk in self.llm_provider.stream_chat(prompt, model=model, specific_model=specific_model):
            response_text += chunk
        
        # Parse plan (try to extract JSON)
        import json
        import re
        
        # Try to find JSON array in response
        json_match = re.search(r'\[.*?\]', response_text, re.DOTALL)
        if json_match:
            try:
                plan = json.loads(json_match.group())
                if isinstance(plan, list):
                    return plan
            except Exception:
                logger.debug("Failed to parse JSON plan response.")
        
        # Fallback: split by lines or numbers
        lines = [line.strip() for line in response_text.split('\n') if line.strip()]
        plan = []
        for line in lines:
            # Remove numbering
            line = re.sub(r'^\d+[\.\)]\s*', '', line)
            if line and len(line) > 10:  # Filter out very short lines
                plan.append(line)
        
        return plan if plan else ["Analyze the task", "Execute the solution", "Verify the result"]
    
    async def _execute_plan(self, plan: List[str], original_task: str, model: str, 
                           specific_model: Optional[str], use_rag: bool) -> str:
        """Execute the plan step by step"""
        results = []
        
        for i, step in enumerate(plan, 1):
            logger.info(f"Executing step {i}/{len(plan)}: {step}")
            
            # For now, use ReAct agent for each step
            # In future, this could be more sophisticated
            step_prompt = f"""Step {i} of {len(plan)}: {step}

Original task: {original_task}

Execute this step. If you need to use tools, use them. Provide a clear result."""
            
            step_result = ""
            async for chunk in self.llm_provider.stream_chat(step_prompt, model=model, specific_model=specific_model):
                step_result += chunk
            
            results.append(f"**Step {i}: {step}**\n{step_result}\n")
        
        return "\n\n".join(results)
