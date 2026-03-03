# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`mini_prod` is a self-contained stripped-down deployment of the WEU AI Agent Platform. It keeps only the `servers` module (SSH/RDP terminal, server groups, AI-in-terminal) and minimal web settings (`core_ui`). Removed vs. the main repo: `tasks`, `agent_hub`, `skills`, `passwords` Django apps, Jira, RAG, and all orchestration/agent endpoints.

**Installed apps:** `daphne`, `channels`, `core_ui`, `servers` + Django builtins.
**URL namespaces:** `core_ui.urls` (auth, settings, API) and `servers.urls`.

## Commands

```bash
# Setup
python -m venv venv && source venv/bin/activate   # Linux/Mac
venv\Scripts\activate                              # Windows
pip install -r requirements-mini.txt

# Migrations and run
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver                         # Default: http://127.0.0.1:8000

# PostgreSQL via Docker (mini_prod has its own docker-compose.yml)
docker compose up -d                               # Starts only postgres
# Then set POSTGRES_HOST=localhost in mini_prod/.env

# Lint / format
ruff check .
ruff format .
```

## Key Differences from Root Project

| Aspect | mini_prod |
|--------|-----------|
| Default port | 8000 (not 9000) |
| INSTALLED_APPS | `core_ui` + `servers` only |
| Requirements | `requirements-mini.txt` (no PyTorch, no RAG) |
| Settings home | `core_ui/views_mini.py` → `settings_mini.html` |
| Channels layer | InMemoryChannelLayer (no Redis needed by default) |

## Architecture

```
web_ui/settings.py     — Django config; CLI_RUNTIME_CONFIG; DB auto-select (SQLite/PG)
web_ui/urls.py         — /admin/, core_ui.urls, servers.urls

core_ui/               — Auth (login/logout), mini settings UI, user/group/permission APIs
  views.py             — dashboard, settings_access, settings_users, API endpoints
  views_mini.py        — settings_home (entry point for /settings/)
  middleware.py        — CsrfTrustNgrokMiddleware, AdminRussianMiddleware, MobileDetectionMiddleware
  domain_auth.py       — DomainAutoLoginMiddleware (SSO via HTTP header)

servers/               — SSH/RDP server management
  models.py            — Server, ServerGroup, ServerGroupTag (with per-group rules/env vars)
  consumers.py         — WebSocket SSH terminal (asyncssh)
  rdp_consumer.py      — WebSocket RDP passthrough (guacd)
  views.py             — Server CRUD, sharing, knowledge

app/core/llm.py        — Multi-provider LLM (Gemini, etc.) used by terminal AI
app/tools/safety.py    — Blocks dangerous shell patterns (rm -rf, mkfs, dd if=, etc.)
app/tools/ssh_tools.py — SSH command execution helpers
app/tools/server_tools.py — Higher-level server operations
```

## Key Configuration (`.env`)

```env
# Database (SQLite used if omitted)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=weu_platform
POSTGRES_USER=weu
POSTGRES_PASSWORD=weu_secret_change_me

# LLM (for terminal AI and settings)
GEMINI_API_KEY=...

# WebSocket channel layer (Redis optional; in-memory used otherwise)
CHANNEL_REDIS_URL=redis://localhost:6379/1

# Domain SSO
DOMAIN_AUTH_ENABLED=true
DOMAIN_AUTH_HEADER=REMOTE_USER

# Hosts / CSRF
ALLOWED_HOSTS=myserver.example.com,localhost
CSRF_TRUSTED_ORIGINS=https://myserver.example.com
```

## WebSocket Routing

`servers/routing.py` provides routes consumed via `web_ui/asgi.py`. Two WebSocket paths:
- SSH: `/ws/servers/<id>/terminal/` → `consumers.TerminalConsumer`
- RDP: `/ws/servers/<id>/rdp/` → `rdp_consumer.RdpConsumer`

## Testing

```bash
pytest                              # All tests (searches tests/ + app subdirs)
pytest tests/test_safety.py -v      # Single file
pytest -k "test_blocked"            # Pattern match
```

Config in `pyproject.toml` under `[tool.pytest.ini_options]`. `DJANGO_SETTINGS_MODULE` is set to `web_ui.settings`.
