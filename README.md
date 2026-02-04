<p align="center">
  <img src="https://img.shields.io/badge/WEU-AI%20Agent%20Platform-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="WEU" />
</p>

<h1 align="center">🤖 WEU AI Agent Platform</h1>
<p align="center">
  <strong>Единая веб-платформа для автоматизации DevOps и IT</strong>
</p>
<p align="center">
  Чат с AI • Задачи в стиле Jira • SSH-серверы • Агенты (Cursor, Claude, Ralph) • RAG • Пароли
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-8B5CF6?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/edition-DevOps%20%2F%20IT-6366f1?style=flat-square" alt="Edition" />
  <img src="https://img.shields.io/badge/python-3.10+-3776ab?style=flat-square&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/django-5.2-092e20?style=flat-square&logo=django&logoColor=white" alt="Django" />
  <img src="https://img.shields.io/badge/docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License" />
</p>

---

## ✨ О проекте

**WEU** — это не просто чат с нейросетью. Это **единый центр управления**: вы общаетесь с AI (Gemini, Grok), ставите задачи с проектами и спринтами, дергаете команды на серверах по SSH, запускаете тяжёлых агентов (Cursor, Claude Code, Ralph) по воркфлоу и храните знания в RAG — всё из одного веб-интерфейса.

- **Для кого:** DevOps, SRE, команды, которые хотят автоматизировать рутину и делегировать часть задач AI.
- **Что даёт:** один портал вместо разрозненных скриптов, Jira, терминалов и чатов.

---

## 🚀 Ключевые возможности

| | Модуль | Что умеет |
|---|--------|-----------|
| 💬 | **Chat** | Чат с Gemini/Grok, стриминг ответов, несколько сессий, загрузка файлов, выбор моделей |
| 🧠 | **Orchestrator** | ReAct-цикл (мысль → действие → наблюдение), визуализация решений AI, вызов инструментов |
| 📋 | **Tasks** | Проекты, спринты, команды, доски Kanban, ключи WEU-123, AI-анализ и делегирование задач AI, уведомления и email |
| 🖥️ | **Servers** | Список SSH-серверов, группы, выполнение команд, **интерактивный терминал в браузере** (WebSocket), AI прямо в терминале |
| 🤖 | **Agent Hub** | Профили агентов, воркфлоу, запуск Cursor / Claude Code / Ralph в headless, кастомные агенты, MCP |
| 📚 | **RAG** | База знаний: загрузка документов, семантический поиск (Qdrant или InMemory) |
| 🔐 | **Passwords** | Менеджер учётных записей с AES-256, категории и теги |
| 👥 | **Доступ** | Пользователи, группы, роли в проектах (Owner/Admin/Member/Viewer), права на задачи и серверы |

Подробный список фич — в [docs/FEATURES.md](docs/FEATURES.md).

---

## 📸 Презентация

**WEU AI Agent Platform — DevOps Edition** — слайды доступны по ссылкам (после добавления PNG в репозиторий откроются превью на GitHub):

| Слайды 1–4 | Слайды 5–8 | Слайды 9–12 |
|------------|------------|-------------|
| [Слайд 1](docs/images/presentation-01.png) · [2](docs/images/presentation-02.png) · [3](docs/images/presentation-03.png) · [4](docs/images/presentation-04.png) | [Слайд 5](docs/images/presentation-05.png) · [6](docs/images/presentation-06.png) · [7](docs/images/presentation-07.png) · [8](docs/images/presentation-08.png) | [Слайд 9](docs/images/presentation-09.png) · [10](docs/images/presentation-10.png) · [11](docs/images/presentation-11.png) · [12](docs/images/presentation-12.png) |

Чтобы здесь отображались превью слайдов, экспортируйте страницы PDF в PNG и положите в [`docs/images/`](docs/images/) с именами `presentation-01.png` … `presentation-12.png`. Инструкция: [docs/images/README.md](docs/images/README.md).

---

## 🛠 Стек

<table>
<tr>
<td width="50%">

**Backend**
- Django 5.2 + Daphne (ASGI)
- PostgreSQL / SQLite
- Redis (по необходимости)
- Celery (фоновые задачи)

**AI & ML**
- Google Gemini API
- Grok API
- sentence-transformers (RAG, full build)
- Qdrant или InMemory (векторный поиск)

</td>
<td width="50%">

**Frontend**
- Django Templates
- Vanilla JS, стриминг (SSE/fetch)
- Адаптивная вёрстка (desktop + mobile)

**Инфраструктура**
- Docker & Docker Compose
- Nginx (reverse proxy, HTTPS)
- GitHub Actions (CI/CD)

**Интеграции**
- Jira (импорт/синхронизация задач)
- MCP (Model Context Protocol)

</td>
</tr>
</table>

---

## 🏗 Архитектура (упрощённо)

```
┌─────────────────────────────────────────────────────────────┐
│                    Web (Django + Daphne)                     │
│   Chat • Tasks • Servers • Agents • RAG • Passwords • Admin   │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                  Orchestrator (ReAct / Ralph)                 │
│   Think → Act (tools) → Observe → repeat or finish           │
└──────────────┬────────────────────────────┬──────────────────┘
               │                            │
    ┌──────────▼──────────┐      ┌─────────▼─────────┐
    │   LLM (Gemini/Grok) │      │   Tool Manager    │
    └────────────────────┘      │ SSH • Servers •   │
                                │ Files • Tasks •   │
                                │ Web • MCP tools   │
                                └───────────────────┘
```

Подробнее: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## ⚡ Быстрый старт

### Docker (рекомендуется)

```bash
git clone https://github.com/your-repo/weu-ai-platform.git
cd weu-ai-platform
cp .env.example .env
# В .env добавь: GEMINI_API_KEY, GROK_API_KEY (и при необходимости POSTGRES_*, MASTER_PASSWORD)
docker compose up --build
```

Открой **http://localhost** (порт задаётся через `WEU_PORT` в `.env`).

### Локально (Python)

```bash
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate      # Linux / Mac
pip install -r requirements.txt   # mini (без RAG)
# pip install -r requirements-full.txt  # full + RAG
cp .env.example .env
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

По умолчанию приложение на порту **9000** (или `DJANGO_PORT` из `.env`).

---

## ⚙️ Конфигурация

**Минимум в `.env`:**
- `GEMINI_API_KEY`, `GROK_API_KEY` — для чата и агентов
- `MASTER_PASSWORD` — для расшифровки паролей серверов и менеджера паролей

**Опционально:**
- `POSTGRES_*` — если нужна PostgreSQL вместо SQLite
- `WEU_BUILD=full` — полная сборка с RAG (sentence-transformers, Qdrant)
- `JIRA_URL`, `JIRA_API_TOKEN`, `JIRA_EMAIL` — интеграция с Jira
- `CURSOR_API_KEY` — для headless Cursor CLI

Модели (Gemini/Grok) настраиваются в `.model_config.json` или через веб-настройки.

Подробнее: [docs/QUICK_START_DEVOPS.md](docs/QUICK_START_DEVOPS.md), [docs/HTTPS_SETUP.md](docs/HTTPS_SETUP.md).

---

## 📖 Документация

| Документ | Описание |
|---------|----------|
| [docs/FEATURES.md](docs/FEATURES.md) | Полный список возможностей и фич |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектура и компоненты |
| [docs/QUICK_START_DEVOPS.md](docs/QUICK_START_DEVOPS.md) | Быстрый старт для DevOps |
| [docs/MODEL_SELECTION.md](docs/MODEL_SELECTION.md) | Выбор и настройка моделей |
| [docs/HTTPS_SETUP.md](docs/HTTPS_SETUP.md) | Настройка HTTPS (certbot) |

---

## 🔒 Безопасность

- Аутентификация Django, разграничение доступа по пользователям и группам
- Пароли серверов и менеджера паролей — AES-256 (ключ из `MASTER_PASSWORD`)
- Блокировка опасных команд при выполнении по SSH (`rm -rf`, `mkfs`, `shutdown`, `systemctl stop` и т.п.)
- CSRF-защита, изоляция данных по `user_id`

---

## 🤝 Участие в разработке

1. Сделай fork репозитория
2. Создай ветку: `git checkout -b feature/название-фичи`
3. Закоммить: `git commit -m 'Добавлена фича: название'`
4. Запушь: `git push origin feature/название-фичи`
5. Открой Pull Request

---

## 📄 Лицензия

Проект распространяется под лицензией **MIT**. Подробности — в файле [LICENSE](LICENSE).

---

<p align="center">
  <sub>WEU AI Agent Platform · Version 2.0.0 · DevOps/IT Edition</sub>
</p>
