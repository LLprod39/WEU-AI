"""
Model Configuration Manager
Manages model selection for different purposes (chat, RAG, agent)
"""
import os
from typing import Dict, List, Optional
from pydantic import BaseModel
from loguru import logger
from google import genai
import httpx
import json


class ModelConfig(BaseModel):
    """Configuration for models"""
    # Chat models
    chat_model_gemini: str = "models/gemini-3-flash-preview"
    chat_model_grok: str = "grok-3"
    
    # RAG/Embedding models
    rag_model: str = "models/text-embedding-004"  # Gemini embedding
    
    # Agent/ReAct models
    agent_model_gemini: str = "models/gemini-3-flash-preview"
    agent_model_grok: str = "grok-3"
    
    # Current provider: auto = Cursor CLI (Ask), gemini, grok
    default_provider: str = "auto"

    # Папка по умолчанию для сохранения файлов агента (код, артефакты workflow).
    # Относительный путь внутри AGENT_PROJECTS_DIR или пусто = не задано.
    default_agent_output_path: str = ""



class ModelManager:
    """Manages available models and configurations"""
    
    def __init__(self):
        self.config = ModelConfig()
        self.available_gemini_models: List[str] = []
        self.available_grok_models: List[str] = []
        self.gemini_api_key: Optional[str] = None
        self.grok_api_key: Optional[str] = None
    
    def set_api_keys(self, gemini_key: Optional[str] = None, grok_key: Optional[str] = None):
        """Set API keys"""
        if gemini_key:
            self.gemini_api_key = gemini_key
        if grok_key:
            self.grok_api_key = grok_key
    
    async def fetch_available_gemini_models(self) -> List[str]:
        """
        Fetch available Gemini models using google.genai
        """
        if not self.gemini_api_key:
            logger.warning("Gemini API key not set")
            return self._get_default_gemini_models()
        
        try:
            # Create client with API key
            client = genai.Client(api_key=self.gemini_api_key)
            
            # List all models
            models = client.models.list()
            
            # Filter for generative models (chat/text)
            generative_models = []
            embedding_models = []
            
            for model in models:
                model_name = model.name
                
                # Check if it supports text generation
                if hasattr(model, 'supported_actions') and 'generateContent' in model.supported_actions:
                    generative_models.append(model_name)
                
                # Check if it supports embeddings
                if hasattr(model, 'supported_actions') and 'embedContent' in model.supported_actions:
                    embedding_models.append(model_name)
            
            self.available_gemini_models = generative_models
            
            logger.success(f"Fetched {len(generative_models)} Gemini generative models")
            logger.info(f"Found {len(embedding_models)} embedding models")
            
            return generative_models
            
        except Exception as e:
            logger.error(f"Failed to fetch Gemini models: {e}")
            return self._get_default_gemini_models()
    
    async def fetch_available_grok_models(self) -> List[str]:
        """
        Fetch available Grok models from xAI API
        """
        if not self.grok_api_key:
            logger.warning("Grok API key not set")
            return self._get_default_grok_models()
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://api.x.ai/v1/models",
                    headers={"Authorization": f"Bearer {self.grok_api_key}"},
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    models = [model['id'] for model in data.get('data', [])]
                    
                    self.available_grok_models = models
                    logger.success(f"Fetched {len(models)} Grok models")
                    return models
                else:
                    logger.error(f"Grok API returned status {response.status_code}")
                    return self._get_default_grok_models()
                    
        except Exception as e:
            logger.error(f"Failed to fetch Grok models: {e}")
            return self._get_default_grok_models()
    
    def _get_default_gemini_models(self) -> List[str]:
        """Default Gemini models list (fallback)"""
        return [
            "models/gemini-3-flash-preview",
            "models/gemini-2.5-flash-preview",
        ]
    
    def _get_default_grok_models(self) -> List[str]:
        """Default Grok models list (fallback)"""
        return [
            "grok-3",
        ]
    
    async def refresh_models(self):
        """Refresh available models from both providers"""
        logger.info("Refreshing available models...")
        
        if self.gemini_api_key:
            await self.fetch_available_gemini_models()
        
        if self.grok_api_key:
            await self.fetch_available_grok_models()
    
    def get_chat_model(self, provider: Optional[str] = None) -> str:
        """Get configured chat model for provider"""
        provider = provider or self.config.default_provider
        
        if provider == "gemini":
            return self.config.chat_model_gemini
        else:
            return self.config.chat_model_grok
    
    def get_agent_model(self, provider: Optional[str] = None) -> str:
        """Get configured agent model for provider"""
        provider = provider or self.config.default_provider
        
        if provider == "gemini":
            return self.config.agent_model_gemini
        else:
            return self.config.agent_model_grok
    
    def get_rag_model(self) -> str:
        """Get configured RAG/embedding model"""
        return self.config.rag_model
    
    def update_config(self, **kwargs):
        """Update configuration"""
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
                logger.info(f"Updated {key} to {value}")
    
    def save_config(self, filepath: str = ".model_config.json"):
        """Save configuration to file"""
        try:
            with open(filepath, 'w') as f:
                json.dump(self.config.model_dump(), f, indent=2)
            logger.success(f"Model configuration saved to {filepath}")
        except Exception as e:
            logger.error(f"Failed to save config: {e}")
    
    def load_config(self, filepath: str = ".model_config.json"):
        """Load configuration from file"""
        try:
            if os.path.exists(filepath):
                with open(filepath, 'r') as f:
                    data = json.load(f)
                self.config = ModelConfig(**data)
                logger.success(f"Model configuration loaded from {filepath}")
                return True
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
        
        return False
    
    def get_available_models(self, provider: str) -> List[str]:
        """Get list of available models for provider"""
        if provider == "gemini":
            if not self.available_gemini_models:
                return self._get_default_gemini_models()
            return self.available_gemini_models
        else:
            if not self.available_grok_models:
                return self._get_default_grok_models()
            return self.available_grok_models


# Global model manager instance
model_manager = ModelManager()
