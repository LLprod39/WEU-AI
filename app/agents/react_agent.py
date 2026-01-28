"""
ReAct Agent - wrapper for existing Orchestrator with ReAct loop
"""
from typing import Dict, Any, Optional
from loguru import logger
from app.agents.base_agent import BaseAgent
from app.core.orchestrator import Orchestrator
from app.core.model_config import model_manager


class ReActAgent(BaseAgent):
    """
    ReAct Agent - uses the existing Orchestrator with ReAct loop.
    This is a wrapper around the existing functionality.
    """
    
    def __init__(self):
        super().__init__(
            name="ReAct Agent",
            description="Advanced agent with ReAct (Reason + Act) loop. Uses tools, RAG, and iterative reasoning."
        )
        self._orchestrator = None
    
    @property
    def orchestrator(self):
        """Lazy load orchestrator"""
        if self._orchestrator is None:
            self._orchestrator = Orchestrator()
            # Mark as not initialized yet
            self._orchestrator.initialized = False
        return self._orchestrator
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute task using ReAct loop via Orchestrator.
        """
        context = self.validate_context(context)
        
        try:
            # Get model preference from context or use default
            model_preference = context.get('model', model_manager.config.default_provider)
            use_rag = context.get('use_rag', True)
            specific_model = context.get('specific_model')
            
            # Initialize orchestrator if needed
            if not hasattr(self._orchestrator, 'initialized') or not self._orchestrator.initialized:
                await self.orchestrator.initialize()
                self.orchestrator.initialized = True
            
            # Build execution_context for delegated tasks (connection_id, server, allowed_actions)
            execution_context = None
            if context.get('connection_id'):
                execution_context = {
                    'connection_id': context['connection_id'],
                    'server': context.get('server', {}),  # {name, host} для отображения в промпте
                    'allowed_actions': context.get('allowed_actions', 'readonly, проверка (df, логи, статус)'),
                    'user_id': context.get('user_id'),
                    'task_id': context.get('task_id'),
                }

            # Collect response from orchestrator
            result_parts = []
            async for chunk in self.orchestrator.process_user_message(
                task,
                model_preference=model_preference,
                use_rag=use_rag,
                specific_model=specific_model,
                execution_context=execution_context,
            ):
                result_parts.append(chunk)
            
            result_text = ''.join(result_parts)
            
            return {
                'success': True,
                'result': result_text,
                'error': None,
                'metadata': {
                    'model': model_preference,
                    'used_rag': use_rag,
                    'agent_type': 'react'
                }
            }
            
        except Exception as e:
            logger.error(f"ReAct Agent execution failed: {e}")
            return {
                'success': False,
                'result': None,
                'error': str(e),
                'metadata': {'agent_type': 'react'}
            }
