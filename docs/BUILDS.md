# Две сборки: mini и full

Проект поддерживает две сборки, чтобы не тянуть лишние зависимости для тестов и быстрого старта.

## Mini (по умолчанию)

**Файл зависимостей:** `requirements-mini.txt` (или `pip install -r requirements.txt`).

**Входит:**
- Чат, оркестратор, агенты (ReAct, Ralph и т.д.), задачи, пароли, серверы
- PostgreSQL/SQLite, LLM (Gemini/Grok), MCP, инструменты (SSH, веб, файлы)
- Лёгкая обработка файлов: Pillow, PyPDF2 (без OCR, без DOCX, без pdfplumber)

**Не входит:**
- Модели эмбеддингов (sentence-transformers) и PyTorch
- Qdrant-клиент
- pytesseract (OCR), python-docx, pdfplumber
- nicegui (desktop-режим)

**RAG:** в мини-сборке RAG недоступен. В разделах Knowledge Base и в чате показывается подсказка: для использования RAG нужна полная сборка. Переключатель RAG в чате отключён.

**Когда использовать:** быстрые тесты, CI, деплой без тяжёлых зависимостей, проверка логики без скачивания моделей.

---

## Full (полная)

**Файл зависимостей:** `requirements-full.txt` (`pip install -r requirements-full.txt`).

**Всё из mini плюс:**
- **RAG:** sentence-transformers, qdrant-client, эмбеддинги и база знаний
- **Обработка файлов:** pytesseract (OCR), python-docx, pdfplumber
- **UI:** nicegui

**Когда использовать:** когда нужны RAG, загрузка документов в базу знаний, семантический поиск, OCR и расширенная обработка PDF/DOCX.

---

## Установка

```bash
# Мини (по умолчанию)
pip install -r requirements.txt
# или
pip install -r requirements-mini.txt

# Полная
pip install -r requirements-full.txt
```

---

## Docker

По умолчанию образ собирается как **mini**:

```bash
docker compose up --build
```

Полная сборка (RAG, PyTorch, модели эмбеддингов):

```bash
WEU_BUILD=full docker compose up --build
```

Или в `.env`:

```env
WEU_BUILD=full
```

Подробнее — в [README](../README.md) и [QUICK_START](../QUICK_START.md).
