#!/usr/bin/env python3
"""
Тест RAG системы и проверка стабильности работы
"""
import sys
import os
from pathlib import Path

# Добавляем корневую директорию в путь
sys.path.insert(0, str(Path(__file__).parent))

# Настройка Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')
import django
django.setup()

from loguru import logger
from app.rag.engine import RAGEngine
from app.rag.inmemory_rag import InMemoryRAG

def test_rag_initialization():
    """Тест инициализации RAG системы"""
    logger.info("=" * 60)
    logger.info("Тест 1: Инициализация RAG Engine")
    logger.info("=" * 60)
    
    try:
        rag = RAGEngine()
        
        if not rag.available:
            logger.error("❌ RAG система недоступна")
            return False
        
        logger.success(f"✅ RAG Engine инициализирован успешно")
        logger.info(f"   - Используется: {'Qdrant' if rag.use_qdrant else 'InMemoryRAG'}")
        logger.info(f"   - Доступность: {rag.available}")
        
        return True
    except Exception as e:
        logger.error(f"❌ Ошибка инициализации RAG: {e}")
        return False


def test_add_text():
    """Тест добавления текста в RAG"""
    logger.info("=" * 60)
    logger.info("Тест 2: Добавление текста в RAG")
    logger.info("=" * 60)
    
    try:
        rag = RAGEngine()
        
        if not rag.available:
            logger.error("❌ RAG система недоступна для теста")
            return False
        
        test_texts = [
            ("Python - это язык программирования", "test_source_1"),
            ("Django - веб-фреймворк для Python", "test_source_2"),
            ("RAG - Retrieval Augmented Generation", "test_source_3"),
        ]
        
        doc_ids = []
        for text, source in test_texts:
            doc_id = rag.add_text(text, source)
            if doc_id:
                logger.success(f"✅ Добавлен документ: {doc_id[:8]}... (source: {source})")
                doc_ids.append(doc_id)
            else:
                logger.error(f"❌ Не удалось добавить документ: {text[:30]}...")
                return False
        
        logger.info(f"   Всего добавлено документов: {len(doc_ids)}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка при добавлении текста: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_query():
    """Тест запросов к RAG"""
    logger.info("=" * 60)
    logger.info("Тест 3: Запросы к RAG системе")
    logger.info("=" * 60)
    
    try:
        rag = RAGEngine()
        
        if not rag.available:
            logger.error("❌ RAG система недоступна для теста")
            return False
        
        test_queries = [
            "Что такое Python?",
            "Веб-фреймворк Django",
            "RAG система",
        ]
        
        for query in test_queries:
            logger.info(f"   Запрос: '{query}'")
            results = rag.query(query, n_results=3)
            
            documents = results.get('documents', [[]])
            metadatas = results.get('metadatas', [[]])
            
            if documents and documents[0]:
                logger.success(f"✅ Найдено результатов: {len(documents[0])}")
                for i, (doc, meta) in enumerate(zip(documents[0], metadatas[0]), 1):
                    score = meta.get('score', 'N/A')
                    source = meta.get('source', 'unknown')
                    logger.info(f"      {i}. Score: {score:.4f if isinstance(score, float) else score}, Source: {source}")
                    logger.info(f"         Text: {doc[:60]}...")
            else:
                logger.warning(f"⚠️  Нет результатов для запроса: '{query}'")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка при запросе: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_get_documents():
    """Тест получения документов"""
    logger.info("=" * 60)
    logger.info("Тест 4: Получение списка документов")
    logger.info("=" * 60)
    
    try:
        rag = RAGEngine()
        
        if not rag.available:
            logger.error("❌ RAG система недоступна для теста")
            return False
        
        documents = rag.get_documents(limit=10)
        
        logger.success(f"✅ Получено документов: {len(documents)}")
        
        for i, doc in enumerate(documents[:5], 1):  # Показываем первые 5
            doc_id = doc.get('id', 'N/A')
            source = doc.get('source', 'unknown')
            text_preview = doc.get('text', '')[:50]
            logger.info(f"   {i}. ID: {doc_id[:8] if isinstance(doc_id, str) else doc_id}..., Source: {source}")
            logger.info(f"      Text: {text_preview}...")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка при получении документов: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_error_handling():
    """Тест обработки ошибок"""
    logger.info("=" * 60)
    logger.info("Тест 5: Обработка ошибок и граничных случаев")
    logger.info("=" * 60)
    
    try:
        rag = RAGEngine()
        
        if not rag.available:
            logger.warning("⚠️  RAG недоступна, пропускаем тесты обработки ошибок")
            return True
        
        # Тест 1: Пустой текст
        logger.info("   Тест: Добавление пустого текста")
        result = rag.add_text("", "empty_test")
        if result is None:
            logger.success("✅ Пустой текст корректно обработан (None)")
        else:
            logger.warning(f"⚠️  Пустой текст вернул ID: {result}")
        
        # Тест 2: Очень длинный текст
        logger.info("   Тест: Добавление длинного текста")
        long_text = "Тест " * 1000
        doc_id = rag.add_text(long_text, "long_text_test")
        if doc_id:
            logger.success(f"✅ Длинный текст добавлен: {doc_id[:8]}...")
        else:
            logger.error("❌ Не удалось добавить длинный текст")
        
        # Тест 3: Запрос с пустой строкой
        logger.info("   Тест: Запрос с пустой строкой")
        results = rag.query("", n_results=1)
        if results:
            logger.success("✅ Пустой запрос обработан без ошибок")
        else:
            logger.warning("⚠️  Пустой запрос вернул пустой результат")
        
        # Тест 4: Запрос с большим количеством результатов
        logger.info("   Тест: Запрос с большим n_results")
        results = rag.query("Python", n_results=100)
        documents = results.get('documents', [[]])
        logger.success(f"✅ Запрос с n_results=100 обработан, найдено: {len(documents[0]) if documents else 0}")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка в тесте обработки ошибок: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_inmemory_rag():
    """Тест InMemoryRAG напрямую"""
    logger.info("=" * 60)
    logger.info("Тест 6: Прямой тест InMemoryRAG")
    logger.info("=" * 60)
    
    try:
        inmemory = InMemoryRAG()
        
        if not inmemory.available:
            logger.error("❌ InMemoryRAG недоступна")
            return False
        
        logger.success("✅ InMemoryRAG инициализирован")
        
        # Добавление
        doc_id = inmemory.add_text("Тестовый документ для InMemoryRAG", "direct_test")
        if doc_id:
            logger.success(f"✅ Документ добавлен: {doc_id[:8]}...")
        else:
            logger.error("❌ Не удалось добавить документ")
            return False
        
        # Запрос
        results = inmemory.query("Тестовый", n_results=1)
        documents = results.get('documents', [[]])
        if documents and documents[0]:
            logger.success(f"✅ Запрос выполнен, найдено: {len(documents[0])}")
        else:
            logger.warning("⚠️  Запрос не вернул результатов")
        
        # Получение всех документов
        all_docs = inmemory.get_all_documents()
        logger.success(f"✅ Всего документов в InMemoryRAG: {len(all_docs)}")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка в тесте InMemoryRAG: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_stability():
    """Тест стабильности - множественные операции"""
    logger.info("=" * 60)
    logger.info("Тест 7: Стабильность работы (множественные операции)")
    logger.info("=" * 60)
    
    try:
        rag = RAGEngine()
        
        if not rag.available:
            logger.error("❌ RAG система недоступна для теста")
            return False
        
        # Множественные добавления
        logger.info("   Выполнение 10 последовательных добавлений...")
        success_count = 0
        for i in range(10):
            text = f"Тестовый документ номер {i+1} для проверки стабильности"
            doc_id = rag.add_text(text, f"stability_test_{i+1}")
            if doc_id:
                success_count += 1
        
        logger.success(f"✅ Успешно добавлено: {success_count}/10")
        
        # Множественные запросы
        logger.info("   Выполнение 10 последовательных запросов...")
        query_success = 0
        for i in range(10):
            try:
                results = rag.query(f"документ {i+1}", n_results=3)
                if results:
                    query_success += 1
            except Exception as e:
                logger.warning(f"⚠️  Ошибка в запросе {i+1}: {e}")
        
        logger.success(f"✅ Успешно выполнено запросов: {query_success}/10")
        
        # Получение документов
        logger.info("   Получение документов...")
        docs = rag.get_documents(limit=20)
        logger.success(f"✅ Получено документов: {len(docs)}")
        
        return success_count >= 8 and query_success >= 8  # Допускаем 2 ошибки
        
    except Exception as e:
        logger.error(f"❌ Ошибка в тесте стабильности: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Главная функция тестирования"""
    logger.info("🚀 Начало тестирования RAG системы")
    logger.info("")
    
    results = {}
    
    # Запуск всех тестов
    results['initialization'] = test_rag_initialization()
    logger.info("")
    
    results['add_text'] = test_add_text()
    logger.info("")
    
    results['query'] = test_query()
    logger.info("")
    
    results['get_documents'] = test_get_documents()
    logger.info("")
    
    results['error_handling'] = test_error_handling()
    logger.info("")
    
    results['inmemory_rag'] = test_inmemory_rag()
    logger.info("")
    
    results['stability'] = test_stability()
    logger.info("")
    
    # Итоговый отчет
    logger.info("=" * 60)
    logger.info("ИТОГОВЫЙ ОТЧЕТ")
    logger.info("=" * 60)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"{status}: {test_name}")
    
    logger.info("")
    logger.info(f"Пройдено тестов: {passed}/{total}")
    
    if passed == total:
        logger.success("🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!")
        print("<promise>PASS</promise>")
        return 0
    else:
        logger.error(f"❌ ПРОВАЛЕНО ТЕСТОВ: {total - passed}")
        print("<promise>FAIL</promise>")
        return 1


if __name__ == "__main__":
    exit(main())
