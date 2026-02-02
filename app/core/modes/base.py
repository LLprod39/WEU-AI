"""
Base Mode class for Unified Orchestrator
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, AsyncGenerator, Optional, List


class BaseMode(ABC):
    """
    Базовый класс для режимов оркестратора
    
    Каждый режим реализует свою логику выполнения задачи
    """
    
    def __init__(self, orchestrator):
        """
        Args:
            orchestrator: UnifiedOrchestrator instance (для доступа к LLM, RAG, Tools)
        """
        self.orchestrator = orchestrator
    
    @abstractmethod
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
        Выполнить задачу в данном режиме
        
        Args:
            message: Сообщение пользователя
            model_preference: Предпочтительная модель
            use_rag: Использовать RAG
            specific_model: Конкретная модель
            user_id: ID пользователя
            initial_history: История диалога
            execution_context: Контекст выполнения (connection_id, server, etc)
        
        Yields:
            str: Chunks of response
        """
        raise NotImplementedError("BaseMode.execute must be implemented by subclasses")
    
    @property
    def name(self) -> str:
        """Имя режима"""
        return self.__class__.__name__.replace("Mode", "").lower()
    
    @property
    def description(self) -> str:
        """Описание режима"""
        return "Base orchestrator mode"
