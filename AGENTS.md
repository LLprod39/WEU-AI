# Repository Guidelines

## Project Structure & Module Organization
This is a Django 5.2 monorepo centered on `web_ui/` (settings, ASGI/WSGI, routing). Core app modules:
- `core_ui/`: shared UI pages, templates, static assets, auth/access views.
- `tasks/`, `servers/`, `skills/`, `agent_hub/`, `passwords/`: feature apps with models, views, URLs, templates, migrations.
- `app/`: orchestration, tools, agents, RAG, integrations, service-layer logic.
- `tests/`: cross-module pytest suite.
- `docs/`, `scripts/`, `docker/`: documentation, utility scripts, deployment/runtime configs.

Keep new code inside the closest existing Django app; avoid creating top-level packages unless cross-cutting.

## Build, Test, and Development Commands
- `python -m venv venv && venv\Scripts\activate`: create/activate local virtualenv (Windows).
- `pip install -r requirements.txt`: install default (mini) dependencies.
- `pip install -r requirements-full.txt`: install full stack (RAG/embeddings extras).
- `python manage.py migrate`: apply database migrations.
- `python manage.py runserver`: start dev server (defaults to `DJANGO_PORT` or `9000`).
- `pytest`: run test suite with Django settings from `pyproject.toml`.
- `ruff check .` and `ruff format .`: lint and format Python code.
- `pre-commit run --all-files`: run hooks before pushing.
- `docker compose up --build`: run full containerized stack.

## Coding Style & Naming Conventions
Use Python 3.10+ and 4-space indentation. Ruff is the source of truth (`line-length = 120`, double quotes, import sorting enabled).  
Naming:
- modules/files/functions: `snake_case`
- classes: `PascalCase`
- constants/env keys: `UPPER_SNAKE_CASE`
- Django templates: group by app (`tasks/templates/tasks/...`, `servers/templates/servers/...`).

## Testing Guidelines
Frameworks: `pytest`, `pytest-django`, `pytest-asyncio`.  
File names must match `test_*.py` or `*_test.py`. Place app-specific tests in `tests/` unless co-located tests are necessary.  
Run targeted tests during development (example: `pytest tests/test_tasks_permissions.py -v`) and full `pytest` before opening a PR.

## Commit & Pull Request Guidelines
Follow existing history patterns: concise, scoped subjects like `fix(ui): ...`, `feat(workflow): ...`, or `servers: ...`.  
PRs should include:
- what changed and why
- impacted apps/modules
- migration notes (`python manage.py makemigrations` output) if models changed
- test evidence (commands + result)
- screenshots/GIFs for template/static UI changes.

## Security & Configuration Tips
Never commit secrets from `.env` (`GEMINI_API_KEY`, `GROK_API_KEY`, `MASTER_PASSWORD`, etc.).  
Prefer local `.env` overrides and sanitized examples in docs. Validate dangerous server/tool actions through existing safety checks in `app/tools/safety.py`.
