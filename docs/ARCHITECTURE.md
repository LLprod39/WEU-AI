# WEU AI Platform - Architecture

## Overview

WEU AI Platform is a Django-based web application for DevOps/IT task automation. It integrates multiple AI agents (Claude Code, Cursor, Ralph) with SSH server management, task execution, and knowledge base (RAG).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WEB INTERFACE                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │   Chat   │  │  Tasks   │  │  Agents  │  │ Servers  │  │ Settings │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
└───────┼─────────────┼─────────────┼─────────────┼─────────────┼────────┘
        │             │             │             │             │
        ▼             ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATION LAYER                               │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  UnifiedOrchestrator                                               │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │ │
│  │  │  ReAct Mode  │  │ Ralph Mode   │  │  CLI Mode    │             │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  RAG Engine  │  │ Tool Manager │  │  LLM Provider │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          AGENT LAYER                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ SimpleAgent  │  │ ComplexAgent │  │  ReActAgent  │  │ RalphAgent │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      CLI Runtime                                  │  │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │   │ Claude Code │  │   Cursor    │  │   Ralph     │              │  │
│  │   │    CLI      │  │    CLI      │  │    CLI      │              │  │
│  │   └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           TOOLS LAYER                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  SSH Tools   │  │ File Tools   │  │ Server Tools │  │  MCP Tools │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Gemini API  │  │   Grok API   │  │ SSH Servers  │  │   Qdrant   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
web_rA/
├── app/                        # Core AI/orchestration layer
│   ├── agents/                 # Agent implementations
│   │   ├── base_agent.py       # Base class for all agents
│   │   ├── simple_agent.py     # Single LLM call agent
│   │   ├── complex_agent.py    # Multi-step agent
│   │   ├── react_agent.py      # ReAct pattern agent
│   │   ├── ralph_agent.py      # Ralph iterative agent
│   │   ├── claude_code_agent.py # Claude Code CLI wrapper
│   │   ├── cli_runtime.py      # External CLI execution
│   │   └── manager.py          # Agent factory/manager
│   ├── core/                   # Core orchestration
│   │   ├── unified_orchestrator.py # Main orchestrator (ReAct/Ralph/CLI modes)
│   │   ├── llm.py              # LLM provider abstraction
│   │   ├── model_config.py     # Model configuration
│   │   └── modes/              # Orchestrator modes
│   ├── rag/                    # RAG (Retrieval-Augmented Generation)
│   │   └── engine.py           # Qdrant or InMemory RAG
│   ├── tools/                  # Built-in tools
│   │   ├── manager.py          # Tool registry
│   │   ├── ssh_tools.py        # SSH connection/execution
│   │   ├── server_tools.py     # Server management
│   │   ├── filesystem_tools.py # File operations
│   │   └── safety.py           # Dangerous command blocking
│   ├── services/               # Business logic layer
│   │   ├── permissions.py      # Authorization checks
│   │   └── workflow_service.py # Workflow operations
│   └── mcp/                    # Model Context Protocol
│       └── client.py           # MCP server connections
│
├── core_ui/                    # Main web interface
│   ├── views.py                # Chat, settings, orchestrator views
│   ├── templates/              # HTML templates
│   └── static/                 # CSS, JS assets
│
├── agent_hub/                  # Agent management
│   ├── models.py               # AgentProfile, Workflow, Run models
│   ├── views/                  # Split views (pages, API)
│   │   ├── pages.py            # HTML page views
│   │   ├── utils.py            # Helper functions
│   │   └── __init__.py         # Backward compat re-exports
│   └── views_legacy.py         # Legacy API views (being migrated)
│
├── tasks/                      # Task management
│   ├── models.py               # Task, SubTask, TaskShare models
│   ├── views.py                # Task CRUD, analysis
│   ├── smart_analyzer.py       # AI task analysis
│   └── tasks.py                # Celery async tasks
│
├── servers/                    # SSH server management
│   ├── models.py               # Server model
│   └── views.py                # Server CRUD
│
├── passwords/                  # Password manager
│   └── encryption.py           # AES-256 encryption
│
├── web_ui/                     # Django project settings
│   ├── settings.py             # Main configuration
│   ├── urls.py                 # URL routing
│   └── celery.py               # Celery configuration
│
├── tests/                      # Test suite
│   ├── test_permissions.py     # Permission tests
│   └── test_safety.py          # Safety tests
│
├── mcp_server.py               # Standalone MCP server
├── conftest.py                 # Pytest fixtures
└── pyproject.toml              # Project config (ruff, pytest)
```

## Key Components

### UnifiedOrchestrator (`app/core/unified_orchestrator.py`)

Central orchestrator supporting multiple modes:

1. **ReAct Mode** - Iterative reasoning with tools (Reason + Act)
2. **Ralph Internal** - Iterative self-improvement
3. **Ralph CLI** - External Ralph binary execution

```python
async for chunk in orchestrator.process_user_message(
    message="Check disk space on server",
    model_preference="gemini",
    mode="react",  # or "ralph_internal", "ralph_cli"
    execution_context={"connection_id": "...", "server": {...}}
):
    yield chunk
```

### CLI Runtime (`app/agents/cli_runtime.py`)

Executes external AI CLI tools (Cursor, Claude Code, Ralph) in headless mode with JSON streaming.

**Supported CLIs:**
- `cursor` - Cursor AI with `--output-format stream-json`
- `claude` - Claude Code with `-p --verbose --output-format stream-json`
- `ralph` - Ralph iterative agent

### Tool Safety (`app/tools/safety.py`)

Blocks dangerous commands:
- `rm -rf`, `rm -r` - Recursive deletion
- `mkfs` - Filesystem formatting
- `dd if=` - Direct disk writes
- `shutdown`, `reboot` - System shutdown
- `systemctl stop/disable/mask` - Service disruption

### Permission Service (`app/services/permissions.py`)

Centralized authorization:
- Task permissions (view, edit, delete, share)
- Server permissions (access, execute)
- Workflow permissions (view, run, edit)

## Data Flow

### Chat Request

```
User Message
    │
    ▼
core_ui/views.py::chat_api()
    │
    ▼
UnifiedOrchestrator.process_user_message()
    │
    ├─► RAG Query (if enabled)
    │
    ├─► ReAct Loop
    │   ├─► LLM Call (Gemini/Grok)
    │   ├─► Tool Execution (if ACTION found)
    │   └─► Continue or Finish
    │
    ▼
Streamed Response
```

### Workflow Execution

```
Workflow Start
    │
    ▼
agent_hub/views.py::api_workflow_run()
    │
    ▼
CLI Runtime (Cursor/Claude/Ralph)
    │
    ├─► Stream JSON output
    ├─► Parse tool calls
    └─► Update AgentWorkflowRun status
    │
    ▼
Completion/Error
```

## Configuration

### Environment Variables (`.env`)

```bash
# LLM API Keys
GEMINI_API_KEY=...
GROK_API_KEY=...
CURSOR_API_KEY=...        # For Cursor CLI headless mode

# Database
POSTGRES_HOST=...         # If not set, uses SQLite
POSTGRES_DB=...
POSTGRES_USER=...
POSTGRES_PASSWORD=...

# Security
SECRET_KEY=...
MASTER_PASSWORD=...       # Server password decryption

# Build Type
WEU_BUILD=mini            # or "full" for RAG support
```

### Model Configuration (`.model_config.json`)

```json
{
  "chat_model_gemini": "gemini-2.0-flash-exp",
  "agent_model_gemini": "gemini-2.0-flash-exp",
  "chat_model_grok": "grok-2",
  "default_provider": "gemini",
  "default_orchestrator_mode": "react"
}
```

## Database Models

### Core Models

| Model | App | Description |
|-------|-----|-------------|
| `Task` | tasks | Tasks with subtasks, shares, AI analysis |
| `Server` | servers | SSH servers with encrypted passwords |
| `AgentProfile` | agent_hub | Agent configurations |
| `AgentWorkflow` | agent_hub | Workflow definitions (JSON script) |
| `AgentWorkflowRun` | agent_hub | Workflow execution instances |
| `ChatSession` | core_ui | Chat conversation sessions |
| `ChatMessage` | core_ui | Individual chat messages |

## API Endpoints

### Chat
- `POST /api/chat/` - Send message, stream response

### Agents
- `GET /agents/` - Agent management page
- `GET /api/profiles/` - List agent profiles
- `POST /api/workflow/run/` - Start workflow
- `GET /api/workflow/run/{id}/status/` - Get run status

### Tasks
- `GET /tasks/` - Task list page
- `POST /api/tasks/analyze/` - AI task analysis
- `POST /api/tasks/workflow/` - Create workflow from task

### Servers
- `GET /servers/` - Server list
- `POST /api/servers/` - Add server
- `POST /api/server-execute/` - Execute command on server

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run specific test file
pytest tests/test_safety.py -v

# With coverage
pytest --cov=app --cov-report=html
```

## Development

```bash
# Start development server
python manage.py runserver 0.0.0.0:9000

# Run with Celery (for async tasks)
celery -A web_ui worker -l info
celery -A web_ui beat -l info

# Lint code
ruff check .
ruff format .
```
