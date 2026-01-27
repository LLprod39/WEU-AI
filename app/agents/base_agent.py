"""
Base Agent class - foundation for all agents
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from loguru import logger


class BaseAgent(ABC):
    """
    Base class for all agents.
    All agents must implement the execute method.
    """
    
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
        self._tool_manager = None
        self._rag_engine = None
        self._llm_provider = None
    
    @property
    def tool_manager(self):
        """Lazy load tool manager"""
        if self._tool_manager is None:
            from app.tools.manager import ToolManager
            self._tool_manager = ToolManager()
        return self._tool_manager
    
    @property
    def rag_engine(self):
        """Lazy load RAG engine"""
        if self._rag_engine is None:
            from app.rag.engine import RAGEngine
            self._rag_engine = RAGEngine()
        return self._rag_engine
    
    @property
    def llm_provider(self):
        """Lazy load LLM provider"""
        if self._llm_provider is None:
            from app.core.llm import LLMProvider
            self._llm_provider = LLMProvider()
        return self._llm_provider
    
    @abstractmethod
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute the agent's task.
        
        Args:
            task: Task description or instruction
            context: Optional context dictionary with additional information
            
        Returns:
            Dictionary with keys:
                - success: bool
                - result: Any (the result of execution)
                - error: Optional[str] (error message if failed)
                - metadata: Optional[Dict] (additional metadata)
        """
        raise NotImplementedError("BaseAgent.execute must be implemented by subclasses.")
    
    def get_info(self) -> Dict[str, Any]:
        """Get agent information"""
        return {
            'name': self.name,
            'description': self.description,
            'type': self.__class__.__name__
        }
    
    def validate_context(self, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Validate and normalize context"""
        if context is None:
            context = {}
        return context
