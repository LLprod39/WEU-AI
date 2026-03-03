# Repository Guidelines

## Project Structure & Module Organization
This repository is a Django 5.2 monorepo. Core configuration lives in `web_ui/` (settings, ASGI/WSGI, root URLs). Feature apps include `core_ui/`, `tasks/`, `servers/`, `skills/`, `agent_hub/`, and `passwords/` (models, views, URLs, templates, migrations).  
Service and orchestration logic is in `app/` (agents, tools, integrations, RAG).  
Shared tests are in `tests/`; docs and operations assets are in `docs/`, `scripts/`, and `docker/`.

## Build, Test, and Development Commands
- `python -m venv venv && venv\Scripts\activate`: create and activate a local virtual environment (Windows).
- `pip install -r requirements.txt`: install base dependencies.
- `pip install -r requirements-full.txt`: install full stack extras (embeddings/RAG-related packages).
- `python manage.py migrate`: apply database migrations.
- `python manage.py runserver`: start local development server (`DJANGO_PORT` or `9000`).
- `pytest`: run the full test suite.
- `ruff check .` and `ruff format .`: lint and format code.
- `pre-commit run --all-files`: run all configured quality hooks.

## Coding Style & Naming Conventions
Use Python 3.10+ with 4-space indentation and double quotes. Ruff is the formatting/linting source of truth (`line-length = 120`, import sorting enabled).  
Naming rules:
- `snake_case`: modules, files, functions
- `PascalCase`: classes
- `UPPER_SNAKE_CASE`: constants/environment keys  
Keep templates grouped by app, e.g., `tasks/templates/tasks/...`.

## Testing Guidelines
Testing uses `pytest`, `pytest-django`, and `pytest-asyncio`.  
Test files must match `test_*.py` or `*_test.py`.  
Prefer focused runs while developing (example: `pytest tests/test_tasks_permissions.py -v`), then run full `pytest` before submitting changes.

## Commit & Pull Request Guidelines
Use concise, scoped commit subjects. Current history favors scope prefixes such as `servers: ...` and `core_ui: ...`; `fix(scope): ...` and `feat(scope): ...` are also acceptable when clear.  
PRs should include:
- what changed and why
- impacted apps/modules
- migration notes (if models changed)
- test evidence (commands and outcomes)
- screenshots/GIFs for UI/template updates

## Security & Configuration Tips
Do not commit secrets from `.env` (API keys, passwords, tokens). Use local overrides and sanitized examples in docs.  
For server/tool execution paths, keep existing safety checks in `app/tools/safety.py` intact and extend them when adding risky actions.
