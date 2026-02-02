"""
Utility functions for agent_hub views.

This module contains helper functions used across multiple view modules.
These are internal utilities, not exposed as API endpoints.
"""
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Optional, Tuple

from django.conf import settings
from django.http import HttpRequest
from loguru import logger

from agent_hub.models import AgentWorkflow


def get_project_folders(include_files_count: bool = False) -> list:
    """
    Get list of project folders in AGENT_PROJECTS_DIR.

    Args:
        include_files_count: Whether to count files in each folder

    Returns:
        List of dicts with folder info
    """
    base = settings.AGENT_PROJECTS_DIR
    if not base.exists():
        return []

    folders = []
    for item in sorted(base.iterdir()):
        if item.is_dir() and not item.name.startswith("."):
            info = {"name": item.name, "path": str(item)}
            if include_files_count:
                try:
                    info["files_count"] = sum(1 for _ in item.rglob("*") if _.is_file())
                except (PermissionError, OSError):
                    info["files_count"] = 0
            folders.append(info)
    return folders


def create_project_folder(name: str) -> str:
    """
    Create a new project folder.

    Args:
        name: Folder name (will be sanitized)

    Returns:
        Path to created folder
    """
    # Sanitize name
    safe_name = re.sub(r"[^\w\-_]", "_", name.strip())[:50]
    if not safe_name:
        safe_name = "project"

    folder = settings.AGENT_PROJECTS_DIR / safe_name
    folder.mkdir(parents=True, exist_ok=True)
    return str(folder)


def get_workspace_path(workflow: AgentWorkflow, is_server_task: bool = False) -> str:
    """
    Get workspace path for a workflow.

    For server tasks, returns BASE_DIR (no code workspace needed).
    For code tasks, returns project path or default from config.

    Args:
        workflow: Workflow instance
        is_server_task: Whether this is a server administration task

    Returns:
        Workspace path string
    """
    if is_server_task:
        return str(settings.BASE_DIR)

    if workflow.project_path:
        path = Path(workflow.project_path)
        if path.is_absolute() and path.exists():
            return str(path)
        # Relative to AGENT_PROJECTS_DIR
        full_path = settings.AGENT_PROJECTS_DIR / workflow.project_path
        if full_path.exists():
            return str(full_path)

    # Default from config
    try:
        from app.core.model_config import model_manager
        default_path = (
            getattr(model_manager.config, "default_agent_output_path", None) or ""
        ).strip()
        if default_path:
            return str(settings.AGENT_PROJECTS_DIR / default_path)
    except Exception as e:
        logger.debug(f"Failed to get default workspace path: {e}")

    # Create isolated workspace, NEVER use BASE_DIR (platform code)
    from datetime import datetime
    safe_name = f"agent_workspace_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    isolated_path = settings.AGENT_PROJECTS_DIR / safe_name
    isolated_path.mkdir(parents=True, exist_ok=True)
    return str(isolated_path)


def prepare_workspace_for_cli(
    workflow: AgentWorkflow,
    base_workspace: str,
    is_server_task: bool,
) -> Tuple[str, Optional[str]]:
    """
    Подготавливает workspace для CLI-агента с учётом ограничения доступа к файлам.

    В workflow.script можно указать:
    - workspace_mode: "full" | "empty" | "whitelist"
      - full — использовать base_workspace как есть (по умолчанию)
      - empty — пустая временная папка, агент не видит файлы проекта
      - whitelist — временная папка с копией только allowed_paths
    - restrict_files: true — то же, что workspace_mode: "empty" (если нет allowed_paths)
    - allowed_paths: ["src/", "config.yaml"] — пути относительно base_workspace (только для whitelist)

    Returns:
        (effective_workspace_path, temp_dir_to_cleanup_or_None)
        Если temp_dir_to_cleanup не None — вызывающий код должен удалить его после завершения (shutil.rmtree).
    """
    # СЕРВЕРНЫЕ ЗАДАЧИ — ВСЕГДА ИЗОЛЯЦИЯ!
    # Агент не должен видеть файлы проекта WEU, только выполнять команды на сервере
    if is_server_task:
        try:
            safe_name = (workflow.name or "server_task").replace(" ", "_")[:30]
            temp_dir = tempfile.mkdtemp(prefix=f"weu_server_{safe_name}_")
            
            # Создаем README с инструкциями для агента
            readme_path = Path(temp_dir) / "README.md"
            readme_content = """# DevOps Agent Workspace

Это изолированная среда для DevOps-агента.

## ВАЖНО

Вы работаете как DevOps-агент для управления серверами через SSH.

### ЗАПРЕЩЕНО:
- Искать файлы выше этой директории
- Читать код проекта
- Подниматься по файловой системе (../)

### РАЗРЕШЕНО:
- Использовать MCP инструменты: server_execute, servers_list
- Выполнять SSH команды на удаленных серверах
- Работать с Docker, системными сервисами
- Использовать Bash локально для вспомогательных команд

### Доступные серверы:
См. вывод команды `servers_list`

Если задача требует работы с кодом - откажитесь и объясните ограничения.
"""
            readme_path.write_text(readme_content, encoding="utf-8")
            
            # Создаем .cursorignore для блокировки доступа к файлам
            # Запрещаем все файлы - агент может работать только через SSH/MCP
            cursorignore_path = Path(temp_dir) / ".cursorignore"
            cursorignore_content = """# DevOps Agent Isolation
# Блокируем доступ ко ВСЕМ файлам - работа только через SSH/MCP

# Запретить все файлы и директории
*
**/*

# Запретить подъем вверх по файловой системе
..
../
../../
"""
            cursorignore_path.write_text(cursorignore_content, encoding="utf-8")
            
            # Создаем .cursorrules с четкими правилами
            cursorrules_path = Path(temp_dir) / ".cursorrules"
            cursorrules_content = """# DevOps Agent Rules

Вы работаете как DevOps-агент в изолированной среде.

## СТРОГО ЗАПРЕЩЕНО:
- Читать файлы (Read, Cat, Head, Tail)
- Искать файлы (Glob, Find, SemanticSearch, Grep)
- Подниматься по директориям (cd .., cd ../.., ls ../)
- Выполнять команды вне этой директории
- Использовать Write, Edit, StrReplace

## РАЗРЕШЕНО ТОЛЬКО:
- mcp__weu-servers__server_execute - команды на SSH сервере
- mcp__weu-servers__servers_list - список серверов
- Bash - ТОЛЬКО для создания локальных скриптов (если необходимо)

## КАК РАБОТАТЬ:
1. Вызвать servers_list для просмотра серверов
2. Использовать server_execute для всех команд Docker/systemd/apt
3. НЕ искать файлы проекта - их здесь НЕТ

Если задача требует чтения кода - откажитесь.
"""
            cursorrules_path.write_text(cursorrules_content, encoding="utf-8")
            
            logger.info(f"Server task isolation: empty dir for workflow {workflow.id} -> {temp_dir}")
            return (temp_dir, temp_dir)
        except Exception as e:
            logger.warning(f"Failed to create isolated dir for server task: {e}")
            # Fallback to base_workspace in AGENT_PROJECTS_DIR (not BASE_DIR!)
            return (base_workspace, None)

    script = workflow.script or {}
    workspace_mode = (script.get("workspace_mode") or "").strip().lower()
    restrict_files = bool(script.get("restrict_files", False))
    allowed_paths = script.get("allowed_paths") or []
    if isinstance(allowed_paths, str):
        allowed_paths = [p.strip() for p in allowed_paths.split(",") if p.strip()]
    else:
        allowed_paths = [p.strip() for p in allowed_paths if p and isinstance(p, str) and p.strip()]

    # Режим "empty" или restrict_files без whitelist — пустая папка
    if workspace_mode == "empty" or (restrict_files and not allowed_paths):
        try:
            temp_dir = tempfile.mkdtemp(prefix="weu_agent_empty_")
            logger.info(f"Workspace restriction: empty dir for workflow {workflow.id} -> {temp_dir}")
            return (temp_dir, temp_dir)
        except Exception as e:
            logger.warning(f"Failed to create empty workspace dir: {e}, using base_workspace")
            return (base_workspace, None)

    # Режим "whitelist" — копируем только разрешённые пути
    if workspace_mode == "whitelist" and allowed_paths:
        try:
            base = Path(base_workspace).resolve()
            if not base.exists():
                logger.warning(f"Base workspace does not exist: {base_workspace}, using as-is")
                return (base_workspace, None)
            temp_dir = tempfile.mkdtemp(prefix="weu_agent_whitelist_")
            dest = Path(temp_dir)
            for rel in allowed_paths:
                if not rel:
                    continue
                src = (base / rel).resolve()
                try:
                    if not src.exists():
                        logger.debug(f"Whitelist path does not exist: {src}")
                        continue
                    # Безопасность: путь должен оставаться внутри base
                    try:
                        src.relative_to(base)
                    except ValueError:
                        logger.warning(f"Whitelist path outside base, skip: {rel}")
                        continue
                    target = dest / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if src.is_dir():
                        shutil.copytree(src, target)
                    else:
                        shutil.copy2(src, target)
                except (OSError, PermissionError) as e:
                    logger.warning(f"Failed to copy whitelist path {rel}: {e}")
            logger.info(f"Workspace restriction: whitelist for workflow {workflow.id} -> {temp_dir}")
            return (temp_dir, temp_dir)
        except Exception as e:
            logger.warning(f"Failed to create whitelist workspace: {e}, using base_workspace")
            return (base_workspace, None)

    return (base_workspace, None)


def is_admin(request: HttpRequest) -> bool:
    """Check if current user is admin/superuser."""
    return request.user.is_authenticated and (
        request.user.is_superuser or request.user.is_staff
    )


def redact_sensitive(value: Any) -> Any:
    """
    Redact sensitive values (passwords, keys, tokens).

    Args:
        value: Value to potentially redact

    Returns:
        Redacted value or original if not sensitive
    """
    if not isinstance(value, str):
        return value

    sensitive_patterns = [
        r"password",
        r"secret",
        r"token",
        r"api_key",
        r"apikey",
        r"auth",
        r"credential",
    ]

    value_lower = value.lower()
    for pattern in sensitive_patterns:
        if pattern in value_lower:
            return "***REDACTED***"

    return value


def sanitize_command(cmd: list) -> list:
    """
    Sanitize command list by redacting sensitive arguments.

    Args:
        cmd: Command as list of strings

    Returns:
        Sanitized command list
    """
    result = []
    skip_next = False

    for i, arg in enumerate(cmd):
        if skip_next:
            result.append("***")
            skip_next = False
            continue

        arg_lower = arg.lower()
        if any(
            p in arg_lower
            for p in ["--password", "--token", "--secret", "--key", "--api-key"]
        ):
            result.append(arg)
            skip_next = True
        elif "=" in arg and any(
            p in arg_lower.split("=")[0]
            for p in ["password", "token", "secret", "key"]
        ):
            key = arg.split("=")[0]
            result.append(f"{key}=***")
        else:
            result.append(arg)

    return result


def parse_json_request(request: HttpRequest) -> dict[str, Any]:
    """
    Parse JSON from request body.

    Args:
        request: Django HttpRequest

    Returns:
        Parsed JSON dict

    Raises:
        json.JSONDecodeError: If body is not valid JSON
    """
    return json.loads(request.body or "{}")


def short_path(path: str, max_len: int = 50) -> str:
    """
    Shorten path for display, keeping start and end.

    Args:
        path: Full path string
        max_len: Maximum length

    Returns:
        Shortened path with ... in middle if needed
    """
    if len(path) <= max_len:
        return path

    keep = (max_len - 3) // 2
    return f"{path[:keep]}...{path[-keep:]}"


def parse_llm_json(response_text: str) -> dict[str, Any]:
    """
    Parse JSON from LLM response, handling markdown code blocks.

    Args:
        response_text: Raw LLM response

    Returns:
        Parsed JSON dict or empty dict on failure
    """
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        # Try to extract JSON from markdown code block
        match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                return {}
        return {}


def agent_name_from_type(agent_type: str) -> str:
    """
    Get human-readable agent name from type.

    Args:
        agent_type: Agent type string (simple, complex, react, ralph)

    Returns:
        Human-readable name
    """
    names = {
        "simple": "Simple Agent",
        "complex": "Complex Agent",
        "react": "ReAct Agent",
        "ralph": "Ralph Agent",
        "cursor": "Cursor Agent",
        "claude": "Claude Code Agent",
    }
    return names.get(agent_type, agent_type.title())
