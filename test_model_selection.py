"""
Тестовый скрипт для проверки функциональности выбора моделей
"""
import asyncio
from app.core.model_config import model_manager
from loguru import logger

async def test_model_selection():
    """Тест выбора моделей"""
    
    logger.info("=== Тест системы выбора моделей ===")
    
    # 1. Проверка дефолтных моделей
    logger.info("\n1. Дефолтные модели:")
    logger.info(f"   Gemini Chat: {model_manager.get_chat_model('gemini')}")
    logger.info(f"   Gemini Agent: {model_manager.get_agent_model('gemini')}")
    logger.info(f"   Grok Chat: {model_manager.get_chat_model('grok')}")
    logger.info(f"   Grok Agent: {model_manager.get_agent_model('grok')}")
    logger.info(f"   RAG Model: {model_manager.get_rag_model()}")
    logger.info(f"   Default Provider: {model_manager.config.default_provider}")
    
    # 2. Проверка доступных моделей (fallback)
    logger.info("\n2. Доступные модели (fallback):")
    gemini_models = model_manager.get_available_models('gemini')
    grok_models = model_manager.get_available_models('grok')
    logger.info(f"   Gemini: {len(gemini_models)} моделей")
    for model in gemini_models[:3]:
        logger.info(f"      - {model}")
    logger.info(f"   Grok: {len(grok_models)} моделей")
    for model in grok_models[:3]:
        logger.info(f"      - {model}")
    
    # 3. Тест обновления конфигурации
    logger.info("\n3. Тест обновления конфигурации:")
    original_chat_model = model_manager.config.chat_model_gemini
    
    model_manager.update_config(chat_model_gemini="models/gemini-1.5-pro")
    logger.info(f"   Обновлено: {model_manager.get_chat_model('gemini')}")
    
    # Вернуть обратно
    model_manager.update_config(chat_model_gemini=original_chat_model)
    logger.info(f"   Восстановлено: {model_manager.get_chat_model('gemini')}")
    
    # 4. Тест сохранения/загрузки конфигурации
    logger.info("\n4. Тест сохранения конфигурации:")
    try:
        model_manager.save_config("test_config.json")
        logger.success("   ✓ Конфигурация сохранена")
        
        # Создать новый менеджер и загрузить
        from app.core.model_config import ModelManager
        test_manager = ModelManager()
        test_manager.load_config("test_config.json")
        logger.success("   ✓ Конфигурация загружена")
        
        # Проверить
        assert test_manager.config.chat_model_gemini == model_manager.config.chat_model_gemini
        logger.success("   ✓ Данные совпадают")
        
        # Удалить тестовый файл
        import os
        os.remove("test_config.json")
        logger.success("   ✓ Тестовый файл удален")
        
    except Exception as e:
        logger.error(f"   ✗ Ошибка: {e}")
    
    # 5. Тест получения моделей от API (если ключи настроены)
    logger.info("\n5. Тест получения моделей от API:")
    
    # Установить ключи из env если есть
    import os
    gemini_key = os.getenv("GEMINI_API_KEY")
    grok_key = os.getenv("GROK_API_KEY")
    
    if gemini_key or grok_key:
        model_manager.set_api_keys(gemini_key, grok_key)
        
        try:
            await model_manager.refresh_models()
            
            if gemini_key:
                gemini_models = model_manager.get_available_models('gemini')
                logger.success(f"   ✓ Gemini: {len(gemini_models)} моделей получено")
            
            if grok_key:
                grok_models = model_manager.get_available_models('grok')
                logger.success(f"   ✓ Grok: {len(grok_models)} моделей получено")
                
        except Exception as e:
            logger.warning(f"   ⚠ Не удалось получить модели: {e}")
    else:
        logger.warning("   ⚠ API ключи не настроены, пропускаем тест")
    
    logger.info("\n=== Тест завершен ===")

if __name__ == "__main__":
    asyncio.run(test_model_selection())
