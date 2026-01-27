"""
Simple Agent - for straightforward tasks that don't require tools
"""
from typing import Dict, Any, Optional
from loguru import logger
from app.agents.base_agent import BaseAgent
from app.core.model_config import model_manager


class SimpleAgent(BaseAgent):
    """
    Simple Agent - for straightforward tasks.
    Provides direct LLM responses without tool usage or complex reasoning.
    """
    
    def __init__(self):
        super().__init__(
            name="Simple Agent",
            description="Fast agent for simple questions and tasks. Provides direct answers without using tools."
        )
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute simple task - just get LLM response.
        """
        context = self.validate_context(context)
        
        try:
            # Get model preference
            model_preference = context.get('model', model_manager.config.default_provider)
            specific_model = context.get('specific_model')
            
            # Build simple prompt
            prompt = f"""You are a helpful AI assistant. Answer the following question or complete the task directly and concisely.

Task: {task}

Provide a clear, helpful response."""
            
            # Get LLM response
            result_parts = []
            async for chunk in self.llm_provider.stream_chat(
                prompt,
                model=model_preference,
                specific_model=specific_model
            ):
                result_parts.append(chunk)
            
            result_text = ''.join(result_parts)
            
            return {
                'success': True,
                'result': result_text,
                'error': None,
                'metadata': {
                    'model': model_preference,
                    'agent_type': 'simple',
                    'used_tools': False
                }
            }
            
        except Exception as e:
            logger.error(f"Simple Agent execution failed: {e}")
            return {
                'success': False,
                'result': None,
                'error': str(e),
                'metadata': {'agent_type': 'simple'}
            }
