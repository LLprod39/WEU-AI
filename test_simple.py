"""
Простой тест конфигурации моделей
"""
from app.core.model_config import model_manager

print("=== Тест конфигурации моделей ===\n")

# Текущая конфигурация
print("1. Текущие модели:")
print(f"   Gemini Chat: {model_manager.config.chat_model_gemini}")
print(f"   Gemini Agent: {model_manager.config.agent_model_gemini}")
print(f"   Grok Chat: {model_manager.config.chat_model_grok}")
print(f"   Grok Agent: {model_manager.config.agent_model_grok}")
print(f"   RAG: {model_manager.config.rag_model}")
print(f"   Default Provider: {model_manager.config.default_provider}")

# Доступные модели
print("\n2. Доступные модели (fallback):")
gemini_models = model_manager.get_available_models('gemini')
print(f"   Gemini: {len(gemini_models)} моделей")
for i, model in enumerate(gemini_models[:3], 1):
    print(f"      {i}. {model}")

grok_models = model_manager.get_available_models('grok')
print(f"   Grok: {len(grok_models)} моделей")
for i, model in enumerate(grok_models[:3], 1):
    print(f"      {i}. {model}")

print("\n✓ Тест завершен успешно!")
