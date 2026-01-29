# 🤖 WEU AI Agent Platform

**Интегрированная веб-платформа для работы с AI-агентами**

Единый интерфейс для чата с LLM, оркестрации агентов, управления задачами, паролями и серверами.

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![Django](https://img.shields.io/badge/Django-5.2-green.svg)
![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## ✨ Основные возможности

| Модуль | Описание |
|--------|----------|
| **Chat** | Чат с AI (Gemini/Grok), переключение моделей, загрузка файлов |
| **Orchestrator** | ReAct-цикл с визуализацией «мысль → действие → ответ» |
| **Agent Hub** | Профили агентов, проекты, воркфлоу, запуск CLI-агентов |
| **RAG** | База знаний с семантическим поиском (Qdrant) |
| **Tasks** | Задачи с AI-анализом, подзадачами, интеграцией с агентами |
| **Passwords** | Менеджер паролей с AES-256 шифрованием |
| **Servers** | SSH-управление серверами, выполнение команд |

---

## 🚀 Быстрый старт

### Docker (рекомендуется)

```bash
# Клонировать репозиторий
git clone https://github.com/your-repo/weu-ai-platform.git
cd weu-ai-platform

# Настроить окружение
cp .env.example .env
# Отредактировать .env — добавить API ключи

# Запустить
docker compose up --build
```

Приложение будет доступно по адресу: **http://localhost** (порт 80 по умолчанию; при необходимости задай `WEU_PORT=8000` в `.env`).

### Локальная установка

```bash
# Создать виртуальное окружение
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или
venv\Scripts\activate     # Windows

# Установить зависимости
pip install -r requirements.txt       # Mini build
# или
pip install -r requirements-full.txt  # Full build с RAG

# Настроить окружение
cp .env.example .env
# Отредактировать .env

# Миграции и суперпользователь
python manage.py migrate
python manage.py createsuperuser

# Запуск
python manage.py runserver
```

---

## ⚙️ Конфигурация

### Переменные окружения (.env)

```env
# API ключи (обязательно)
GEMINI_API_KEY=your_gemini_api_key
GROK_API_KEY=your_grok_api_key

# База данных (опционально — по умолчанию SQLite)
POSTGRES_HOST=localhost
POSTGRES_DB=weu_platform
POSTGRES_USER=weu
POSTGRES_PASSWORD=your_password
POSTGRES_PORT=5432

# Django (порт 80 — дефолтный HTTP; если порт 80 занят или нет прав — задай 8000)
DJANGO_PORT=80
WEU_PORT=80
ALLOWED_HOSTS=*
DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_PASSWORD=admin

# Тип сборки
WEU_BUILD=mini  # или 'full' для RAG
```

### Домен не открывается (по IP работает, по домену — нет)

Если по **http://IP** всё открывается, а по **http://weuai.site** — «The content of the page cannot be displayed»: при **только Docker** (без nginx) обнови код на сервере (`git pull`), проверь `.env` (ALLOWED_HOSTS — убери или поставь `*`), перезапусти контейнер (`docker compose restart web`). Подробно: [docs/DOMAIN_NGINX.md](docs/DOMAIN_NGINX.md).

### HTTPS для weuai.site — что делать

Чтобы **https://weuai.site** и **www.weuai.site** открывались без «Небезопасно» и ошибки страницы:

1. На сервере: `cd ~/WEU-AI`, `mkdir -p certbot/www`.
2. Установи certbot: `sudo apt install -y certbot`.
3. Получи серт: `sudo certbot certonly --webroot -w "$(pwd)/certbot/www" -d weuai.site -d www.weuai.site --email твой@email.com --agree-tos --no-eff-email`.
4. В **docker-compose.https.yml** замени в volume nginx конфиг на `./docker/nginx-https.conf` (вместо `nginx-http-first.conf`).
5. Перезапусти nginx: `WEU_PORT=8000 docker compose -f docker-compose.yml -f docker-compose.https.yml restart nginx`.

Подробно по шагам: [docs/HTTPS_SETUP.md](docs/HTTPS_SETUP.md).

### Конфигурация моделей (.model_config.json)

```json
{
  "chat_model_gemini": "gemini-2.0-flash-exp",
  "agent_model_gemini": "gemini-2.0-flash-exp",
  "chat_model_grok": "grok-beta",
  "default_provider": "gemini"
}
```

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────────┐
│         Django Web Interface           │
│  (core_ui, tasks, servers, passwords)  │
└──────────────┬─────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Orchestrator Layer              │
│  (ReAct Loop, Tool Execution, RAG)     │
└──────────────┬─────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐  ┌─────────────┐
│ LLM Provider│  │ Tool Manager│
│(Gemini/Grok)│  │ (Built-in + │
│             │  │    MCP)     │
└─────────────┘  └─────────────┘
```

---

## 📁 Структура проекта

```
web_rA/
├── app/                    # Ядро приложения
│   ├── core/              # Оркестратор, LLM, конфигурация
│   ├── rag/               # RAG-движок
│   ├── tools/             # Встроенные инструменты
│   └── mcp/               # MCP-клиент
├── core_ui/               # Основной веб-интерфейс
├── agent_hub/             # Управление агентами
├── tasks/                 # Система задач
├── passwords/             # Менеджер паролей
├── servers/               # Управление серверами
├── web_ui/                # Django настройки
├── docker-compose.yml     # Docker конфигурация
├── Dockerfile             # Docker образ
└── requirements.txt       # Python зависимости
```

---

## 📖 Документация

- [Полное описание функциональности](DOCUMENTATION.md)
- [Архитектура системы](docs/ARCHITECTURE.md)
- [Руководство по интерфейсу](docs/UI_GUIDE.md)
- [План развития](plan.md)

---

## 🔧 Технологии

**Backend:**
- Django 5.2 + Daphne (ASGI)
- PostgreSQL / SQLite
- Qdrant (векторная БД)

**AI/LLM:**
- Google Gemini API
- Grok API
- sentence-transformers

**Frontend:**
- Django Templates
- Vanilla JavaScript
- Custom CSS (glass-morphism)

**Infrastructure:**
- Docker & Docker Compose
- GitHub Actions (CI/CD)

---

## 🔒 Безопасность

- Django Authentication
- AES-256 шифрование паролей
- CSRF защита
- Изоляция данных по пользователям

---

## 🤝 Вклад в проект

1. Fork репозитория
2. Создайте feature branch (`git checkout -b feature/amazing-feature`)
3. Commit изменения (`git commit -m 'Add amazing feature'`)
4. Push в branch (`git push origin feature/amazing-feature`)
5. Откройте Pull Request

---

## 📄 Лицензия

Распространяется под лицензией MIT. См. `LICENSE` для подробностей.

---

## 📞 Контакты

- **Issues:** [GitHub Issues](https://github.com/your-repo/weu-ai-platform/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-repo/weu-ai-platform/discussions)
