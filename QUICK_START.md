# Быстрый старт

## Вариант 1: Один запуск в Docker

```bash
docker compose up --build
```

Открой `http://localhost:8000`. **Логин и пароль:** при первом старте автоматически создаётся пользователь **admin** / **admin** (если в `.env` не заданы `DJANGO_SUPERUSER_USERNAME` и `DJANGO_SUPERUSER_PASSWORD`). Для продакшена задай в `.env` свои значения.

Поднимаются контейнеры: **postgres**, **qdrant**, **web**, **agent-runner**. Контейнер `weu-agent-runner` предназначен для запуска агентов (Cursor CLI / Ralph); общая папка воркспейсов — volume `agent_projects_data`.

**Cursor CLI в Docker без входа по Google:** создай API-ключ в [Cursor → Settings → API Access](https://cursor.com/settings) (или Dashboard → Background Agents). В `.env` добавь строку `CURSOR_API_KEY=твой_ключ`. Тогда агенты Cursor CLI работают headless, без интерактивного логина и без промптов в браузере.

По умолчанию используется **mini**-сборка (без RAG, без PyTorch). Для полной версии с RAG: `WEU_BUILD=full docker compose up --build` или добавь в `.env`: `WEU_BUILD=full`. Подробнее: [docs/BUILDS.md](docs/BUILDS.md).

---

## Вариант 2: Локально (без Docker)

## Шаг 1: Установка зависимостей

По умолчанию ставится **мини**-сборка (для тестов, без RAG и тяжёлых моделей):

```bash
pip install -r requirements.txt
```

Для **полной** сборки (RAG, эмбеддинги, OCR, DOCX, pdfplumber):

```bash
pip install -r requirements-full.txt
```

См. [docs/BUILDS.md](docs/BUILDS.md).

## Шаг 2: База данных (MVP — рекомендуется PostgreSQL)

Для нормальной работы при нескольких пользователях и активных агентах используйте **PostgreSQL** (SQLite блокируется при параллельных запросах).

### Вариант A: PostgreSQL через Docker

```bash
docker compose up -d postgres
```

В `.env` добавьте (значения по умолчанию уже в docker-compose):

```env
POSTGRES_HOST=localhost
POSTGRES_PASSWORD=weu_secret_change_me
```

Подробнее: [docs/DATABASE.md](docs/DATABASE.md).

### Вариант B: Только SQLite (без Docker)

Ничего не добавляйте в `.env` — будет использоваться `db.sqlite3`. Подходит для первого знакомства; при нагрузке возможны задержки.

## Шаг 3: Настройка переменных окружения

Создайте или дополните файл `.env` в корне проекта:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GROK_API_KEY=your_grok_api_key_here
```

При использовании PostgreSQL — см. шаг 2.

## Шаг 4: Применение миграций

```bash
python manage.py migrate
```

## Шаг 5: Создание суперпользователя

```bash
python manage.py createsuperuser
```

Следуйте инструкциям для создания учетной записи администратора.

## Шаг 6: Запуск сервера

```bash
python manage.py runserver
```

## Шаг 7: Доступ к приложению

Откройте браузер и перейдите по адресу:
```
http://127.0.0.1:8000
```

Войдите с учетными данными суперпользователя.

## Опционально: Запуск Qdrant для RAG

Если хотите использовать Qdrant вместо InMemory RAG:

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Система автоматически определит доступность Qdrant и переключится на него.

## Основные функции

### Чат с AI
- Перейдите на главную страницу (Chat)
- Выберите модель (Gemini/Grok)
- Задавайте вопросы или давайте задачи
- Загружайте файлы через drag-and-drop

### Задачи
- Перейдите в раздел "Tasks"
- Создавайте задачи с приоритетами и метками
- Используйте AI для анализа и улучшения задач

### Пароли
- Перейдите в раздел "Passwords"
- Сохраняйте учетные данные с шифрованием
- Используйте генератор паролей

### Серверы
- Перейдите в раздел "Servers"
- Добавляйте SSH серверы
- Тестируйте подключения и выполняйте команды

### Агенты
Доступны через API:
- ReAct Agent - для сложных задач с инструментами
- Simple Agent - для простых вопросов
- Complex Agent - с планированием
- Ralph Wiggum Agent - итеративный самоулучшающийся

## Проблемы?

1. **Ошибки миграций:** Убедитесь, что все миграции применены: `python manage.py migrate`
2. **Ошибки импорта:** Проверьте, что все зависимости установлены: `pip install -r requirements.txt`
3. **RAG не работает:** Проверьте доступность Qdrant или используйте InMemory режим
4. **Агенты не работают:** Проверьте API ключи в `.env` файле

## Дополнительная информация

См. `IMPLEMENTATION_SUMMARY.md` для полного описания реализованных функций.
