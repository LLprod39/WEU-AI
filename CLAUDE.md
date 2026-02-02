# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WEU AI Agent Platform - a Django-based web application for DevOps/IT task automation. Integrates multiple AI agents (Claude Code, Cursor, Ralph) with SSH server management, task execution, and a knowledge base (RAG).

**Version:** 2.0.0 - DevOps/IT Edition
**Stack:** Django 5.2 + Daphne (ASGI), PostgreSQL/SQLite, Qdrant (vector DB), Redis

## Common Commands

```bash
# Docker (recommended for production)
docker compose up --build           # Build and run full stack
docker compose logs -f web          # Follow web container logs
docker exec weu-web python manage.py migrate  # Run migrations in container

# Local development (Linux/Mac)
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt           # Mini build (no RAG)
pip install -r requirements-full.txt      # Full build with RAG
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver                # Default port: 9000 (via DJANGO_PORT env or manage.py)

# Local development (Windows)
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver

# Database
python manage.py makemigrations <app_name>
python manage.py migrate

# Run tests (Django test framework)
python manage.py test <app_name>          # Run tests for specific app
python manage.py test                     # Run all tests
```

## Build Variants

- **Mini build** (`requirements.txt`): No PyTorch, no heavy RAG models, faster startup
- **Full build** (`requirements-full.txt`): Includes sentence-transformers, PyTorch, full RAG

Set `WEU_BUILD=mini` or `WEU_BUILD=full` in `.env`.

## Architecture

```
User Interface (Django Templates)
        │
        ▼
Orchestrator Layer (ReAct loop, RAG, Tools)
        │
   ┌────┴────┐
   ▼         ▼
LLM Provider    Tool Manager
(Gemini/Grok)   (Built-in + MCP)
```

### Key Patterns

**ReAct Loop** (`app/core/orchestrator.py`): Think → Act → Observe → Repeat. Provides transparency in AI decision-making.

**Multi-Provider LLM** (`app/core/llm.py`): Abstracts Gemini and Grok APIs. `ModelManager` handles configuration. Retry logic with exponential backoff.

**Agent Polymorphism** (`app/agents/`): Base class `BaseAgent` with implementations: SimpleAgent, ComplexAgent, ReactAgent, ClaudeCodeAgent, RalphAgent. Internal (LLM) or CLI-based.

**CLI Runtime** (`app/agents/cli_runtime.py`): Orchestrates Cursor CLI and Claude Code CLI in headless mode with JSON streaming. Configuration in `web_ui/settings.py` under `CLI_RUNTIME_CONFIG`. Note: Only `cursor` and `claude` are CLI agents. Ralph is NOT a CLI - it's an internal Python agent using iterative LLM calls (`app/core/modes/ralph_internal_mode.py`).

**Tool Safety** (`app/tools/safety.py`): Blocks dangerous shell patterns via regex: `rm -rf`, `mkfs`, `dd if=`, `shutdown`, `reboot`, `systemctl stop/disable/mask`, `service stop`, `truncate -s 0`.

## Directory Structure

```
app/                    # Core AI/orchestration layer
├── agents/            # Agent implementations (base, simple, complex, react, cli)
├── core/              # LLM provider, orchestrator, model config, smart router
├── rag/               # RAG engine (Qdrant or InMemory fallback)
├── tools/             # Built-in tools (SSH, filesystem, server, web)
└── mcp/               # Model Context Protocol client

core_ui/               # Main web interface (views, templates, static)
agent_hub/             # Agent profiles, workflows, execution logs
tasks/                 # Task management with AI analysis and Jira integration
servers/               # SSH server management
passwords/             # Password manager (AES-256 encryption)
web_ui/                # Django project settings
```

## Key Configuration

**Environment Variables** (`.env`):
- `GEMINI_API_KEY`, `GROK_API_KEY` - LLM credentials
- `CURSOR_API_KEY` - Cursor CLI headless authentication
- `POSTGRES_*` - Database connection (if not set, uses SQLite)
- `MASTER_PASSWORD` - Server password decryption key
- `WEU_BUILD` - Build type (mini/full)

**Model Configuration** (`.model_config.json`):
```json
{
  "chat_model_gemini": "gemini-2.0-flash-exp",
  "agent_model_gemini": "gemini-2.0-flash-exp",
  "default_provider": "gemini"
}
```

**CLI Runtime** (`web_ui/settings.py`):
- `CLI_RUNTIME_TIMEOUT_SECONDS` - Max process runtime (default 600s)
- `CLI_FIRST_OUTPUT_TIMEOUT_SECONDS` - Timeout for first output (default 120s)
- `CLI_RUNTIME_CONFIG` - Configuration for cursor, claude, ralph CLIs

## Database

- **SQLite**: Default for local development (no config needed)
- **PostgreSQL**: Production (set `POSTGRES_HOST` in `.env`)

Django apps with models: `core_ui`, `agent_hub`, `tasks`, `servers`, `passwords`

## Cursor CLI Integration

**Model always forced to `auto`** - user cannot override via UI or config. The `model` is in `allowed_args` but is filtered/overridden to `auto` in `agent_hub/views.py`.

Available args in `CLI_RUNTIME_CONFIG["cursor"]["allowed_args"]`: `model`, `sandbox`, `approve-mcps`, `browser`.

Headless mode uses `--output-format stream-json --stream-partial-output`.

Two CLI modes available:
- `cursor` - Agent mode with `--force` for file modifications
- `cursor_plan` - Planning mode with `--mode=plan` for analysis without changes

## Claude Code CLI Integration

Headless mode requires specific flags in `CLI_RUNTIME_CONFIG["claude"]["args"]`:
- `-p` - Print mode (non-interactive)
- `--verbose` - Required for stream-json output
- `--output-format stream-json` - JSON streaming
- `--include-partial-messages` - Show progress
- `--dangerously-skip-permissions` - Skip confirmations in headless mode
- `--debug mcp` - Required for MCP servers to work correctly

**MCP Server** (`mcp_server.py`): Standalone MCP server for server_execute and servers_list tools. Uses lazy Django initialization for fast startup. Generated MCP config uses this instead of `manage.py mcp_servers` (Django management command is too slow to initialize).

## Important Files

- `web_ui/settings.py` - Django configuration, CLI runtime config
- `mcp_server.py` - Standalone MCP server for Claude Code integration
- `app/core/llm.py` - LLM provider implementation
- `app/core/orchestrator.py` - ReAct loop implementation
- `app/agents/cli_runtime.py` - External CLI agent execution
- `core_ui/views.py` - Main web views (chat, orchestrator, settings)
- `agent_hub/views.py` - Agent execution, workflows, MCP config generation
- `tasks/views.py` - Task management

## Security Considerations

- **Password encryption**: AES-256 in `passwords/` app, requires `MASTER_PASSWORD` env var for decryption
- **SSH connections**: Credentials stored encrypted, decrypted at runtime for server connections
- **Tool execution**: Commands validated against dangerous patterns before SSH execution
- **User isolation**: Data scoped by user ID (servers, passwords, tasks)

## Documentation

- `docs/ARCHITECTURE.md` - System architecture diagrams
- `docs/QUICK_START_DEVOPS.md` - DevOps setup guide
- `docs/MODEL_SELECTION.md` - LLM model configuration
- `docs/HTTPS_SETUP.md` - HTTPS with certbot
- `.cursor/docs/cursor-agent-cli-args.md` - Cursor CLI argument reference
