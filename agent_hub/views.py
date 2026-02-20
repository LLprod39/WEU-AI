"""
Views for Agent Hub: profiles, runs, and AI config assistant.
"""
import json
import queue
import threading
import time
from pathlib import Path
import subprocess
import shlex
import os
import shutil
import sys
from datetime import datetime
from typing import Dict, Any
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.conf import settings
from asgiref.sync import async_to_sync
from loguru import logger

from .models import AgentProfile, AgentRun, AgentPreset, AgentWorkflow, AgentWorkflowRun, CustomAgent
from app.agents.manager import get_agent_manager
from core_ui.decorators import require_feature
from core_ui.middleware import get_template_name
from app.core.llm import LLMProvider
from app.tools.manager import get_tool_manager

ALLOWED_RUNTIMES = {"cursor", "claude", "codex", "gemini", "grok"}  # CLI агенты
ALLOWED_RALPH_BACKENDS = {"cursor", "claude", "gemini", "grok"}  # Backends для Ralph


def _get_project_folders(include_files_count: bool = False) -> list:
    """Возвращает список папок проектов. include_files_count=False на загрузке страницы — не делает тяжёлый glob."""
    projects_dir = settings.AGENT_PROJECTS_DIR
    folders = []
    if projects_dir.exists():
        for item in sorted(projects_dir.iterdir()):
            if item.is_dir():
                rec = {"name": item.name, "path": item.name, "full_path": str(item)}
                if include_files_count:
                    try:
                        rec["files_count"] = sum(1 for _ in item.iterdir())
                    except OSError:
                        rec["files_count"] = 0
                folders.append(rec)
    return folders


def _create_project_folder(name: str) -> str:
    """Создает папку проекта и возвращает относительный путь"""
    import re
    # Очистка имени от недопустимых символов
    safe_name = re.sub(r'[^\w\-_. ]', '', name).strip().replace(' ', '_')
    if not safe_name:
        safe_name = f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    project_path = settings.AGENT_PROJECTS_DIR / safe_name
    project_path.mkdir(parents=True, exist_ok=True)
    return safe_name


def _get_workspace_path(workflow: AgentWorkflow, is_server_task: bool = False) -> str:
    """Возвращает путь к workspace для workflow.

    Для SERVER_TASK: изолированная папка БЕЗ доступа к коду проекта.
    Для CODE_TASK: папка в agent_projects/ для написания кода.
    """
    # Для серверных задач - создаём изолированную папку (без кода проекта!)
    if is_server_task or workflow.target_server_id:
        # Папка для серверных задач - минимальная, только для MCP
        safe_name = (workflow.name or "server_task").replace(" ", "_")[:50]
        isolated_path = settings.AGENT_PROJECTS_DIR / safe_name
        isolated_path.mkdir(parents=True, exist_ok=True)
        return str(isolated_path)

    # Для кодовых задач - project_path или default
    path = (workflow.project_path or "").strip()
    if not path:
        try:
            from app.core.model_config import model_manager
            path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
        except Exception as e:
            logger.debug(f"Failed to load default_agent_output_path: {e}")
            path = ""
    if path:
        full_path = settings.AGENT_PROJECTS_DIR / path
        full_path.mkdir(parents=True, exist_ok=True)
        return str(full_path)

    # Fallback: изолированная папка (НЕ BASE_DIR чтобы не видеть код проекта)
    safe_name = (workflow.name or "code_task").replace(" ", "_")[:50]
    fallback_path = settings.AGENT_PROJECTS_DIR / safe_name
    fallback_path.mkdir(parents=True, exist_ok=True)
    return str(fallback_path)


def _admin_required(request) -> bool:
    return bool(getattr(request, "user", None) and request.user.is_authenticated and request.user.is_staff)


def _redact_sensitive(value):
    if isinstance(value, dict):
        redacted = {}
        for k, v in value.items():
            key_lower = str(k).lower()
            if any(word in key_lower for word in ["password", "secret", "token", "api_key", "apikey", "key"]):
                redacted[k] = "***"
            else:
                redacted[k] = _redact_sensitive(v)
        return redacted
    if isinstance(value, list):
        return [_redact_sensitive(v) for v in value]
    return value


def _sanitize_command(cmd: list) -> list:
    sanitized = []
    redact_next = False
    for part in cmd:
        if redact_next:
            sanitized.append("***")
            redact_next = False
            continue
        part_lower = str(part).lower()
        if any(flag in part_lower for flag in ["--api-key", "--apikey", "--token", "--secret", "--password"]):
            sanitized.append(part)
            redact_next = True
            continue
        sanitized.append(part)
    return sanitized


def _parse_json_request(request) -> Dict[str, Any]:
    try:
        return json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return {}


def _agent_name_from_type(agent_type: str) -> str:
    return {
        "simple": "Simple Agent",
        "complex": "Complex Agent",
        "react": "ReAct Agent",
        "ralph": "Ralph Wiggum Agent",
    }.get(agent_type, "ReAct Agent")


def _parse_llm_json(response_text: str) -> Dict[str, Any]:
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        import re

        match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                return {}
        return {}


def _generate_profile_config(task: str) -> Dict[str, Any]:
    llm = LLMProvider()
    from app.core.model_config import model_manager

    model_preference = model_manager.config.default_provider
    prompt = f"""You are an AI assistant helping configure agent profiles.
Return ONLY JSON with fields:
{{
  "name": "Profile name",
  "description": "Short description",
  "agent_type": "simple|complex|react|ralph",
  "runtime": "cursor|ralph",
  "mode": "simple|advanced",
  "questions": ["Question 1", "Question 2"],
  "assumptions": ["Assumption 1", "Assumption 2"],
  "config": {{
    "model": "gpt-5|sonnet-4|sonnet-4-thinking",
    "specific_model": null,
    "use_rag": true,
    "max_iterations": 10,
    "completion_promise": "DONE",
    "ralph_backend": "cursor",
    "initial_prompt": "",
    "loop_include_previous": true,
    "ask_on_missing": true,
    "safety_level": "safe"
  }}
}}

Task description:
{task}

Rules:
- Use ralph for multi-step tasks, cursor for direct execution.
- If using ralph runtime, set ralph_backend to "cursor".
- If requirements are unclear, add 1-2 concise questions in "questions".
- Keep config minimal but correct.
"""

    async def _consume():
        chunks = []
        async for chunk in llm.stream_chat(prompt, model=model_preference):
            chunks.append(chunk)
        return "".join(chunks)

    response_text = async_to_sync(_consume)()
    parsed = _parse_llm_json(response_text)
    if not parsed:
        parsed = {
            "name": "New Agent Profile",
            "description": "Auto-generated profile",
            "agent_type": "ralph",
            "runtime": "ralph",
            "mode": "simple",
            "questions": [],
            "assumptions": [],
            "config": {
                "model": "gpt-5",
                "use_rag": True,
                "ralph_backend": "cursor",
                "loop_include_previous": True,
                "ask_on_missing": True,
                "safety_level": "safe",
            },
        }
    # Используем default_provider как fallback вместо жестко заданного "ralph"
    from app.core.model_config import model_manager
    default_runtime = model_manager.config.default_provider or "cursor"
    parsed["runtime"] = parsed.get("runtime") if parsed.get("runtime") in ALLOWED_RUNTIMES else default_runtime
    cfg = parsed.get("config", {})
    if parsed["runtime"] == "ralph":
        cfg["ralph_backend"] = default_runtime
    # Модель теперь поддерживается для cursor - валидируем значение
    if parsed["runtime"] == "cursor" and cfg.get("model"):
        from django.conf import settings
        valid_models = [m["id"] for m in getattr(settings, "CURSOR_AVAILABLE_MODELS", [])]
        if cfg["model"] not in valid_models:
            cfg["model"] = "auto"  # fallback на auto если модель невалидная
    parsed["config"] = cfg
    return parsed


def _generate_workflow_script_via_cursor(task: str, runtime: str, target_server_name: str = None) -> Dict[str, Any] | None:
    """Генерация workflow через Cursor CLI (Composer 1.5, --mode=plan)."""
    is_server_task = target_server_name is not None
    if is_server_task:
        prompt = f"""Generate a workflow JSON for SERVER task. Target server: «{target_server_name}».
Return ONLY valid JSON, no markdown:
{{"name":"...","description":"...","runtime":"cursor","task_type":"server","steps":[{{"title":"...","prompt":"Execute via server_execute. Output <promise>STEP_DONE</promise> when done","completion_promise":"STEP_DONE","max_iterations":3}}]}}
Task: {task}"""
    else:
        prompt = f"""Generate a workflow JSON for CODE task. Return ONLY valid JSON:
{{"name":"...","description":"...","runtime":"cursor","task_type":"code","steps":[{{"title":"...","prompt":"...","completion_promise":"STEP_DONE","max_iterations":5}}]}}
Task: {task}"""
    try:
        planning_dir = Path(settings.MEDIA_ROOT) / "workflows" / "planning"
        planning_dir.mkdir(parents=True, exist_ok=True)
        workspace = str(planning_dir)
        cmd = _build_cli_command("cursor_plan", prompt, {"model": "composer-1.5"}, workspace=workspace)
        env = dict(os.environ)
        env.update(getattr(settings, "CURSOR_CLI_EXTRA_ENV", None) or {})
        result = subprocess.run(cmd, capture_output=True, timeout=180, env=env, cwd=workspace)
        stdout = result.stdout.decode("utf-8", errors="ignore")
        parsed = _parse_llm_json(stdout)
        if parsed and "steps" in parsed:
            parsed.setdefault("runtime", runtime)
            parsed["model"] = "auto"  # Выполнение workflow на auto
            return parsed
    except Exception as e:
        logger.warning(f"Cursor plan workflow generation failed: {e}")
    return None


def _generate_workflow_script(task: str, runtime: str, from_task: bool = False, user_id: int = None, target_server_id: int = None, target_server_name: str = None) -> Dict[str, Any]:
    # Сначала пробуем Cursor CLI (Composer 1.5, plan mode) — пишет план workflow
    parsed = _generate_workflow_script_via_cursor(task, runtime, target_server_name=target_server_name)
    if parsed:
        return parsed

    # Fallback: внутренний LLM (gemini/grok)
    llm = LLMProvider()
    from app.core.model_config import model_manager
    model_preference = getattr(model_manager.config, "internal_llm_provider", None) or "gemini"
    if model_preference not in ("gemini", "grok"):
        model_preference = "gemini" if (getattr(model_manager.config, "gemini_enabled", True)) else "grok"

    is_server_task = target_server_id is not None

    if is_server_task:
        # СЕРВЕРНЫЕ ЗАДАЧИ: простые SSH команды, без кода проекта
        prompt = f"""Generate a simple workflow for SERVER administration task.
Return ONLY JSON:
{{
  "name": "Task name",
  "description": "Short description",
  "runtime": "{runtime}",
  "task_type": "server",
  "steps": [
    {{
      "title": "Step title",
      "prompt": "Execute SSH command on server",
      "completion_promise": "STEP_DONE",
      "max_iterations": 3
    }}
  ]
}}

CRITICAL RULES FOR SERVER TASKS:
- Target server: «{target_server_name}»
- Use ONLY server_execute MCP tool with server_name_or_id="{target_server_name}"
- Generate SIMPLE shell commands: df -h, free -m, systemctl status, apt install, etc.
- DO NOT mention any code, functions, APIs, or application logic
- DO NOT reference get_disk_usage_report, django, python functions
- Agent should ONLY run SSH commands via server_execute tool
- Each step = one simple server command
- When done, output <promise>STEP_DONE</promise>

Example for "check disk space":
  prompt: "Выполни команду df -h на сервере через server_execute. Выведи результат. Когда готово выведи <promise>STEP_DONE</promise>"

Task: {task}
"""
    else:
        # КОДОВЫЕ ЗАДАЧИ: изолированная работа с кодом
        prompt = f"""You generate workflow scripts for CLI agents (CODE tasks).
Return ONLY JSON:
{{
  "name": "Workflow name",
  "description": "Short description",
  "runtime": "{runtime}",
  "task_type": "code",
  "prompt": "High-level goal summary",
  "questions": ["Clarifying question 1", "Clarifying question 2"],
  "assumptions": ["Assumption 1", "Assumption 2"],
  "quality_checks": ["Tests to run", "Lint to run"],
  "steps": [
    {{
      "title": "Step title",
      "prompt": "Task for the agent to perform",
      "completion_promise": "STEP_DONE",
      "max_iterations": 5,
      "verify_prompt": "Verify work and run tests if needed. Output <promise>PASS</promise> when ok.",
      "verify_promise": "PASS"
    }}
  ]
}}

RULES FOR CODE TASKS:
- Agent works in ISOLATED directory (agent_projects/task_name/)
- Agent should NOT access main project code
- Keep steps short and actionable
- Each step must include completion_promise
- Include verify_prompt and verify_promise for testing steps
- Ralph workflow: шаги по порядку, completion_promise для завершения

Task description:
{task}
"""

    async def _consume():
        chunks = []
        async for chunk in llm.stream_chat(prompt, model=model_preference):
            chunks.append(chunk)
        return "".join(chunks)

    response_text = async_to_sync(_consume)()
    parsed = _parse_llm_json(response_text)
    if not parsed:
        return {}

    if "steps" not in parsed:
        parsed["steps"] = []

    parsed["runtime"] = runtime
    parsed["model"] = "auto"  # Выполнение workflow на auto
    
    # Ralph режим больше НЕ используется через этот путь
    # Ralph это orchestrator_mode, а не runtime
    # runtime всегда должен быть конкретный CLI: cursor, claude, gemini, grok

    return parsed


@login_required
@require_feature('agents', redirect_on_forbidden=True)
def agents_page(request):
    from servers.models import Server
    profiles = AgentProfile.objects.filter(owner=request.user, is_active=True)
    presets = AgentPreset.objects.all()
    recent_runs = AgentRun.objects.filter(initiated_by=request.user)[:10]
    workflows = AgentWorkflow.objects.filter(owner=request.user).select_related("target_server")[:10]
    workflow_runs = AgentWorkflowRun.objects.filter(initiated_by=request.user)[:10]
    workflow_runs_data = []
    for run in workflow_runs:
        steps = (run.workflow.script or {}).get("steps", [])
        total_steps = len(steps)
        progress_pct = 0
        current_step_title = ""
        if total_steps:
            progress_pct = min(int((run.current_step / total_steps) * 100), 100)
            if run.current_step > 0 and run.current_step <= total_steps:
                current_step_title = steps[run.current_step - 1].get("title", "")
        workflow_runs_data.append(
            {
                "run": run,
                "total_steps": total_steps,
                "progress_pct": progress_pct,
                "current_step_title": current_step_title,
            }
        )
    presets_data = [
        {
            "name": preset.name,
            "description": preset.description,
            "agent_type": preset.agent_type,
            "runtime": preset.runtime,
            "config": preset.config,
        }
        for preset in presets
    ]
    workflows_data = [
        {
            "id": workflow.id,
            "name": workflow.name,
            "script": workflow.script,
            "project_path": workflow.project_path,
            "target_server_id": workflow.target_server_id,
            "target_server_name": workflow.target_server.name if workflow.target_server else None,
        }
        for workflow in workflows
    ]
    projects_data = _get_project_folders(include_files_count=False)
    # Серверы пользователя для выбора целевого сервера
    servers_data = [
        {"id": s.id, "name": s.name, "host": s.host}
        for s in Server.objects.filter(user=request.user).only("id", "name", "host")
    ]
    # Mobile or desktop template
    if getattr(request, 'is_mobile', False):
        template = "agent_hub/mobile/agents.html"
    else:
        template = "agent_hub/agents.html"
    
    return render(
        request,
        template,
        {
            "profiles": profiles,
            "presets": presets,
            "recent_runs": recent_runs,
            "workflows": workflows,
            "workflow_runs": workflow_runs_data,
            "presets_data": presets_data,
            "workflows_data": workflows_data,
            "projects_data": projects_data,
            "servers_data": servers_data,
        },
    )


@login_required
@require_feature('agents', redirect_on_forbidden=True)
@require_http_methods(["GET"])
def logs_page(request):
    run_type = (request.GET.get("type") or "workflow").strip()
    run_id = (request.GET.get("run_id") or "").strip()
    return render(
        request,
        "agent_hub/logs.html",
        {
            "run_type": run_type,
            "run_id": run_id,
        },
    )


@login_required
@require_feature('agents', redirect_on_forbidden=True)
@require_http_methods(["GET"])
def admin_logs_page(request):
    if not _admin_required(request):
        return HttpResponseForbidden("Forbidden")
    return render(request, "agent_hub/admin_logs.html", {})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_profiles_list(request):
    profiles = AgentProfile.objects.filter(owner=request.user).order_by("-updated_at")
    data = [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "agent_type": p.agent_type,
            "runtime": p.runtime,
            "mode": p.mode,
            "config": p.config,
            "is_default": p.is_default,
            "is_active": p.is_active,
            "updated_at": p.updated_at.isoformat(),
        }
        for p in profiles
    ]
    return JsonResponse({"profiles": data})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_profiles_create(request):
    data = _parse_json_request(request)
    name = data.get("name", "").strip()
    if not name:
        return JsonResponse({"error": "Name is required"}, status=400)

    agent_type = data.get("agent_type", "react")
    runtime = data.get("runtime", "ralph")
    mode = data.get("mode", "simple")
    config = data.get("config", {})
    is_default = bool(data.get("is_default", False))

    if is_default:
        AgentProfile.objects.filter(owner=request.user, is_default=True).update(is_default=False)

    if runtime not in ALLOWED_RUNTIMES:
        return JsonResponse({"error": f"Runtime '{runtime}' не поддерживается"}, status=400)

    # Валидация модели для cursor
    if runtime == "cursor" and config.get("model"):
        valid_models = [m["id"] for m in getattr(settings, "CURSOR_AVAILABLE_MODELS", [])]
        if config["model"] not in valid_models:
            config["model"] = "auto"

    profile = AgentProfile.objects.create(
        owner=request.user,
        name=name,
        description=data.get("description", ""),
        agent_type=agent_type,
        runtime=runtime,
        mode=mode,
        config=config,
        is_default=is_default,
    )

    return JsonResponse({"success": True, "profile_id": profile.id})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_profiles_update(request, profile_id: int):
    profile = get_object_or_404(AgentProfile, id=profile_id, owner=request.user)
    data = _parse_json_request(request)

    profile.name = data.get("name", profile.name)
    profile.description = data.get("description", profile.description)
    profile.agent_type = data.get("agent_type", profile.agent_type)
    if "runtime" in data:
        new_runtime = data.get("runtime")
        if new_runtime not in ALLOWED_RUNTIMES:
            return JsonResponse({"error": f"Runtime '{new_runtime}' не поддерживается"}, status=400)
        profile.runtime = new_runtime
    else:
        profile.runtime = data.get("runtime", profile.runtime)
    profile.mode = data.get("mode", profile.mode)
    config = data.get("config", profile.config or {})
    # Валидация модели для cursor
    if profile.runtime == "cursor" and config.get("model"):
        valid_models = [m["id"] for m in getattr(settings, "CURSOR_AVAILABLE_MODELS", [])]
        if config["model"] not in valid_models:
            config["model"] = "auto"
    profile.config = config

    if "is_active" in data:
        profile.is_active = bool(data.get("is_active"))
    if "is_default" in data:
        is_default = bool(data.get("is_default"))
        if is_default:
            AgentProfile.objects.filter(owner=request.user, is_default=True).exclude(id=profile.id).update(
                is_default=False
            )
        profile.is_default = is_default

    profile.save()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_profiles_delete(request, profile_id: int):
    profile = get_object_or_404(AgentProfile, id=profile_id, owner=request.user)
    profile.is_active = False
    profile.save(update_fields=["is_active"])
    return JsonResponse({"success": True})


def _start_agent_run(
    user,
    agent_type: str,
    runtime: str,
    task: str,
    config: Dict[str, Any],
    profile: AgentProfile = None,
) -> AgentRun:
    run = AgentRun.objects.create(
        profile=profile,
        initiated_by=user,
        runtime=runtime,
        status="queued",
        input_task=task,
        started_at=None,
        meta={
            "agent_type": agent_type,
            "runtime": runtime,
            "config": config or {},
            "profile_id": profile.id if profile else None,
        },
    )
    thread = threading.Thread(
        target=_execute_agent_run,
        args=(run.id, agent_type, runtime, task, config),
        daemon=True,
    )
    thread.start()
    return run


def _execute_agent_run(run_id: int, agent_type: str, runtime: str, task: str, config: Dict[str, Any]):
    run_obj = AgentRun.objects.get(id=run_id)
    run_obj.status = "running"
    run_obj.started_at = timezone.now()
    _append_log_event(
        run_obj,
        {
            "type": "run",
            "subtype": "start",
            "title": "Старт запуска",
            "message": f"Runtime: {runtime}",
        },
    )
    _append_log_event(
        run_obj,
        {
            "type": "prompt",
            "title": "Входная задача",
            "message": task[:4000],
        },
    )
    meta = run_obj.meta or {}
    meta.update(
        {
            "agent_type": agent_type,
            "runtime": runtime,
            "config": config or {},
        }
    )
    run_obj.meta = meta
    run_obj.save(update_fields=["status", "started_at", "log_events", "meta"])

    try:
        if getattr(settings, "ANALYZE_TASK_BEFORE_RUN", True) and runtime in ("ralph", "cursor"):
            workspace = config.get("workspace") or ""
            if not workspace:
                try:
                    from app.core.model_config import model_manager
                    path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
                    workspace = str(settings.AGENT_PROJECTS_DIR / path) if path else str(settings.BASE_DIR)
                except Exception:
                    workspace = str(settings.BASE_DIR)
            run_obj.logs = (run_obj.logs or "") + "\n[Phase: Pre-analysis (Cursor — проверка задачи перед запуском)]\n"
            _append_log_event(
                run_obj,
                {
                    "type": "phase",
                    "subtype": "start",
                    "title": "Cursor analyze",
                    "message": "Анализ задачи перед запуском",
                },
            )
            run_obj.save(update_fields=["logs", "log_events", "meta"])
            analyze_result = _run_cursor_ask_analyze(workspace, task[:6000], timeout_sec=90)
            run_obj.logs = (run_obj.logs or "") + (analyze_result.get("output", "") or "")[:3000] + "\n"
            run_obj.logs = (run_obj.logs or "") + "[Cursor analyze done — запуск агента]\n"
            _append_log_event(
                run_obj,
                {
                    "type": "phase",
                    "subtype": "done",
                    "title": "Cursor analyze",
                    "status": "ready" if analyze_result.get("ready") else "review",
                },
            )
            run_obj.save(update_fields=["logs", "log_events", "meta"])
        if runtime == "internal":
            agent_manager = get_agent_manager()
            agent_name = _agent_name_from_type(agent_type)
            result = async_to_sync(agent_manager.execute_agent)(agent_name, task, config)
            run_obj.output_text = result.get("result") or ""
            run_obj.logs = json.dumps(result.get("metadata") or {}, ensure_ascii=False)
            run_obj.status = "succeeded" if result.get("success") else "failed"
        else:
            workspace = config.get("workspace") or ""
            if not workspace:
                try:
                    from app.core.model_config import model_manager
                    path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
                    workspace = str(settings.AGENT_PROJECTS_DIR / path) if path else str(settings.BASE_DIR)
                except Exception:
                    workspace = str(settings.BASE_DIR)
            cmd = _build_cli_command(runtime, task, config, workspace=workspace)
            meta = run_obj.meta or {}
            meta["cli_command"] = _sanitize_command(cmd)
            meta["cli_command_full"] = cmd
            meta["workspace"] = workspace
            meta["runtime"] = runtime
            meta["input_prompt"] = task
            meta["config"] = _redact_sensitive(config)
            run_obj.meta = meta
            run_obj.logs = (run_obj.logs or "") + f"\n{'='*60}\n"
            run_obj.logs = (run_obj.logs or "") + f"🔧 ЗАПУСК CLI АГЕНТА\n"
            run_obj.logs = (run_obj.logs or "") + f"Runtime: {runtime}\n"
            run_obj.logs = (run_obj.logs or "") + f"Workspace: {workspace}\n"
            run_obj.logs = (run_obj.logs or "") + f"{'='*60}\n"
            _v_cmd_display = cmd[:-1] + [task] if (runtime == "codex" and cmd and cmd[-1] == "-") else cmd
            _v_cmd_str = shlex.join(_v_cmd_display) if (sys.version_info >= (3, 8)) else " ".join(_sanitize_command(cmd))
            run_obj.logs = (run_obj.logs or "") + f"[CMD] {_v_cmd_str}\n"
            run_obj.logs = (run_obj.logs or "") + f"{'='*60}\n\n"
            _append_log_event(
                run_obj,
                {
                    "type": "cmd",
                    "subtype": "start",
                    "title": "Запуск команды",
                    "command": _v_cmd_str,
                },
            )
            run_obj.save(update_fields=["logs", "log_events", "meta"])
            result = _run_cli_stream(
                cmd,
                run_obj,
                step_label="agent-run",
                extra_env=_get_cursor_cli_extra_env(),
                add_output_events=True,
                runtime=runtime,
                stdin_prompt=task if runtime == "codex" else None,
            )
            run_obj.output_text = result.get("output", "")
            run_obj.status = "succeeded" if result.get("success") else "failed"
            run_obj.meta = {**(run_obj.meta or {}), "exit_code": result.get("exit_code")}
    except Exception as exc:
        logger.error(f"Agent run failed: {exc}")
        run_obj.status = "failed"
        run_obj.logs = str(exc)
    run_obj.finished_at = timezone.now()
    _append_log_event(
        run_obj,
        {
            "type": "run",
            "subtype": "finish",
            "title": "Завершение",
            "status": run_obj.status,
        },
    )
    run_obj.save()


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_agent_run(request):
    data = _parse_json_request(request)
    task = data.get("task", "").strip()
    if not task:
        return JsonResponse({"error": "Task is required"}, status=400)

    profile_id = data.get("profile_id")
    profile = None
    if profile_id:
        profile = get_object_or_404(AgentProfile, id=profile_id, owner=request.user)

    # Используем default_provider из настроек
    from app.core.model_config import model_manager
    default_runtime = model_manager.config.default_provider or "cursor"
    
    agent_type = data.get("agent_type") or (profile.agent_type if profile else "react")
    runtime = data.get("runtime") or (profile.runtime if profile else default_runtime)
    config = data.get("config") or (profile.config if profile else {})
    if runtime not in ALLOWED_RUNTIMES:
        return JsonResponse({"error": f"Runtime '{runtime}' не поддерживается"}, status=400)
    # Валидация модели для cursor (если не указана - будет auto по умолчанию)
    if runtime == "cursor":
        if not config.get("model"):
            config["model"] = "auto"
        else:
            valid_models = [m["id"] for m in getattr(settings, "CURSOR_AVAILABLE_MODELS", [])]
            if config["model"] not in valid_models:
                config["model"] = "auto"
    if agent_type == "ralph" and runtime not in ["internal", "ralph"]:
        config = {**config, "use_ralph_loop": True}
        if not config.get("completion_promise"):
            config["completion_promise"] = "COMPLETE"

    run = _start_agent_run(request.user, agent_type, runtime, task, config, profile=profile)
    return JsonResponse({"success": True, "run_id": run.id, "status": "queued"})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_runs_list(request):
    runs = AgentRun.objects.filter(initiated_by=request.user).order_by("-created_at")[:50]
    data = [
        {
            "id": r.id,
            "runtime": r.runtime,
            "status": r.status,
            "input_task": r.input_task,
            "output_text": r.output_text[:500],
            "created_at": r.created_at.isoformat(),
        }
        for r in runs
    ]
    return JsonResponse({"runs": data})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def admin_api_runs_list(request):
    if not _admin_required(request):
        return JsonResponse({"error": "Forbidden"}, status=403)
    q = (request.GET.get("q") or "").strip()
    type_filter = (request.GET.get("type") or "all").strip().lower()
    status_filter = (request.GET.get("status") or "all").strip().lower()
    runtime_filter = (request.GET.get("runtime") or "all").strip().lower()

    items = []
    if type_filter in ("all", "run"):
        runs = AgentRun.objects.select_related("initiated_by", "profile")
        if status_filter != "all":
            runs = runs.filter(status=status_filter)
        if runtime_filter != "all":
            runs = runs.filter(runtime=runtime_filter)
        if q:
            runs = runs.filter(Q(input_task__icontains=q) | Q(profile__name__icontains=q))
        runs = runs.order_by("-created_at")[:200]
        for r in runs:
            items.append(
                {
                    "id": r.id,
                    "type": "run",
                    "status": r.status,
                    "runtime": r.runtime,
                    "created_at": r.created_at.isoformat(),
                    "title": (r.input_task or "")[:120],
                    "user": r.initiated_by.username if r.initiated_by else "",
                }
            )
    if type_filter in ("all", "workflow"):
        runs = AgentWorkflowRun.objects.select_related("initiated_by", "workflow")
        if status_filter != "all":
            runs = runs.filter(status=status_filter)
        if runtime_filter != "all":
            runs = runs.filter(workflow__runtime=runtime_filter)
        if q:
            runs = runs.filter(Q(workflow__name__icontains=q) | Q(workflow__description__icontains=q))
        runs = runs.order_by("-created_at")[:200]
        for r in runs:
            items.append(
                {
                    "id": r.id,
                    "type": "workflow",
                    "status": r.status,
                    "runtime": r.workflow.runtime if r.workflow else "",
                    "created_at": r.created_at.isoformat(),
                    "title": r.workflow.name if r.workflow else "",
                    "user": r.initiated_by.username if r.initiated_by else "",
                }
            )
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return JsonResponse({"items": items})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def admin_api_run_status(request, run_id: int):
    if not _admin_required(request):
        return JsonResponse({"error": "Forbidden"}, status=403)
    run = get_object_or_404(AgentRun, id=run_id)
    after_id = request.GET.get("after_id")
    events = list(run.log_events or [])
    if after_id:
        try:
            after_id_int = int(after_id)
            events = [e for e in events if int(e.get("id", 0)) > after_id_int]
        except ValueError:
            events = events[-400:]
    else:
        events = events[-400:]
    last_event_id = events[-1]["id"] if events else (run.log_events or [])[-1]["id"] if run.log_events else 0
    meta = run.meta or {}
    config = meta.get("config") or {}
    cli_command = meta.get("cli_command") or []
    workspace = meta.get("workspace") or ""
    input_prompt = meta.get("input_prompt") or run.input_task or ""
    
    # Собираем полный контекст для отладки
    runtime_cfg = settings.CLI_RUNTIME_CONFIG.get(run.runtime, {})
    
    # Дополнительная информация из settings
    analyze_enabled = getattr(settings, "ANALYZE_TASK_BEFORE_RUN", True)
    cli_timeout = getattr(settings, "CLI_RUNTIME_TIMEOUT_SECONDS", 600)
    cli_first_output_timeout = getattr(settings, "CLI_FIRST_OUTPUT_TIMEOUT_SECONDS", 120)
    
    # Системные инструкции и контекст
    system_instructions = []
    if run.runtime in ["cursor", "claude"]:
        system_instructions.append(f"Pre-analyze: {'enabled' if analyze_enabled else 'disabled'}")
        system_instructions.append(f"Timeout: {cli_timeout}s (first output: {cli_first_output_timeout}s)")
    
    # ENV переменные которые были/будут переданы
    env_vars = {}
    if run.runtime == "cursor":
        cursor_extra = getattr(settings, "CURSOR_CLI_EXTRA_ENV", {})
        if cursor_extra:
            env_vars = _redact_sensitive(cursor_extra)
    
    details = {
        "id": run.id,
        "type": "run",
        "runtime": run.runtime,
        "status": run.status,
        "created_at": run.created_at.isoformat(),
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "user": run.initiated_by.username if run.initiated_by else None,
        "profile": run.profile.name if run.profile else None,
        "meta": meta,
        "cli_command": cli_command,
        "cli_command_full": meta.get("cli_command_full") or [],
        "workspace": workspace,
        "runtime_config": {
            "command": runtime_cfg.get("command"),
            "args": runtime_cfg.get("args", []),
            "allowed_args": runtime_cfg.get("allowed_args", []),
            "timeout_seconds": runtime_cfg.get("timeout_seconds"),
            "prompt_style": runtime_cfg.get("prompt_style", "flag"),
        },
        "input_prompt_full": input_prompt,
        "config": config,
        "system_instructions": system_instructions,
        "env_vars": env_vars,
    }
    meta_line = " • ".join(
        [f"Runtime: {run.runtime}", f"Status: {run.status}", f"User: {details.get('user') or '—'}"]
    )
    return JsonResponse(
        {
            "type": "run",
            "title": f"Run #{run.id}",
            "meta": meta_line,
            "prompt": input_prompt,
            "config_json": json.dumps(config, ensure_ascii=False, indent=2),
            "script_json": "",
            "logs": (run.logs or "")[-20000:],
            "output": (run.output_text or "")[-8000:],
            "events": events,
            "last_event_id": last_event_id,
            "details": details,
        }
    )


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def admin_api_run_update(request, run_id: int):
    if not _admin_required(request):
        return JsonResponse({"error": "Forbidden"}, status=403)
    run = get_object_or_404(AgentRun, id=run_id)
    data = _parse_json_request(request)
    updated_fields = []
    if "input_task" in data:
        run.input_task = data.get("input_task") or ""
        updated_fields.append("input_task")
    if "config" in data:
        meta = run.meta or {}
        meta["config"] = data.get("config") or {}
        run.meta = meta
        updated_fields.append("meta")
    if updated_fields:
        _append_log_event(
            run,
            {
                "type": "edit",
                "title": "Изменение параметров",
                "message": "Обновлены поля: " + ", ".join(updated_fields),
            },
        )
        run.save()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def admin_api_run_restart(request, run_id: int):
    if not _admin_required(request):
        return JsonResponse({"error": "Forbidden"}, status=403)
    run = get_object_or_404(AgentRun, id=run_id)
    data = _parse_json_request(request)
    task = (data.get("input_task") or run.input_task or "").strip()
    meta = run.meta or {}
    config = data.get("config") or meta.get("config") or (run.profile.config if run.profile else {})
    agent_type = meta.get("agent_type") or (run.profile.agent_type if run.profile else "react")
    runtime = run.runtime
    new_run = _start_agent_run(run.initiated_by or request.user, agent_type, runtime, task, config, profile=run.profile)
    return JsonResponse({"success": True, "run_id": new_run.id})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def admin_api_workflow_run_status(request, run_id: int):
    if not _admin_required(request):
        return JsonResponse({"error": "Forbidden"}, status=403)
    run = get_object_or_404(AgentWorkflowRun.objects.select_related("workflow"), id=run_id)
    after_id = request.GET.get("after_id")
    events = list(run.log_events or [])
    if after_id:
        try:
            after_id_int = int(after_id)
            events = [e for e in events if int(e.get("id", 0)) > after_id_int]
        except ValueError:
            events = events[-400:]
    else:
        events = events[-400:]
    last_event_id = events[-1]["id"] if events else (run.log_events or [])[-1]["id"] if run.log_events else 0
    script = run.workflow.script if run.workflow else {}
    steps = script.get("steps", [])
    current_step_idx = run.current_step
    
    # Формируем информацию о шагах с командами
    steps_info = []
    run_meta = run.meta or {}
    for idx in range(1, len(steps) + 1):
        step = steps[idx - 1] if idx <= len(steps) else {}
        step_cmd = run_meta.get(f"step_{idx}_cmd") or []
        step_prompt = run_meta.get(f"step_{idx}_prompt") or step.get("prompt", "")
        steps_info.append({
            "idx": idx,
            "title": step.get("title", f"Шаг {idx}"),
            "prompt": step_prompt[:200],
            "cmd": step_cmd,
            "is_current": idx == current_step_idx,
        })
    
    details = {
        "id": run.id,
        "type": "workflow",
        "status": run.status,
        "runtime": run.workflow.runtime if run.workflow else None,
        "workflow_id": run.workflow.id if run.workflow else None,
        "workflow_name": run.workflow.name if run.workflow else None,
        "created_at": run.created_at.isoformat(),
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "user": run.initiated_by.username if run.initiated_by else None,
        "meta": run_meta,
        "steps": steps_info,
        "current_step": current_step_idx,
    }
    
    # Промпт текущего шага (если есть)
    current_step_prompt = ""
    if current_step_idx > 0 and current_step_idx <= len(steps):
        current_step_prompt = run_meta.get(f"step_{current_step_idx}_prompt") or steps[current_step_idx - 1].get("prompt", "")
    
    meta_line = " • ".join(
        [
            f"Workflow: {details.get('workflow_name') or '—'}",
            f"Status: {run.status}",
            f"Step: {current_step_idx}/{len(steps)}",
            f"User: {details.get('user') or '—'}",
        ]
    )
    return JsonResponse(
        {
            "type": "workflow",
            "title": f"WorkflowRun #{run.id}",
            "meta": meta_line,
            "prompt": current_step_prompt,
            "config_json": json.dumps(run_meta, ensure_ascii=False, indent=2),
            "script_json": json.dumps(script or {}, ensure_ascii=False, indent=2),
            "logs": (run.logs or "")[-20000:] if run.logs else "",
            "events": events,
            "last_event_id": last_event_id,
            "details": details,
        }
    )


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def admin_api_workflow_run_update(request, run_id: int):
    if not _admin_required(request):
        return JsonResponse({"error": "Forbidden"}, status=403)
    run = get_object_or_404(AgentWorkflowRun.objects.select_related("workflow"), id=run_id)
    data = _parse_json_request(request)
    script = data.get("script")
    if not isinstance(script, dict):
        return JsonResponse({"error": "script must be JSON object"}, status=400)
    workflow = run.workflow
    workflow.script = script
    workflow.save(update_fields=["script"])
    _append_log_event(
        run,
        {
            "type": "edit",
            "title": "Workflow обновлен",
            "message": "Обновлен script workflow",
        },
    )
    run.save(update_fields=["log_events", "meta"])
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def admin_api_workflow_run_restart(request, run_id: int):
    if not _admin_required(request):
        return JsonResponse({"error": "Forbidden"}, status=403)
    run = get_object_or_404(AgentWorkflowRun.objects.select_related("workflow"), id=run_id)
    new_run = _start_workflow_run(run.workflow, run.initiated_by or request.user)
    return JsonResponse({"success": True, "run_id": new_run.id})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_run_status(request, run_id: int):
    run = get_object_or_404(AgentRun, id=run_id, initiated_by=request.user)
    after_id = request.GET.get("after_id")
    events = list(run.log_events or [])
    if after_id:
        try:
            after_id_int = int(after_id)
            events = [e for e in events if int(e.get("id", 0)) > after_id_int]
        except ValueError:
            events = events[-200:]
    else:
        events = events[-200:]
    last_event_id = events[-1]["id"] if events else (run.log_events or [])[-1]["id"] if run.log_events else 0
    return JsonResponse(
        {
            "status": run.status,
            "runtime": run.runtime,
            "logs": (run.logs or "")[-5000:],
            "output": (run.output_text or "")[-2000:],
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "events": events,
            "last_event_id": last_event_id,
        }
    )


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_run_stop(request, run_id: int):
    run = get_object_or_404(AgentRun, id=run_id, initiated_by=request.user)
    if run.status not in ["queued", "running"]:
        return JsonResponse({"error": "Run уже завершен"}, status=400)

    pid = (run.meta or {}).get("pid")
    if pid:
        try:
            if os.name == "nt":
                subprocess.Popen(["taskkill", "/PID", str(pid), "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.kill(int(pid), 9)
        except (ProcessLookupError, OSError) as e:
            logger.debug(f"Process {pid} already terminated: {e}")

    run.status = "cancelled"
    run.logs = (run.logs or "") + "\n[Stopped by user]\n"
    run.finished_at = timezone.now()
    run.save(update_fields=["status", "logs", "finished_at"])
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_run_delete(request, run_id: int):
    run = get_object_or_404(AgentRun, id=run_id, initiated_by=request.user)
    run.delete()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_run_delete(request, run_id: int):
    run = get_object_or_404(AgentWorkflowRun, id=run_id, initiated_by=request.user)
    run.delete()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_projects_list(request):
    """Возвращает список папок проектов"""
    folders = _get_project_folders(include_files_count=True)
    return JsonResponse({"projects": folders})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_projects_create(request):
    """Создает новую папку проекта"""
    data = _parse_json_request(request)
    name = data.get("name", "").strip()
    if not name:
        return JsonResponse({"error": "Name is required"}, status=400)
    
    project_path = _create_project_folder(name)
    return JsonResponse({
        "success": True,
        "project_path": project_path,
        "full_path": str(settings.AGENT_PROJECTS_DIR / project_path),
    })


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_workflows_list(request):
    workflows = AgentWorkflow.objects.filter(owner=request.user).order_by("-created_at")[:50]
    data = [
        {
            "id": w.id,
            "name": w.name,
            "description": w.description,
            "runtime": w.runtime,
            "script": w.script,
            "created_at": w.created_at.isoformat(),
        }
        for w in workflows
    ]
    return JsonResponse({"workflows": data})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_delete(request, workflow_id: int):
    workflow = get_object_or_404(AgentWorkflow, id=workflow_id, owner=request.user)
    script = workflow.script or {}
    for path_key in ["script_file", "ralph_yml_path"]:
        file_path = script.get(path_key)
        if file_path:
            try:
                Path(file_path).unlink(missing_ok=True)
            except OSError as e:
                logger.debug(f"Failed to delete workflow file {file_path}: {e}")
    workflow.delete()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_generate(request):
    data = _parse_json_request(request)
    task = data.get("task", "").strip()
    
    # Используем default_provider из настроек вместо жестко заданного "ralph"
    from app.core.model_config import model_manager
    default_runtime = model_manager.config.default_provider or "cursor"
    runtime = data.get("runtime", default_runtime)
    
    project_path = data.get("project_path", "").strip()
    create_new_project = data.get("create_new_project", False)
    new_project_name = data.get("new_project_name", "").strip()
    
    if not task:
        return JsonResponse({"error": "Task is required"}, status=400)
    if runtime not in ALLOWED_RUNTIMES:
        return JsonResponse({"error": f"Runtime '{runtime}' не поддерживается"}, status=400)

    # Создаем новую папку проекта если нужно
    if create_new_project and new_project_name:
        project_path = _create_project_folder(new_project_name)
    elif create_new_project and not new_project_name:
        # Генерируем имя из задачи
        import re
        safe_name = re.sub(r'[^\w\-_. ]', '', task[:50]).strip().replace(' ', '_')
        if not safe_name:
            safe_name = f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        project_path = _create_project_folder(safe_name)
    elif not project_path:
        try:
            from app.core.model_config import model_manager
            project_path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
        except Exception:
            pass

    parsed = _generate_workflow_script(task, runtime)

    if not parsed:
        return JsonResponse({"error": "Failed to generate workflow"}, status=500)

    workflow = AgentWorkflow.objects.create(
        owner=request.user,
        name=parsed.get("name", "New Workflow"),
        description=parsed.get("description", ""),
        runtime=parsed.get("runtime", runtime),
        script=parsed,
        project_path=project_path,
    )

    workflows_dir = Path(settings.MEDIA_ROOT) / "workflows"
    workflows_dir.mkdir(parents=True, exist_ok=True)
    file_path = workflows_dir / f"workflow-{workflow.id}.json"
    parsed["script_file"] = str(file_path)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=2)

    if parsed.get("ralph_yml"):
        ralph_path = workflows_dir / f"workflow-{workflow.id}.ralph.yml"
        parsed["ralph_yml_path"] = str(ralph_path)
        _write_ralph_yml(ralph_path, parsed["ralph_yml"])

    workflow.script = parsed
    workflow.save(update_fields=["script"])

    return JsonResponse({"success": True, "workflow_id": workflow.id, "workflow": parsed})


# Import from service layer - breaks circular import with tasks app
from app.services.workflow_service import create_workflow_from_task


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_from_task(request):
    """
    Создать воркфлоу в Agents из задачи (Tasks), расписать по шагам (Ralph), запустить.
    Вызывается при делегировании в «форму задачи агента» (delegate_ui=task_form).
    Body: { "task_id": int }. Returns: { "workflow_id", "run_id" }.
    """
    data = _parse_json_request(request)
    task_id = data.get("task_id")
    if task_id is None:
        return JsonResponse({"error": "task_id required"}, status=400)
    try:
        from tasks.models import Task
    except ImportError:
        return JsonResponse({"error": "Tasks app not available"}, status=500)
    task = Task.objects.filter(id=task_id).first()
    if not task:
        return JsonResponse({"error": "Task not found"}, status=404)
    created_by_id = getattr(task, "created_by_id", None)
    if created_by_id is not None and created_by_id != request.user.id:
        from app.services.permissions import PermissionService
        if not PermissionService.can_edit_task(request.user, task):
            return JsonResponse({"error": "No access to this task"}, status=403)
    
    workflow, run = create_workflow_from_task(task, request.user)
    if not workflow:
        return JsonResponse({"error": "Failed to create workflow"}, status=500)
    
    return JsonResponse({
        "success": True,
        "workflow_id": workflow.id,
        "run_id": run.id,
    })


def _promise_found(output: str, promise: str) -> bool:
    import re
    match = re.search(r"<promise>(.*?)</promise>", output, re.DOTALL | re.IGNORECASE)
    if not match:
        return False
    extracted = re.sub(r"\s+", " ", match.group(1).strip())
    target = re.sub(r"\s+", " ", promise.strip())
    return extracted == target


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_run(request):
    data = _parse_json_request(request)
    workflow_id = data.get("workflow_id")
    if not workflow_id:
        return JsonResponse({"error": "workflow_id required"}, status=400)

    workflow = get_object_or_404(AgentWorkflow, id=workflow_id, owner=request.user)
    # Не проверяем workflow.runtime т.к. используем настройки default_provider
    run = _start_workflow_run(workflow, request.user)
    return JsonResponse({"success": True, "run_id": run.id})


def _run_cursor_ask_analyze(workspace: str, task_text: str, timeout_sec: int = 90) -> Dict[str, Any]:
    """
    Проверка задачи через Cursor в режиме ask (только анализ, без правок).
    Возвращает {"output": str, "ready": bool}. ready=True если в выводе есть <promise>READY</promise>.
    """
    analyze_prompt = (
        "Проанализируй следующую задачу (или шаги воркфлоу). "
        "Проверь: всё ли ясно, не нужно ли что-то уточнить или дополнить. "
        "Если всё в порядке и задачу можно выполнять — ответь ровно: <promise>READY</promise>\n\n"
        "Если нужно что-то уточнить или дополнить — напиши кратко что именно.\n\n"
        "---\n"
        f"{task_text[:8000]}"
    )
    try:
        cmd_path = _resolve_cli_command("cursor")
        base_dir = str(Path(workspace).resolve()) if workspace else str(settings.BASE_DIR)
        env = dict(os.environ)
        env.update(getattr(settings, "CURSOR_CLI_EXTRA_ENV", None) or {})
        cmd = [
            cmd_path,
            "--mode=ask",
            "-p",
            "--output-format",
            "text",
            "--workspace",
            base_dir,
            "--model",
            "auto",
            analyze_prompt,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=base_dir,
            env=env,
            timeout=timeout_sec,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        ready = _promise_found(output, "READY")
        return {"output": output.strip(), "ready": ready, "exit_code": proc.returncode}
    except subprocess.TimeoutExpired:
        return {"output": "[Timeout] Cursor ask превысил время ожидания.", "ready": False, "exit_code": -1}
    except Exception as e:
        return {"output": f"[Error] {e}", "ready": False, "exit_code": -1}


def _build_cli_command(runtime: str, prompt: str, config: Dict[str, Any], workspace: str = None) -> list:
    logger.info(f"\n{'🔧'*30}")
    logger.info(f"🔧 _build_cli_command вызван")
    logger.info(f"  Runtime: {runtime}")
    logger.info(f"  Workspace: {workspace}")
    logger.info(f"  Config keys: {list(config.keys())}")
    logger.info(f"  Prompt length: {len(prompt)} символов")
    
    # Заменяем "auto" на default_provider
    if runtime == "auto":
        from app.core.model_config import model_manager
        runtime = model_manager.config.default_provider or "cursor"
        logger.info(f"  _build_cli_command: replaced 'auto' with '{runtime}'")
    
    runtime_cfg = settings.CLI_RUNTIME_CONFIG.get(runtime)
    if not runtime_cfg:
        logger.error(f"❌ Runtime '{runtime}' не найден в CLI_RUNTIME_CONFIG!")
        logger.error(f"  Доступные runtime: {list(settings.CLI_RUNTIME_CONFIG.keys())}")
        raise ValueError(f"Runtime '{runtime}' is not configured")
    
    logger.info(f"  Runtime config найден: {runtime_cfg}")
    
    resolved_cmd = _resolve_cli_command(runtime)
    logger.info(f"  Resolved command: {resolved_cmd}")
    
    cmd = [resolved_cmd]
    
    base_args = runtime_cfg.get("args", [])
    logger.info(f"  Base args от config: {base_args}")
    
    formatted_args = [_format_arg(runtime_cfg, arg, workspace) for arg in base_args]
    logger.info(f"  Formatted args: {formatted_args}")
    cmd += formatted_args
    
    allowed_args = runtime_cfg.get("allowed_args", [])
    logger.info(f"  Allowed args: {allowed_args}")
    
    cli_args = []
    for arg_name in allowed_args:
        value = config.get(arg_name)
        if value is None:
            underscore_key = arg_name.replace("-", "_")
            value = config.get(underscore_key)
        if value not in (None, "", []):
            if isinstance(value, bool):
                if value:
                    logger.info(f"  Добавляем bool arg: --{arg_name}")
                    cli_args.append(f"--{arg_name}")
            else:
                logger.info(f"  Добавляем arg: --{arg_name} = {str(value)[:100]}")
                cli_args.extend([f"--{arg_name}", str(value)])
    
    prompt_style = runtime_cfg.get("prompt_style", "flag")
    logger.info(f"  Prompt style: {prompt_style}")
    # Codex: промпт через stdin ("-"), иначе "unexpected argument" при пробелах
    if runtime == "codex" and prompt is not None:
        final_cmd = cmd + cli_args + ["-"]
        logger.info(f"  Codex: промпт будет передан через stdin")
    else:
        final_cmd = cmd + cli_args + ([prompt] if prompt is not None else [])
    logger.info(f"  Финальная команда: {len(final_cmd)} элементов")
    logger.info(f"{'🔧'*30}\n")
    return final_cmd


# Сколько строк лога накапливать перед записью в БД (снижает "database is locked" при SQLite)
_LOG_SAVE_BATCH_SIZE = 25  # больше = меньше записей в БД, меньше lock при SQLite


def _get_cursor_cli_extra_env() -> dict:
    """Переменные окружения для Cursor CLI (напр. HTTP/1.0)."""
    env = getattr(settings, "CURSOR_CLI_EXTRA_ENV", None)
    return env if isinstance(env, dict) and env else {}


def _ensure_mcp_servers_config(workspace: str, user_id: int) -> str:
    """Создаёт/обновляет mcp_config.json в workspace для сервера weu-servers.
    Используется standalone mcp_server.py вместо manage.py mcp_servers,
    т.к. Django management command долго инициализируется и может зависать.
    """
    if not workspace or not user_id:
        return ""
    cfg_path = Path(workspace) / "mcp_config.json"
    cfg = {}
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8") or "{}")
        except Exception:
            cfg = {}
    servers = cfg.get("mcpServers") or {}
    base_dir = str(settings.BASE_DIR).replace("\\", "/")

    # Путь к venv python и standalone MCP серверу
    if os.name != "nt":
        venv_python = f"{base_dir}/.venv/bin/python"
    else:
        venv_python = f"{base_dir}/.venv/Scripts/python.exe"
    mcp_server_script = f"{base_dir}/mcp_server.py"

    mcp_env = {"WEU_USER_ID": str(user_id)}
    master_password = os.environ.get("MASTER_PASSWORD", "")
    if master_password:
        mcp_env["MASTER_PASSWORD"] = master_password
    for _env_key in ("PATH", "DJANGO_SETTINGS_MODULE", "HOME", "TMPDIR", "TEMP", "TMP"):
        _val = os.environ.get(_env_key)
        if _val:
            mcp_env[_env_key] = _val
    for _env_key in ("POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "DATABASE_URL"):
        _val = os.environ.get(_env_key)
        if _val:
            mcp_env[_env_key] = _val
    servers["weu-servers"] = {
        "type": "stdio",
        "command": venv_python,
        "args": ["-u", mcp_server_script],
        "env": mcp_env,
        "description": "WEU AI Servers: servers_list, server_execute (серверы из вкладки Servers)",
        "autoApprove": ["server_execute", "servers_list"],
    }
    cfg["mcpServers"] = servers
    try:
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning(f"Failed to write MCP config at {cfg_path}: {exc}")
        return ""
    return str(cfg_path)


def _write_cursor_mcp_json(workspace: str, mcp_config_path: str) -> None:
    """Копирует mcp_config.json в .cursor/mcp.json в workspace и в ~/.cursor/mcp.json.
    Cursor CLI читает MCP из этих мест; без этого server_execute и др. недоступны в headless."""
    try:
        cursor_dir = Path(workspace) / ".cursor"
        cursor_dir.mkdir(parents=True, exist_ok=True)
        dst = cursor_dir / "mcp.json"
        shutil.copy2(mcp_config_path, dst)
        logger.info(f"Cursor MCP config (project) written to {dst}")
    except Exception as exc:
        logger.warning(f"Failed to write project .cursor/mcp.json: {exc}")
    try:
        home_cursor_dir = Path.home() / ".cursor"
        home_cursor_dir.mkdir(parents=True, exist_ok=True)
        global_dst = home_cursor_dir / "mcp.json"
        shutil.copy2(mcp_config_path, global_dst)
        logger.info(f"Cursor MCP config (global) written to {global_dst}")
    except Exception as exc:
        logger.warning(f"Failed to write global ~/.cursor/mcp.json: {exc}")


def _write_cursor_cli_permissions(workspace: str) -> None:
    """Пишет .cursor/cli.json с permissions.allow для weu-servers MCP.
    В headless без этого Cursor запрашивает Approve на MCP — вызов отклоняется.
    Документация: https://cursor.com/docs/cli/reference/permissions"""
    if not workspace:
        return
    try:
        cursor_dir = Path(workspace) / ".cursor"
        cursor_dir.mkdir(parents=True, exist_ok=True)
        cli_json_path = cursor_dir / "cli.json"
        config = {}
        if cli_json_path.exists():
            try:
                config = json.loads(cli_json_path.read_text(encoding="utf-8") or "{}")
            except Exception:
                config = {}
        permissions = config.get("permissions") or {}
        allow = list(permissions.get("allow") or [])
        for token in ("Mcp(weu-servers:*)", "Shell(*)"):
            if token not in allow:
                allow.append(token)
        permissions["allow"] = allow
        permissions["deny"] = permissions.get("deny") if isinstance(permissions.get("deny"), list) else []
        config["permissions"] = permissions
        cli_json_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"Cursor CLI permissions written to {cli_json_path} (allow Mcp, Shell)")
    except Exception as exc:
        logger.warning(f"Failed to write .cursor/cli.json permissions: {exc}")


def _short_path(path: str, max_len: int = 50) -> str:
    if len(path) <= max_len:
        return path
    parts = path.replace("\\", "/").split("/")
    if len(parts) > 3:
        return f"{parts[0]}/.../{'/'.join(parts[-2:])}"
    return f"...{path[-(max_len - 3):]}"


def _append_log_event(run_obj, event: Dict[str, Any]) -> Dict[str, Any]:
    meta = run_obj.meta or {}
    next_id = int(meta.get("log_event_id", 0)) + 1
    meta["log_event_id"] = next_id
    enriched = {
        **event,
        "id": next_id,
        "ts": timezone.now().isoformat(),
    }
    run_obj.meta = meta
    run_obj.log_events = list(run_obj.log_events or []) + [enriched]
    return enriched


def _tool_call_to_event(tool_call: Dict[str, Any], subtype: str, step_label: str) -> Dict[str, Any]:
    tool_key = next((k for k in tool_call.keys() if k.endswith("ToolCall")), None)
    tool_payload = tool_call.get(tool_key or "", {}) if tool_call else {}
    args = tool_payload.get("args", {}) if isinstance(tool_payload, dict) else {}
    title = _format_tool_started(tool_call) if subtype == "started" else _format_tool_completed(tool_call)
    return {
        "type": "tool_call",
        "subtype": subtype,
        "title": title or "🔧 Операция...",
        "tool": tool_key or "tool",
        "step_label": step_label,
        "data": {
            "args": args,
        },
    }


def _stream_json_to_event(data: Dict[str, Any], step_label: str) -> Dict[str, Any]:
    msg_type = data.get("type")
    subtype = data.get("subtype")
    if msg_type == "system" and subtype == "init":
        return {
            "type": "system",
            "subtype": "init",
            "title": "Инициализация модели",
            "message": f"🤖 Модель: {data.get('model', 'unknown')}",
            "model": data.get("model"),
            "step_label": step_label,
        }
    if msg_type == "assistant":
        content = data.get("message", {}).get("content", [])
        if content and isinstance(content, list) and content[0].get("text"):
            text = content[0].get("text", "")
            return {
                "type": "assistant",
                "title": "Сообщение ассистента",
                "message": text,
                "step_label": step_label,
            }
    if msg_type == "tool_call":
        tool_call = data.get("tool_call", {})
        if subtype in {"started", "completed"}:
            return _tool_call_to_event(tool_call, subtype, step_label)
    if msg_type == "result":
        return {
            "type": "result",
            "title": "Завершение шага",
            "duration_ms": data.get("duration_ms", 0),
            "step_label": step_label,
        }
    return None


def _format_tool_started(tool_call: Dict[str, Any]) -> str:
    if "writeToolCall" in tool_call:
        path = tool_call["writeToolCall"].get("args", {}).get("path", "?")
        return f"📝 Записываю: {_short_path(path)}"
    if "readToolCall" in tool_call:
        path = tool_call["readToolCall"].get("args", {}).get("path", "?")
        return f"📖 Читаю: {_short_path(path)}"
    if "strReplaceToolCall" in tool_call:
        path = tool_call["strReplaceToolCall"].get("args", {}).get("path", "?")
        return f"✏️ Редактирую: {_short_path(path)}"
    if "shellToolCall" in tool_call:
        cmd = tool_call["shellToolCall"].get("args", {}).get("command", "?")
        if len(cmd) > 80:
            cmd = cmd[:77] + "..."
        return f"🖥️ Команда: {cmd}"
    if "globToolCall" in tool_call:
        pattern = tool_call["globToolCall"].get("args", {}).get("glob_pattern", "?")
        return f"🔍 Поиск файлов: {pattern}"
    if "grepToolCall" in tool_call:
        pattern = tool_call["grepToolCall"].get("args", {}).get("pattern", "?")
        return f"🔎 Поиск в коде: {pattern}"
    if "lsToolCall" in tool_call:
        path = tool_call["lsToolCall"].get("args", {}).get("target_directory", "?")
        return f"📁 Листинг: {_short_path(path)}"
    if "deleteToolCall" in tool_call:
        path = tool_call["deleteToolCall"].get("args", {}).get("path", "?")
        return f"🗑️ Удаляю: {_short_path(path)}"
    return "🔧 Операция..."


def _format_tool_completed(tool_call: Dict[str, Any]) -> str:
    if "writeToolCall" in tool_call:
        result = tool_call["writeToolCall"].get("result", {}).get("success", {})
        lines = result.get("linesCreated", 0)
        size = result.get("fileSize", 0)
        return f"   ✅ Создано {lines} строк ({size} байт)"
    if "readToolCall" in tool_call:
        result = tool_call["readToolCall"].get("result", {}).get("success", {})
        return f"   ✅ Прочитано {result.get('totalLines', 0)} строк"
    if "strReplaceToolCall" in tool_call:
        result = tool_call["strReplaceToolCall"].get("result", {})
        if result.get("success"):
            return "   ✅ Изменено"
        return f"   ⚠️ {(result.get('error') or {}).get('message', 'Ошибка')[:50]}"
    if "shellToolCall" in tool_call:
        result = tool_call["shellToolCall"].get("result", {}).get("success", {})
        exit_code = result.get("exit_code", -1)
        return "   ✅ Выполнено" if exit_code == 0 else f"   ⚠️ Код выхода: {exit_code}"
    return None


def _format_stream_json_log(data: Dict[str, Any], run_obj: AgentWorkflowRun) -> str:
    """Форматирует одну строку лога для run_obj.logs. Для assistant возвращает None — текст пишется одним блоком при flush."""
    msg_type = data.get("type")
    subtype = data.get("subtype")
    if msg_type == "system" and subtype == "init":
        return f"🤖 Модель: {data.get('model', 'unknown')}"
    if msg_type == "assistant":
        # Не пишем каждый стрим-фрагмент отдельно; накопленный текст выводится одним блоком при flush/завершении
        return None
    if msg_type == "tool_call":
        tool_call = data.get("tool_call", {})
        if subtype == "started":
            return _format_tool_started(tool_call)
        if subtype == "completed":
            return _format_tool_completed(tool_call)
    if msg_type == "result":
        return f"⏱️ Завершено за {data.get('duration_ms', 0)}ms"
    return None


def _run_cli_stream(
    cmd: list,
    run_obj: Any,
    step_label: str,
    process_env: dict = None,
    extra_env: dict = None,
    add_output_events: bool = False,
    runtime: str = None,
    stdin_prompt: str = None,
) -> Dict[str, Any]:
    """Запуск CLI с парсингом stream-json для детального логирования.
    Для Codex (runtime=codex) выводит сырой текст в логи, т.к. stream-json не используется.
    Для Codex: stdin_prompt — промпт через stdin (cmd содержит "-")."""
    # ВАЖНО: всегда передаём os.environ чтобы CLI имели доступ к HOME, PATH и credentials
    spawn_env = {**os.environ}
    if process_env:
        spawn_env.update(process_env)
    if extra_env:
        spawn_env.update(extra_env)
    # Гарантируем что HOME установлен (для Claude CLI credentials)
    if not spawn_env.get("HOME"):
        spawn_env["HOME"] = os.path.expanduser("~")
    
    # Краткий заголовок шага в логах (без дампа промпта и env)
    mcp_config_path = None
    for i, arg in enumerate(cmd):
        if arg == "--mcp-config" and i + 1 < len(cmd):
            mcp_config_path = cmd[i + 1]
            break
    workspace = next((cmd[i + 1] for i, a in enumerate(cmd) if a == "--workspace" and i + 1 < len(cmd)), "")
    if not workspace:
        workspace = next((cmd[i + 1] for i, a in enumerate(cmd) if a == "--cd" and i + 1 < len(cmd)), "")
    debug_info = f"\n▶ Шаг: {step_label} | Команда: {cmd[0]} | Workspace: {workspace[:60]}{'...' if len(workspace) > 60 else ''}\n"
    if mcp_config_path:
        debug_info += f"  MCP config: {mcp_config_path}\n"
    logger.info(debug_info.strip())
    run_obj.logs = (run_obj.logs or "") + debug_info
    cmd_display = cmd
    if runtime == "codex" and stdin_prompt is not None and cmd and cmd[-1] == "-":
        cmd_display = cmd[:-1] + [stdin_prompt]
    cmd_display_str = shlex.join(cmd_display) if (sys.version_info >= (3, 8)) else " ".join(cmd)
    _append_log_event(
        run_obj,
        {
            "type": "cmd",
            "subtype": "start",
            "title": "Запуск команды",
            "command": cmd_display_str,
            "step_label": step_label,
        },
    )
    run_obj.save(update_fields=["logs", "log_events", "meta"])
    popen_kw = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if spawn_env:
        popen_kw["env"] = spawn_env
    if stdin_prompt is not None:
        popen_kw["stdin"] = subprocess.PIPE
        logger.info(f"📥 Codex: промпт будет передан через stdin ({len(stdin_prompt)} символов)")
    # Cursor/Claude ищут .cursor/mcp.json в текущей директории; cwd=workspace гарантирует загрузку MCP
    if workspace and os.path.isdir(workspace) and runtime in ("cursor", "claude"):
        popen_kw["cwd"] = workspace
        logger.info(f"📂 Запуск CLI с cwd={workspace} (для загрузки .cursor/mcp.json)")
    
    logger.info(f"🚀 Запуск процесса: {cmd[0]}")
    logger.info(f"🔧 Параметры Popen: stdout=PIPE, stderr=STDOUT, text=True, bufsize=1")
    print(f"\n[DEBUG] 🚀 Запуск процесса: {cmd[0]}", flush=True)
    print(f"[DEBUG] 🎯 Полная команда: {cmd_display_str}", flush=True)
    
    try:
        process = subprocess.Popen(cmd, **popen_kw)
        if stdin_prompt is not None:
            try:
                process.stdin.write(stdin_prompt)
                process.stdin.flush()
            finally:
                process.stdin.close()
            logger.info(f"✅ Промпт записан в stdin, stdin закрыт")
        logger.info(f"✅ Процесс запущен успешно, PID: {process.pid}")
        print(f"[DEBUG] ✅ Процесс запущен успешно, PID: {process.pid}", flush=True)
    except Exception as e:
        logger.error(f"❌ ОШИБКА запуска процесса: {e}")
        print(f"[DEBUG] ❌ ОШИБКА запуска процесса: {e}", flush=True)
        run_obj.logs = (run_obj.logs or "") + f"\n❌ КРИТИЧЕСКАЯ ОШИБКА запуска процесса: {e}\n"
        run_obj.save(update_fields=["logs"])
        raise
    
    run_obj.meta = {**(run_obj.meta or {}), f"pid_{step_label}": process.pid, "pid": process.pid}
    run_obj.save(update_fields=["meta"])
    output_chunks = []
    accumulated_text = ""
    assistant_buffer = ""  # накопление фрагментов ответа модели для вывода одним блоком
    tool_count = 0
    pending_lines = 0
    pending_events = 0
    dirty_logs = False
    dirty_events = False
    line_number = 0

    def flush_assistant_buffer():
        nonlocal assistant_buffer, pending_lines, dirty_logs
        if not assistant_buffer.strip():
            return
        block = assistant_buffer.strip()
        if len(block) > 8000:
            block = block[:8000] + "\n... [обрезано, всего {} символов]".format(len(assistant_buffer))
        run_obj.logs = (run_obj.logs or "") + "💬 Ответ модели:\n" + block + "\n\n"
        pending_lines += 1
        dirty_logs = True
        assistant_buffer = ""

    def maybe_flush():
        nonlocal pending_lines, pending_events, dirty_logs, dirty_events
        if pending_lines >= _LOG_SAVE_BATCH_SIZE or pending_events >= _LOG_SAVE_BATCH_SIZE:
            fields = []
            if dirty_logs:
                fields.append("logs")
            if dirty_events:
                fields.extend(["log_events", "meta"])
            if fields:
                run_obj.save(update_fields=fields)
            pending_lines = 0
            pending_events = 0
            dirty_logs = False
            dirty_events = False

    logger.info(f"📖 Начинаем читать вывод процесса PID={process.pid}")
    print(f"[DEBUG] 📖 Начинаем читать вывод процесса PID={process.pid}", flush=True)
    
    # Очередь для чтения stdout в отдельном потоке (чтобы не блокировать и видеть "сердцебиение")
    output_queue = queue.Queue()
    
    def _reader():
        try:
            for line in process.stdout:
                output_queue.put(line)
        except Exception as e:
            logger.error(f"❌ Ошибка при чтении stdout: {e}")
            print(f"[DEBUG] ❌ Ошибка чтения stdout: {e}", flush=True)
        finally:
            output_queue.put(None)  # сигнал конца вывода
    
    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()
    
    start_wait = time.time()
    first_line_seen = False
    
    while True:
        try:
            line = output_queue.get(timeout=5)
        except queue.Empty:
            elapsed = int(time.time() - start_wait)
            first_output_timeout = getattr(settings, "CLI_FIRST_OUTPUT_TIMEOUT_SECONDS", 120)
            
            if not first_line_seen and elapsed >= first_output_timeout:
                cli_name = "Codex" if runtime == "codex" else ("Claude" if "claude" in str(runtime) else "CLI")
                logger.error(
                    f"❌ Таймаут первого вывода: {cli_name} не вывел ни одной строки за {elapsed} сек. "
                    f"Прерываем процесс PID={process.pid}."
                )
                print(
                    f"[DEBUG] ❌ Таймаут первого вывода ({elapsed} сек). Прерываем PID={process.pid}",
                    flush=True,
                )
                try:
                    process.kill()
                except Exception:
                    pass
                mcp_hint = "" if runtime == "codex" else (
                    f"\nВероятная причина (Cursor/Claude): MCP-сервер не успел запуститься."
                    f"\nПроверьте: WEU_USER_ID=<id> python manage.py mcp_servers"
                )
                err_msg = (
                    f"CLI не вывел ни одной строки за {elapsed} сек. Процесс прерван.{mcp_hint}"
                )
                run_obj.logs = (run_obj.logs or "") + f"\n[ERROR] {err_msg}\n"
                _append_log_event(
                    run_obj,
                    {
                        "type": "error",
                        "title": "Таймаут первого вывода (MCP?)",
                        "message": err_msg,
                        "step_label": step_label,
                    },
                )
                run_obj.save(update_fields=["logs", "log_events", "meta"])
                return {"success": False, "output": "".join(output_chunks), "exit_code": -2}
            
            cli_label = "Codex" if runtime == "codex" else "CLI"
            msg = f"⏳ Ожидание вывода от {cli_label} (PID={process.pid}), прошло {elapsed} сек..."
            logger.warning(msg)
            print(f"[DEBUG] {msg}", flush=True)
            hint = ""
            if elapsed >= 10:
                hint = f" (Если > {first_output_timeout} сек — процесс будет прерван)"
            run_obj.logs = (run_obj.logs or "") + f"\n[DEBUG] {msg}{hint}\n"
            run_obj.save(update_fields=["logs"])
            continue
        
        if line is None:
            # stdout закрыт — процесс завершил вывод
            flush_assistant_buffer()
            logger.info(f"📭 stdout процесса PID={process.pid} закрыт")
            print(f"[DEBUG] 📭 stdout закрыт", flush=True)
            reader_thread.join(timeout=2)
            break
        
        line_number += 1
        output_chunks.append(line)
        line_stripped = line.strip()
        
        if not first_line_seen:
            first_line_seen = True
            elapsed = time.time() - start_wait
            cli_label = "Codex" if runtime == "codex" else "CLI"
            logger.info(f"✅ Первая строка от {cli_label} получена через {elapsed:.1f} сек")
            print(f"[DEBUG] ✅ Первая строка от {cli_label} через {elapsed:.1f} сек", flush=True)
            run_obj.logs = (run_obj.logs or "") + f"\n[DEBUG] ✅ Первая строка от {cli_label} через {elapsed:.1f} сек\n"
            run_obj.save(update_fields=["logs"])
        
        # Codex выводит plain text, не stream-json — не парсим как JSON
        if runtime == "codex":
            if line_stripped:
                run_obj.logs = (run_obj.logs or "") + line
                pending_lines += 1
                dirty_logs = True
                maybe_flush()
        elif line_stripped.startswith("{"):
            try:
                data = json.loads(line_stripped)
                
                json_type = data.get("type", "unknown")
                if json_type == "error":
                    error_msg = data.get("message", "unknown error")
                    logger.error(f"❌ Error в JSON: {error_msg}")

                # Перед tool_call/result выводим накопленный ответ модели одним блоком
                if data.get("type") in ("tool_call", "result"):
                    flush_assistant_buffer()
                if data.get("type") == "assistant":
                    content = data.get("message", {}).get("content", [])
                    if content and isinstance(content, list) and content[0].get("text"):
                        t = content[0].get("text", "")
                        accumulated_text += t
                        assistant_buffer += t
                log_line = _format_stream_json_log(data, run_obj)
                if data.get("type") == "tool_call" and data.get("subtype") == "started":
                    tool_count += 1
                event = _stream_json_to_event(data, step_label)
                if event:
                    _append_log_event(run_obj, event)
                    pending_events += 1
                    dirty_events = True
                    maybe_flush()
                if log_line:
                    run_obj.logs = (run_obj.logs or "") + log_line + "\n"
                    pending_lines += 1
                    dirty_logs = True
                    maybe_flush()
            except json.JSONDecodeError as e:
                logger.warning(f"⚠️ Не удалось распарсить JSON в строке #{line_number}: {e}")
                logger.warning(f"   Содержимое строки: {line_stripped[:200]}...")
                run_obj.logs = (run_obj.logs or "") + line
                if add_output_events and line_stripped:
                    _append_log_event(
                        run_obj,
                        {
                            "type": "cmd_output",
                            "title": "Вывод CLI",
                            "message": line_stripped[:2000],
                            "step_label": step_label,
                            "line": line_number,
                        },
                    )
                    pending_events += 1
                    dirty_events = True
                pending_lines += 1
                dirty_logs = True
                maybe_flush()
        else:
            # Сырой вывод (не JSON) для Cursor/Claude
            if line_stripped and add_output_events:
                _append_log_event(
                    run_obj,
                    {
                        "type": "cmd_output",
                        "title": "Вывод CLI",
                        "message": line_stripped[:2000],
                        "step_label": step_label,
                        "line": line_number,
                    },
                )
                pending_events += 1
                dirty_events = True
                maybe_flush()

    logger.info(f"⏳ Ожидаем завершения процесса PID={process.pid}")
    print(f"[DEBUG] ⏳ Ожидаем завершения процесса PID={process.pid}", flush=True)
    
    timeout_sec = getattr(settings, "CLI_RUNTIME_TIMEOUT_SECONDS", None)
    logger.info(f"⏱️ Timeout настройка: {timeout_sec if timeout_sec else 'не установлен (ждем бесконечно)'}")
    print(f"[DEBUG] ⏱️ Timeout: {timeout_sec if timeout_sec else 'не установлен'}", flush=True)
    
    try:
        exit_code = process.wait(timeout=timeout_sec) if timeout_sec else process.wait()
        logger.info(f"🏁 Процесс завершился с exit_code={exit_code}")
        print(f"[DEBUG] 🏁 Exit code={exit_code}", flush=True)
    except subprocess.TimeoutExpired:
        logger.error(f"⏰ TIMEOUT! Процесс PID={process.pid} превысил лимит {timeout_sec} секунд")
        print(f"[DEBUG] ⏰ TIMEOUT! PID={process.pid}", flush=True)
        process.kill()
        logger.info(f"🔪 Процесс PID={process.pid} принудительно завершен (kill)")
        print(f"[DEBUG] 🔪 Процесс убит", flush=True)
        run_obj.logs = (run_obj.logs or "") + f"[TIMEOUT] Process killed after {timeout_sec} seconds\n"
        _append_log_event(
            run_obj,
            {
                "type": "error",
                "title": "Превышено время ожидания",
                "message": f"Process killed after timeout ({timeout_sec}s)",
                "step_label": step_label,
            },
        )
        run_obj.save(update_fields=["logs", "log_events", "meta"])
        return {"success": False, "output": "".join(output_chunks), "exit_code": -1}

    output_str = "".join(output_chunks)

    # Полный ответ модели одним блоком для читаемости логов
    if accumulated_text.strip():
        run_obj.logs = (run_obj.logs or "") + "\n--- Ответ модели ---\n" + accumulated_text.strip() + "\n---\n"

    # Краткая сводка завершения
    completion_info = f"\n📊 Завершение: exit_code={exit_code}, строк={line_number}, вызовов инструментов={tool_count}, текст={len(accumulated_text)} символов\n"
    
    print(f"[DEBUG] 📊 ЗАВЕРШЕНИЕ: exit_code={exit_code}, строк={line_number}, размер={len(output_str)}", flush=True)
    
    if exit_code != 0:
        completion_info += f"\n⚠️ ПРОЦЕСС ЗАВЕРШИЛСЯ С ОШИБКОЙ (exit_code={exit_code})\n"
        print(f"[DEBUG] ⚠️ ОШИБКА! exit_code={exit_code}", flush=True)
        
        # Анализируем причину ошибки
        if exit_code == -9:
            completion_info += f"  Причина: Процесс был убит (SIGKILL) - возможно нехватка памяти или принудительное завершение\n"
        elif exit_code == -15:
            completion_info += f"  Причина: Процесс получил SIGTERM\n"
        elif exit_code == 1:
            completion_info += f"  Причина: Общая ошибка выполнения\n"
        elif exit_code == 127:
            completion_info += f"  Причина: Команда не найдена\n"
        else:
            completion_info += f"  Причина: Неизвестная ошибка\n"
        
        # Проверяем последние строки вывода
        if output_str:
            last_lines = output_str.strip().split('\n')[-10:]
            completion_info += f"\n  Последние 10 строк вывода:\n"
            for i, last_line in enumerate(last_lines, 1):
                completion_info += f"    [{i}] {last_line[:150]}\n"
    
    logger.info(completion_info)
    run_obj.logs = (run_obj.logs or "") + completion_info
    
    if exit_code != 0 and ("Connection stalled" in output_str or "connection stalled" in output_str.lower()):
        run_obj.logs = (run_obj.logs or "") + (
            "\n⚠️ Ошибка соединения с Cursor API (Connection stalled). "
            "Проверьте сеть, подписку Cursor и статус status.cursor.com; повторите шаг (Retry).\n"
        )
        run_obj.save(update_fields=["logs"])
    summary = f"\n{'─'*40}\n📊 Итого: {tool_count} операций, {len(accumulated_text)} символов\n"
    summary += "✅ Успешно завершено\n" if exit_code == 0 else f"❌ Завершено с ошибкой (код {exit_code})\n"
    summary += f"{'─'*40}\n"
    run_obj.logs = (run_obj.logs or "") + summary
    _append_log_event(
        run_obj,
        {
            "type": "summary",
            "title": "Итоги шага",
            "step_label": step_label,
            "stats": {"tools": tool_count, "chars": len(accumulated_text), "exit_code": exit_code},
        },
    )
    run_obj.save(update_fields=["logs", "log_events", "meta"])
    return {"success": exit_code == 0, "output": output_str, "exit_code": exit_code}


def _resolve_cli_command(runtime: str) -> str:
    logger.info(f"\n{'🔍'*30}")
    logger.info(f"🔍 _resolve_cli_command вызван для runtime: {runtime}")
    
    # Заменяем "auto" на default_provider
    if runtime == "auto":
        from app.core.model_config import model_manager
        runtime = model_manager.config.default_provider or "cursor"
        logger.info(f"  _resolve_cli_command: replaced 'auto' with '{runtime}'")
    
    env_var = _cli_env_var(runtime)
    logger.info(f"  ENV переменная для {runtime}: {env_var}")
    
    # Для cursor, cursor_plan, claude, codex в Docker/на хосте явно учитываем env var при каждом вызове
    if runtime in ["cursor", "cursor_plan", "claude", "codex"]:
        path_from_env = (os.getenv(env_var) or "").strip()
        logger.info(f"  Проверка ENV переменной {env_var}: {path_from_env if path_from_env else 'НЕ УСТАНОВЛЕНА'}")
        
        if path_from_env:
            if Path(path_from_env).exists():
                logger.info(f"  ✅ Найден CLI по пути из ENV: {path_from_env}")
                logger.info(f"{'🔍'*30}\n")
                return path_from_env
            logger.error(f"  ❌ {env_var} задан, но файл не найден: {path_from_env}")
            raise RuntimeError(
                f"{env_var} задан, но файл не найден: {path_from_env}. "
                "Проверь путь в .env (в Docker — путь внутри контейнера, например к смонтированному бинарнику)."
            )

    runtime_cfg = settings.CLI_RUNTIME_CONFIG.get(runtime) or {}
    logger.info(f"  Runtime config: {runtime_cfg}")
    
    command = runtime_cfg.get("command", "")
    logger.info(f"  Command из config: {command}")
    
    if not command:
        logger.error(f"  ❌ CLI для '{runtime}' не настроен")
        raise RuntimeError(f"CLI для '{runtime}' не настроен")
    
    if os.path.isabs(command):
        logger.info(f"  Command является абсолютным путем")
        if not Path(command).exists():
            logger.error(f"  ❌ CLI файл не существует: {command}")
            raise RuntimeError(
                f"CLI для '{runtime}' не найден: {command}. "
                f"Проверь путь или переменную окружения {env_var}"
            )
        logger.info(f"  ✅ Найден CLI по абсолютному пути: {command}")
        logger.info(f"{'🔍'*30}\n")
        return command

    logger.info(f"  Ищем command в PATH: {command}")
    resolved = shutil.which(command)
    logger.info(f"  Результат shutil.which: {resolved if resolved else 'НЕ НАЙДЕН'}")
    
    if not resolved:
        logger.error(f"  ❌ CLI для '{runtime}' не найден в PATH")
        if runtime == "cursor":
            raise RuntimeError(
                "CLI для 'cursor' не найден (бинарник agent). "
                "В Docker в .env задай CURSOR_CLI_PATH=/полный/путь/к/agent (бинарник должен быть в образе или смонтирован). "
                "На хосте добавь agent в PATH или задай CURSOR_CLI_PATH."
            )
        elif runtime == "claude":
            raise RuntimeError(
                "CLI для 'claude' не найден (бинарник claude). "
                "В Docker в .env задай CLAUDE_CLI_PATH=/полный/путь/к/claude (бинарник должен быть в образе или смонтирован). "
                "На хосте добавь claude в PATH или задай CLAUDE_CLI_PATH."
            )
        elif runtime == "codex":
            raise RuntimeError(
                "CLI для 'codex' не найден (команда codex). "
                "В Docker используй сервис codex или задай CODEX_CLI_PATH. "
                "На хосте: npm i -g @openai/codex. Укажи CODEX_API_KEY в .env для headless."
            )
        raise RuntimeError(
            f"CLI для '{runtime}' не найден: {command}. "
            f"Добавь в PATH или задай переменную окружения {env_var}"
        )
    
    logger.info(f"  ✅ Найден CLI в PATH: {resolved}")
    logger.info(f"{'🔍'*30}\n")
    return resolved


def _cli_env_var(runtime: str) -> str:
    return {
        "cursor": "CURSOR_CLI_PATH",
        "cursor_plan": "CURSOR_CLI_PATH",
        "claude": "CLAUDE_CLI_PATH",
        "codex": "CODEX_CLI_PATH",
        "opencode": "OPENCODE_CLI_PATH",
        "gemini": "GEMINI_CLI_PATH",
        "ralph": "RALPH_CLI_PATH",
    }.get(runtime, "CLI_PATH")


def _format_arg(runtime_cfg: Dict[str, Any], arg: str, workspace: str = None) -> str:
    logger.debug(f"  _format_arg: arg={arg}, workspace={workspace}")
    if arg != "{workspace}":
        logger.debug(f"    -> возвращаем arg как есть: {arg}")
        return arg
    if workspace:
        logger.debug(f"    -> заменяем {{workspace}} на: {workspace}")
        return workspace
    base_dir = str(getattr(settings, "BASE_DIR", ""))
    logger.debug(f"    -> используем BASE_DIR: {base_dir}")
    return base_dir


def _write_ralph_yml(path: Path, content: Dict[str, Any]) -> None:
    lines = []
    cli = content.get("cli", {})
    event_loop = content.get("event_loop", {})
    hats = content.get("hats", {})

    lines.append("cli:")
    lines.append(f"  backend: \"{cli.get('backend', 'cursor')}\"")
    lines.append("event_loop:")
    lines.append(f"  completion_promise: \"{event_loop.get('completion_promise', 'LOOP_COMPLETE')}\"")
    lines.append(f"  max_iterations: {event_loop.get('max_iterations', 50)}")
    lines.append(f"  starting_event: \"{event_loop.get('starting_event', 'task.start')}\"")
    lines.append("hats:")
    for hat_id, hat in hats.items():
        lines.append(f"  {hat_id}:")
        lines.append(f"    name: \"{hat.get('name', hat_id)}\"")
        lines.append(f"    description: \"{hat.get('description', '')}\"")
        triggers = hat.get("triggers", [])
        publishes = hat.get("publishes", [])
        lines.append(f"    triggers: {json.dumps(triggers)}")
        lines.append(f"    publishes: {json.dumps(publishes)}")
        instructions = (hat.get("instructions") or "").replace("\n", "\\n")
        lines.append(f"    instructions: \"{instructions}\"")

    path.write_text("\n".join(lines), encoding="utf-8")


def _get_user_servers_context(user_id: int, target_server_id: int = None) -> str:
    """
    Возвращает контекст о серверах пользователя из вкладки Servers для промпта воркфлоу.
    Если target_server_id указан — возвращает только этот сервер с явной инструкцией использовать его.
    Если серверы есть — возвращает инструкции и список; иначе пустую строку.
    Если задан MASTER_PASSWORD в env — расшифровывает пароли и подставляет команды подключения.
    """
    try:
        from servers.models import Server
        from passwords.encryption import PasswordEncryption
        master_pwd = os.environ.get("MASTER_PASSWORD", "").strip()
        
        qs = Server.objects.filter(user_id=user_id)
        if target_server_id:
            qs = qs.filter(id=target_server_id)
        servers = list(qs.only(
            "id", "name", "host", "port", "username", "auth_method", "key_path", "encrypted_password", "salt",
            "notes", "corporate_context",
        ))
        if not servers:
            return ""
        
        # Если указан конкретный сервер — даём явную и строгую инструкцию
        if target_server_id and len(servers) == 1:
            target_name = servers[0].name
            target_host = servers[0].host
            lines = [
                f"\n\n{'='*60}",
                f"=== СЕРВЕРНАЯ ЗАДАЧА: {target_name} ({target_host}) ===",
                f"{'='*60}",
                "",
                "!!! ЭТО СЕРВЕРНАЯ ЗАДАЧА - РАБОТАЙ ТОЛЬКО С СЕРВЕРОМ !!!",
                "",
                "ЗАПРЕЩЕНО:",
                "- НЕ читай файлы проекта (*.py, *.js и др.)",
                "- НЕ ищи функции или классы в коде",
                "- НЕ вызывай python функции или API",
                "- НЕ используй Glob, Grep, Read для поиска кода",
                "",
                "РАЗРЕШЕНО ТОЛЬКО:",
                f"- Выполнять SSH команды на сервере «{target_name}»",
                "- Использовать server_execute MCP tool",
                "- Стандартные Linux команды: df, free, ps, systemctl, apt и т.д.",
                "",
                f"Целевой сервер: {target_name}",
                f"Для выполнения команд используй:",
                f"  server_execute с server_name_or_id=\"{target_name}\"",
                "",
                f"Пример:",
                f"  tool server_execute {{\"server_name_or_id\": \"{target_name}\", \"command\": \"df -h\"}}",
                "",
            ]
            if servers[0].notes or servers[0].corporate_context:
                lines.append("Контекст сервера (учитывай при выполнении):")
                if servers[0].notes:
                    lines.append(f"  Заметки: {servers[0].notes.strip()}")
                if servers[0].corporate_context:
                    lines.append(f"  Корпоративный контекст: {servers[0].corporate_context.strip()}")
                lines.append("")
        else:
            lines = [
                "\n\n=== СЕРВЕРЫ ПОЛЬЗОВАТЕЛЯ (из вкладки Servers) ===",
                "ВАЖНО: Данные серверов хранятся в БД. НЕ ищи их в коде!",
                "Предпочитай MCP-инструменты servers_list / server_execute (сервер weu-servers) — это надежнее SSH из shell.",
                "Пример: tool server_execute {server_name_or_id: \"WEU SERVER\", command: \"uname -a\"}",
                "Если MCP недоступен, используй SSH напрямую по указанным данным.",
                "",
            ]
        for s in servers:
            auth = s.auth_method or "password"
            key_path = s.key_path or ""
            pwd_decrypted = ""
            if auth in ("password", "key_password") and s.encrypted_password and master_pwd and s.salt:
                try:
                    pwd_decrypted = PasswordEncryption.decrypt_password(s.encrypted_password, master_pwd, bytes(s.salt))
                except Exception as e:
                    logger.debug(f"Password decryption failed for server {s.name}: {e}")
                    pwd_decrypted = ""
            # Формируем готовую команду подключения
            cmd_hint = ""
            if auth == "key" and key_path:
                cmd_hint = f"ssh -i {key_path} {s.username}@{s.host} -p {s.port} '<command>'"
            elif pwd_decrypted:
                safe_pwd = pwd_decrypted.replace("'", "'\\''")
                cmd_hint = f"sshpass -p '{safe_pwd}' ssh -o StrictHostKeyChecking=no {s.username}@{s.host} -p {s.port} '<command>'"
            else:
                cmd_hint = f"ssh {s.username}@{s.host} -p {s.port} '<command>'  # пароль неизвестен, задай MASTER_PASSWORD в env"
            lines.append(f"- {s.name}:")
            lines.append(f"    {cmd_hint}")
            if s.notes or s.corporate_context:
                if s.notes:
                    lines.append(f"    Заметки: {s.notes.strip()}")
                if s.corporate_context:
                    lines.append(f"    Корпоративный контекст: {s.corporate_context.strip()}")
        lines.append("")
        lines.append("sshpass уже установлен. При ошибке подключения — проверь host/port/username.")
        lines.append("")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"_get_user_servers_context error: {e}")
        return ""


def _execute_workflow_run(run_id: int):
    run_obj = AgentWorkflowRun.objects.get(id=run_id)
    workflow = run_obj.workflow
    run_obj.status = "running"
    run_obj.started_at = timezone.now()

    # Контекст серверов: загружаем ТОЛЬКО если указан target_server
    # Если target_server не указан — workflow не связан с серверами, не показываем их
    user_id = run_obj.initiated_by_id
    target_server_id = workflow.target_server_id
    servers_context = ""
    
    if target_server_id and user_id:
        # Только если явно указан целевой сервер — загружаем его данные
        servers_context = _get_user_servers_context(user_id, target_server_id)
    
    # Получаем путь к workspace
    workspace = _get_workspace_path(workflow)
    run_obj.logs = (run_obj.logs or "") + f"[Workflow started]\n[Workspace: {workspace}]\n"
    _append_log_event(
        run_obj,
        {
            "type": "workflow",
            "subtype": "start",
            "title": "Старт workflow",
            "workflow_id": workflow.id,
            "workflow_name": workflow.name,
            "workspace": workspace,
        },
    )
    if target_server_id:
        run_obj.logs = (run_obj.logs or "") + f"[Target server: {workflow.target_server.name if workflow.target_server else target_server_id}]\n"
        run_obj.logs = (run_obj.logs or "") + "[Servers context loaded from DB]\n"
    else:
        run_obj.logs = (run_obj.logs or "") + "[No target server - local/code-only workflow]\n"
    run_obj.save(update_fields=["status", "started_at", "logs", "log_events", "meta"])

    steps = (workflow.script or {}).get("steps", [])
    step_results = []

    # Определяем тип задачи
    is_server_task = workflow.target_server_id is not None

    # Фаза проверки задачи через Cursor (ask) перед запуском
    # ПРОПУСКАЕМ для серверных задач - им не нужен анализ кода!
    if getattr(settings, "ANALYZE_TASK_BEFORE_RUN", True) and steps and workspace and not is_server_task:
        run_obj.logs = (run_obj.logs or "") + "\n[Phase: Pre-analysis (Cursor — проверка задачи перед запуском)]\n"
        _append_log_event(
            run_obj,
            {
                "type": "phase",
                "subtype": "start",
                "title": "Cursor analyze",
                "message": "Проверка шагов перед запуском",
            },
        )
        run_obj.save(update_fields=["logs", "log_events", "meta"])
        summary_lines = [f"Воркфлоу: {workflow.name}. Шаги ({len(steps)}):"]
        for i, s in enumerate(steps[:20], 1):
            title = s.get("title", f"Step {i}")
            prompt_preview = (s.get("prompt") or "")[:300]
            summary_lines.append(f"\n{i}. {title}\n   {prompt_preview}")
        task_summary = "\n".join(summary_lines)
        analyze_result = _run_cursor_ask_analyze(workspace, task_summary, timeout_sec=90)
        run_obj.logs = (run_obj.logs or "") + (analyze_result.get("output", "") or "")[:4000] + "\n"
        if analyze_result.get("ready"):
            run_obj.logs = (run_obj.logs or "") + "[Cursor: READY — запуск выполнения]\n"
        else:
            run_obj.logs = (run_obj.logs or "") + "[Cursor: анализ выполнен, запуск выполнения]\n"
        _append_log_event(
            run_obj,
            {
                "type": "phase",
                "subtype": "done",
                "title": "Cursor analyze",
                "status": "ready" if analyze_result.get("ready") else "review",
            },
        )
        run_obj.save(update_fields=["logs", "log_events", "meta"])

    try:
        # Определяем CLI агента из глобальных настроек
        from app.core.model_config import model_manager
        cli_runtime = model_manager.config.default_provider or "cursor"
        
        # Если default_provider = "auto" или "ralph" - fallback на cursor
        if cli_runtime in ["auto", "ralph"]:
            cli_runtime = "cursor"
            logger.warning(f"default_provider={cli_runtime} is invalid, using cursor")
        
        # Логируем настройки для отладки
        logger.info(f"Workflow {workflow.id}: CLI runtime={cli_runtime}, orchestrator_mode={model_manager.config.default_orchestrator_mode}")
        
        # Режим оркестратора определяет КАК выполнять (Ralph с итерациями или обычный режим)
        # CLI runtime определяет ЧТО запускать (cursor/claude)
        orchestrator_mode = model_manager.config.default_orchestrator_mode or "ralph_internal"
        
        # Ralph mode: многократные вызовы CLI агента с итерациями
        if orchestrator_mode.startswith("ralph"):
            run_obj.logs = (run_obj.logs or "") + (
                f"[Settings: CLI={cli_runtime}, orchestrator={orchestrator_mode}]\n"
                f"[Ralph mode: executing via {cli_runtime} CLI with iterations]\n"
            )
            run_obj.save(update_fields=["logs"])
            _run_steps_with_backend(
                run_obj=run_obj,
                steps=steps,
                runtime=cli_runtime,  # Используем cursor/claude
                workflow=workflow,
                step_results=step_results,
                workspace=workspace,
                servers_context=servers_context,
            )
        else:
            # Direct mode: прямой вызов CLI агента без Ralph оркестрации
            run_obj.logs = (run_obj.logs or "") + (
                f"[Settings: CLI={cli_runtime}, orchestrator={orchestrator_mode}]\n"
                f"[Direct mode: single {cli_runtime} CLI call]\n"
            )
            run_obj.save(update_fields=["logs"])
            _run_steps_with_backend(
                run_obj=run_obj,
                steps=steps,
                runtime=cli_runtime,  # Используем cursor/claude
                workflow=workflow,
                step_results=step_results,
                workspace=workspace,
                servers_context=servers_context,
            )

        run_obj.status = "succeeded"
        run_obj.output_text = json.dumps(step_results, ensure_ascii=False)
        run_obj.meta = {**(run_obj.meta or {}), "steps": len(steps), "workspace": workspace}
    except Exception as exc:
        run_obj.status = "failed"
        run_obj.logs = (run_obj.logs or "") + f"\n{exc}\n"
        run_obj.output_text = json.dumps(step_results, ensure_ascii=False)
    finally:
        run_obj.finished_at = timezone.now()
        _append_log_event(
            run_obj,
            {
                "type": "workflow",
                "subtype": "finish",
                "title": "Завершение workflow",
                "status": run_obj.status,
            },
        )
        run_obj.save()


def _run_steps_with_backend(
    run_obj: AgentWorkflowRun,
    steps: list,
    runtime: str,
    workflow: AgentWorkflow,
    step_results: list,
    workspace: str = None,
    start_from_step: int = 1,
    servers_context: str = "",
) -> None:
    # Заменяем "auto" на default_provider СРАЗУ
    if runtime == "auto":
        from app.core.model_config import model_manager
        runtime = model_manager.config.default_provider or "cursor"
        logger.info(f"_run_steps_with_backend: replaced 'auto' with '{runtime}'")
    
    # Логируем runtime для отладки
    logger.info(f"_run_steps_with_backend called with runtime={runtime} for workflow {workflow.id}")
    
    # Подготовка environment variables для CLI (cursor, claude, codex и другие)
    extra_env = None
    mcp_config_file = None  # Путь к MCP конфигу для Claude CLI (--mcp-config)
    if runtime in ["cursor", "claude", "codex"]:
        extra_env = _get_cursor_cli_extra_env() if runtime == "cursor" else {}
        extra_env = dict(extra_env or {})
        extra_env.setdefault("HOME", os.path.expanduser("~"))
        # Codex: CODEX_API_KEY или OPENAI_API_KEY для headless (codex exec)
        if runtime == "codex":
            codex_key = os.getenv("CODEX_API_KEY") or os.getenv("OPENAI_API_KEY")
            if codex_key:
                extra_env["CODEX_API_KEY"] = codex_key
            extra_env["CODEX_UNSAFE_ALLOW_NO_SANDBOX"] = "1"  # для Docker

        if run_obj.initiated_by_id:
            extra_env.setdefault("WEU_USER_ID", str(run_obj.initiated_by_id))
            if runtime in ["cursor", "claude"]:
                mcp_path = _ensure_mcp_servers_config(workspace, run_obj.initiated_by_id)
                if mcp_path:
                    extra_env["MCP_CONFIG_PATH"] = mcp_path
                    mcp_config_file = mcp_path  # Для Claude CLI --mcp-config
                    if runtime == "cursor" and workspace:
                        _write_cursor_mcp_json(workspace, mcp_path)
                        _write_cursor_cli_permissions(workspace)
        
        # Передаём целевой сервер в переменные окружения для MCP-инструментов
        if workflow.target_server_id:
            extra_env["WEU_TARGET_SERVER_ID"] = str(workflow.target_server_id)
            if workflow.target_server:
                extra_env["WEU_TARGET_SERVER_NAME"] = workflow.target_server.name
                logger.info(f"Workflow {workflow.id}: target_server={workflow.target_server.name} (id={workflow.target_server_id})")
        
        # Для Claude НЕ передаём ANTHROPIC_API_KEY - используем авторизованную сессию Pro
        # Если нужен API режим - раскомментируйте:
        # if runtime == "claude":
        #     import os
        #     if os.getenv("ANTHROPIC_API_KEY"):
        #         extra_env["ANTHROPIC_API_KEY"] = os.getenv("ANTHROPIC_API_KEY")
    max_retries = getattr(run_obj, "max_retries", None) or 3
    step_results_existing = list(run_obj.step_results or [])

    for idx, step in enumerate(steps, start=1):
        if idx < start_from_step:
            existing = [r for r in step_results_existing if r.get("step_idx") == idx]
            if existing and existing[-1].get("status") in ("completed", "skipped"):
                continue
        run_obj.current_step = idx
        run_obj.retry_count = 0
        run_obj.save(update_fields=["current_step", "retry_count"])

        step_title = step.get("title", f"Step {idx}")
        _append_log_event(
            run_obj,
            {
                "type": "step",
                "subtype": "start",
                "title": step_title,
                "step_idx": idx,
                "prompt_preview": (step.get("prompt") or "")[:200],
            },
        )
        run_obj.save(update_fields=["log_events", "meta"])
        step_prompt = step.get("prompt", "")
        completion_promise = (step.get("completion_promise") or "STEP_DONE").strip()
        max_iterations = step.get("max_iterations", 10)
        if isinstance(max_iterations, str) and max_iterations.isdigit():
            max_iterations = int(max_iterations)
        if max_iterations <= 0:
            max_iterations = 10
        use_ralph_loop = step.get("use_ralph_loop", True)
        verify_prompt = step.get("verify_prompt")
        verify_promise = step.get("verify_promise", "PASS")
        
        # Выбор модели: step-level override > workflow-level > default (auto)
        workflow_model = (workflow.script or {}).get("model", "auto")
        step_model = step.get("model")  # step-level override (если разрешено)
        effective_model = step_model if step_model and step_model != "auto" else workflow_model
        
        # Заменяем "auto" на default_provider из настроек
        if effective_model == "auto":
            from app.core.model_config import model_manager
            effective_model = model_manager.config.default_provider or "cursor"

        # "ralph" - это оркестратор, не CLI runtime. Заменяем на текущий runtime
        if effective_model == "ralph":
            effective_model = runtime if runtime not in ("ralph", "auto") else "cursor"
            logger.warning(f"Replaced 'ralph' model with '{effective_model}' (ralph is orchestrator, not CLI)")

        # Не передаём --model если значение равно runtime или "auto"
        # (CLI сами выберут модель по умолчанию)
        cli_model = None
        if effective_model not in ("auto", runtime, "cursor", "claude", "gemini"):
            cli_model = effective_model

        config = {
            "use_ralph_loop": use_ralph_loop,
            "completion_promise": completion_promise,
            "max_iterations": max_iterations,
            "model": cli_model,  # None = CLI выберет сам
        }

        # Для Claude CLI передаём MCP конфиг (server_execute и др.)
        if runtime == "claude" and mcp_config_file:
            config["mcp-config"] = mcp_config_file

        # Логируем используемую модель
        model_source = "step" if step_model and step_model != "auto" else "workflow"
        model_info = cli_model if cli_model else f"{runtime} default"
        run_obj.logs = (run_obj.logs or "") + f"\n[Step {idx}: {step_title}] Model: {model_info} (from {model_source})\n"
        run_obj.save(update_fields=["logs"])

        if runtime != "cursor":
            config["specific_model"] = (workflow.script or {}).get("specific_model")

        step_success = False
        last_error = None
        retry_attempt = 0
        while retry_attempt <= max_retries and not step_success:
            try:
                run_obj.retry_count = retry_attempt
                run_obj.save(update_fields=["retry_count"])
                current_prompt_base = step_prompt
                if servers_context:
                    current_prompt_base = servers_context + "\n\n" + current_prompt_base
                if retry_attempt > 0:
                    current_prompt_base = (
                        f"Previous attempt failed with error: {last_error}\n\n"
                        f"Please fix the issue and try again.\n\nOriginal task:\n{step_prompt}"
                    )
                    if servers_context:
                        current_prompt_base = servers_context + "\n\n" + current_prompt_base
                    run_obj.logs = (run_obj.logs or "") + f"\n[Retry {retry_attempt}/{max_retries} for {step_title}]\n"
                    run_obj.save(update_fields=["logs"])

                # Ralph-цикл: несколько итераций агента до completion promise (безотказное написание кода)
                inner_max = 1 if not use_ralph_loop else max_iterations
                ralph_iteration = 0
                last_output = ""
                result = None
                while ralph_iteration < inner_max:
                    ralph_iteration += 1
                    if ralph_iteration == 1:
                        current_prompt = current_prompt_base
                    else:
                        current_prompt = (
                            "Продолжай работу по задаче. Проверь предыдущий вывод и доведи до конца.\n\n"
                            f"Изначальная задача:\n{current_prompt_base}\n\n"
                            f"Предыдущий вывод агента:\n{last_output}\n\n"
                            f"Если задача полностью выполнена, выведи ровно: <promise>{completion_promise}</promise>"
                        )
                    if completion_promise and (ralph_iteration == 1 or "promise" not in current_prompt):
                        current_prompt = f"{current_prompt}\n\nWhen complete output exactly: <promise>{completion_promise}</promise>."
                    step_label = f"{step_title}" if inner_max <= 1 else f"{step_title} (Ralph {ralph_iteration}/{inner_max})"
                    cmd = _build_cli_command(runtime, current_prompt, config, workspace)
                    
                    # Сохраняем команду в meta для админ-просмотра
                    run_meta = run_obj.meta or {}
                    run_meta[f"step_{idx}_cmd"] = _sanitize_command(cmd)
                    run_meta[f"step_{idx}_cmd_full"] = cmd
                    run_meta[f"step_{idx}_prompt"] = current_prompt[:8000]
                    run_meta[f"step_{idx}_workspace"] = workspace
                    run_meta[f"step_{idx}_runtime"] = runtime
                    run_obj.meta = run_meta
                    run_obj.save(update_fields=["meta"])
                    
                    # ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ ПЕРЕД ЗАПУСКОМ
                    logger.info(f"\n{'='*70}")
                    logger.info(f"🚀 ПОДГОТОВКА К ЗАПУСКУ АГЕНТА")
                    logger.info(f"{'='*70}")
                    logger.info(f"📌 Step: {step_title}")
                    logger.info(f"📌 Label: {step_label}")
                    logger.info(f"📌 Runtime: {runtime}")
                    logger.info(f"📌 Model: {config.get('model', 'N/A')}")
                    logger.info(f"📌 Workspace: {workspace}")
                    logger.info(f"📌 Ralph iteration: {ralph_iteration}/{inner_max}")
                    logger.info(f"📌 Retry attempt: {retry_attempt}/{max_retries}")
                    
                    # ПРОВЕРКА РАБОТОСПОСОБНОСТИ CLI
                    if ralph_iteration == 1 and retry_attempt == 0:  # Только первый раз
                        try:
                            logger.info(f"\n🧪 ТЕСТ РАБОТОСПОСОБНОСТИ CLI")
                            test_cmd_path = _resolve_cli_command(runtime)
                            logger.info(f"  CLI путь: {test_cmd_path}")
                            
                            # Проверяем что файл существует
                            if not Path(test_cmd_path).exists():
                                logger.error(f"  ❌ CLI файл не существует!")
                            else:
                                logger.info(f"  ✅ CLI файл существует")
                                
                                # Проверяем что файл исполняемый
                                if os.access(test_cmd_path, os.X_OK):
                                    logger.info(f"  ✅ CLI файл имеет права на выполнение")
                                else:
                                    logger.warning(f"  ⚠️ CLI файл не имеет прав на выполнение!")
                                
                                # Пробуем запустить с --version
                                try:
                                    logger.info(f"  Пробуем запустить: {test_cmd_path} --version")
                                    version_result = subprocess.run(
                                        [test_cmd_path, "--version"],
                                        capture_output=True,
                                        text=True,
                                        timeout=5
                                    )
                                    logger.info(f"  Exit code: {version_result.returncode}")
                                    if version_result.stdout:
                                        logger.info(f"  STDOUT: {version_result.stdout.strip()}")
                                    if version_result.stderr:
                                        logger.info(f"  STDERR: {version_result.stderr.strip()}")
                                except Exception as ve:
                                    logger.error(f"  ❌ Ошибка запуска CLI: {ve}")
                        except Exception as test_e:
                            logger.error(f"  ❌ Ошибка теста CLI: {test_e}")
                    
                    logger.info(f"\n🔧 КОНФИГУРАЦИЯ:")
                    for key, value in config.items():
                        if key == 'prompt':
                            logger.info(f"  {key}: <{len(str(value))} символов>")
                        else:
                            logger.info(f"  {key}: {value}")
                    
                    logger.info(f"\n💬 ПРОМПТ (первые 500 символов):")
                    logger.info(f"{current_prompt[:500]}...")
                    
                    # АНАЛИЗ ПРОМПТА
                    logger.info(f"\n🔎 АНАЛИЗ ПРОМПТА:")
                    logger.info(f"  Длина: {len(current_prompt)} символов")
                    if "prod server" in current_prompt or "172.25.173.251" in current_prompt:
                        logger.info(f"  ✅ Содержит упоминание 'prod server' или IP 172.25.173.251")
                    else:
                        logger.warning(f"  ⚠️ НЕ содержит упоминание 'prod server' или IP 172.25.173.251")
                    
                    if "server_execute" in current_prompt:
                        logger.info(f"  ✅ Содержит инструкцию об использовании 'server_execute'")
                    else:
                        logger.warning(f"  ⚠️ НЕ содержит инструкцию об использовании 'server_execute'")
                    
                    if "СЕРВЕРНАЯ ЗАДАЧА" in current_prompt or "SERVER TASK" in current_prompt:
                        logger.info(f"  ✅ Содержит метку серверной задачи")
                    else:
                        logger.warning(f"  ⚠️ НЕ содержит метку серверной задачи")
                    
                    logger.info(f"\n🎯 ПОЛНАЯ КОМАНДА CLI ({len(cmd)} элементов):")
                    _v_wf_cmd = cmd[:-1] + [current_prompt] if (runtime == "codex" and cmd and cmd[-1] == "-") else cmd
                    cmd_full = shlex.join(_v_wf_cmd) if (sys.version_info >= (3, 8)) else " ".join(cmd)
                    logger.info(f"{cmd_full}")
                    
                    if extra_env:
                        logger.info(f"\n🌍 ДОПОЛНИТЕЛЬНЫЕ ENV переменные:")
                        for k, v in extra_env.items():
                            logger.info(f"  {k}: {v}")
                    
                    logger.info(f"{'='*70}\n")
                    
                    # Старый лог для обратной совместимости
                    cmd_preview = shlex.join(_v_wf_cmd[:5]) + "..." if len(cmd) > 5 else cmd_full
                    logger.info(f"Executing CLI: {cmd_preview} (runtime={runtime}, model={config.get('model', 'N/A')})")
                    
                    result = _run_cli_stream(cmd, run_obj, step_label=step_label, extra_env=extra_env, runtime=runtime, stdin_prompt=current_prompt if runtime == "codex" else None)
                    last_output = result.get("output", "") or ""
                    
                    # ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ РЕЗУЛЬТАТА
                    logger.info(f"\n{'='*70}")
                    logger.info(f"📊 РЕЗУЛЬТАТ ВЫПОЛНЕНИЯ АГЕНТА")
                    logger.info(f"{'='*70}")
                    logger.info(f"✅ Success: {result.get('success', False)}")
                    logger.info(f"🔢 Exit Code: {result.get('exit_code', 'unknown')}")
                    logger.info(f"📏 Output Length: {len(last_output)} символов")
                    
                    if last_output:
                        logger.info(f"\n📝 ВЫВОД (первые 1000 символов):")
                        logger.info(f"{last_output[:1000]}")
                        if len(last_output) > 1000:
                            logger.info(f"... и еще {len(last_output) - 1000} символов")
                        
                        logger.info(f"\n📝 ВЫВОД (последние 500 символов):")
                        logger.info(f"{last_output[-500:]}")
                    else:
                        logger.warning(f"⚠️ ВЫВОД ПУСТОЙ!")
                    
                    logger.info(f"{'='*70}\n")
                    
                    if not result.get("success"):
                        logger.error(f"\n{'❌'*35}")
                        logger.error(f"ОШИБКА ВЫПОЛНЕНИЯ!")
                        logger.error(f"{'❌'*35}")
                        
                        last_error = last_output or f"exit code {result.get('exit_code', -1)}"
                        
                        logger.error(f"🔍 Анализ ошибки:")
                        logger.error(f"  Exit code: {result.get('exit_code', -1)}")
                        logger.error(f"  Длина вывода: {len(last_output)} символов")
                        
                        if "Connection stalled" in last_error or "connection stalled" in last_error.lower():
                            logger.error(f"  Тип ошибки: Connection stalled")
                            last_error = "Cursor API connection stalled. Проверьте сеть и подписку Cursor; повторите шаг."
                        elif result.get('exit_code') == -9:
                            logger.error(f"  Тип ошибки: Процесс убит (SIGKILL) - возможно нехватка памяти")
                        elif result.get('exit_code') == 127:
                            logger.error(f"  Тип ошибки: Команда не найдена")
                        elif not last_output:
                            logger.error(f"  Тип ошибки: Пустой вывод - процесс завершился без вывода")
                        else:
                            logger.error(f"  Тип ошибки: Неизвестная ошибка")
                            last_error = last_error[:500] if len(last_error) > 500 else last_error
                        
                        logger.error(f"\n  Текст ошибки: {last_error}")
                        logger.error(f"{'❌'*35}\n")
                        break
                    if completion_promise and _promise_found(last_output, completion_promise):
                        break
                if inner_max <= 1:
                    pass
                elif not result or not result.get("success"):
                    pass
                elif completion_promise and not _promise_found(last_output, completion_promise):
                    last_error = f"Ralph: promise <{completion_promise}> не найден после {inner_max} итераций. Повторите шаг или увеличьте max_iterations в шаге."
                    retry_attempt += 1
                    run_obj.logs = (run_obj.logs or "") + f"\n[Step]: {last_error}\n"
                    run_obj.save(update_fields=["logs"])
                    continue

                if result and not result.get("success"):
                    retry_attempt += 1
                    run_obj.logs = (run_obj.logs or "") + f"\n[Step failed]: {last_error}\n"
                    run_obj.save(update_fields=["logs"])
                    continue
                if verify_prompt:
                    verify_text = f"{verify_prompt}\n\nWhen verified output exactly: <promise>{verify_promise}</promise>." if verify_promise else verify_prompt
                    verify_cmd = _build_cli_command(runtime, verify_text, {**config, "completion_promise": verify_promise}, workspace)
                    verify_result = _run_cli_stream(verify_cmd, run_obj, step_label=f"{step_title} - verify", extra_env=extra_env, runtime=runtime, stdin_prompt=verify_text if runtime == "codex" else None)
                    if verify_promise and not _promise_found(verify_result.get("output", ""), verify_promise):
                        last_error = f"Verification failed: expected {verify_promise}"
                        retry_attempt += 1
                        continue
                step_success = True
                sr = {"step_idx": idx, "step": step_title, "status": "completed", "retries": retry_attempt, "result": result, "ralph_iterations": ralph_iteration if inner_max > 1 else None}
                step_results.append(sr)
                step_results_existing.append(sr)
                run_obj.step_results = step_results_existing
                run_obj.save(update_fields=["step_results"])
                _append_log_event(
                    run_obj,
                    {
                        "type": "step",
                        "subtype": "completed",
                        "title": step_title,
                        "step_idx": idx,
                        "retries": retry_attempt,
                        "status": "completed",
                    },
                )
                run_obj.save(update_fields=["log_events", "meta"])
            except Exception as e:
                last_error = str(e)
                retry_attempt += 1
                run_obj.logs = (run_obj.logs or "") + f"\n[Error in {step_title}]: {last_error}\n"
                run_obj.save(update_fields=["logs"])
        if not step_success:
            sr = {"step_idx": idx, "step": step_title, "status": "failed", "retries": retry_attempt, "error": last_error}
            step_results_existing.append(sr)
            run_obj.step_results = step_results_existing
            run_obj.save(update_fields=["step_results"])
            _append_log_event(
                run_obj,
                {
                    "type": "step",
                    "subtype": "failed",
                    "title": step_title,
                    "step_idx": idx,
                    "retries": retry_attempt,
                    "status": "failed",
                    "error": last_error,
                },
            )
            run_obj.save(update_fields=["log_events", "meta"])
            raise RuntimeError(f"Step {idx} ({step_title}) failed after {max_retries} retries: {last_error}")


def _start_workflow_run(workflow: AgentWorkflow, user) -> AgentWorkflowRun:
    run = AgentWorkflowRun.objects.create(
        workflow=workflow,
        initiated_by=user,
        status="queued",
        current_step=0,
    )
    thread = threading.Thread(target=_execute_workflow_run, args=(run.id,), daemon=True)
    thread.start()
    return run


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_workflow_run_status(request, run_id: int):
    run = get_object_or_404(
        AgentWorkflowRun.objects.select_related("workflow"),
        id=run_id,
        initiated_by=request.user,
    )
    after_id = request.GET.get("after_id")
    events = list(run.log_events or [])
    if after_id:
        try:
            after_id_int = int(after_id)
            events = [e for e in events if int(e.get("id", 0)) > after_id_int]
        except ValueError:
            events = events[-200:]
    else:
        events = events[-200:]
    last_event_id = events[-1]["id"] if events else (run.log_events or [])[-1]["id"] if run.log_events else 0
    script = run.workflow.script or {}
    steps = script.get("steps", [])
    total_steps = len(steps)
    current_step_title = ""
    if steps and 0 < run.current_step <= total_steps:
        step = steps[run.current_step - 1]
        current_step_title = step.get("title") or step.get("prompt", "")[:50]
    step_results_map = {r.get("step_idx"): r for r in (run.step_results or [])}
    steps_info = []
    for idx, step in enumerate(steps, start=1):
        info = {
            "idx": idx,
            "title": step.get("title") or f"Шаг {idx}",
            "prompt": (step.get("prompt") or "")[:200],
            "has_verify": bool(step.get("verify_prompt")),
            "status": "pending",
        }
        if idx in step_results_map:
            r = step_results_map[idx]
            info["status"] = r.get("status", "unknown")
            info["retries"] = r.get("retries", 0)
            info["error"] = r.get("error")
        elif idx == run.current_step and run.status == "running":
            info["status"] = "running"
            info["retries"] = getattr(run, "retry_count", 0)
        steps_info.append(info)
    return JsonResponse(
        {
            "status": run.status,
            "current_step": run.current_step,
            "total_steps": total_steps,
            "current_step_title": current_step_title,
            "retry_count": getattr(run, "retry_count", 0),
            "max_retries": getattr(run, "max_retries", 3),
            "steps": steps_info,
            "logs": (run.logs or "")[-8000:] if run.logs else "",
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "events": events,
            "last_event_id": last_event_id,
        }
    )


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_stop(request, run_id: int):
    run = get_object_or_404(AgentWorkflowRun, id=run_id, initiated_by=request.user)
    meta = run.meta or {}
    for key, value in list(meta.items()):
        if str(key).startswith("pid_"):
            try:
                if os.name == "nt":
                    subprocess.Popen(["taskkill", "/PID", str(value), "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.kill(int(value), 9)
            except Exception:
                pass
    run.status = "failed"
    run.logs = (run.logs or "") + "\n[Stopped by user]\n"
    run.finished_at = timezone.now()
    run.save(update_fields=["status", "logs", "finished_at"])
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_restart(request, run_id: int):
    old_run = get_object_or_404(AgentWorkflowRun, id=run_id, initiated_by=request.user)
    workflow = old_run.workflow
    new_run = _start_workflow_run(workflow, request.user)
    return JsonResponse({"success": True, "run_id": new_run.id})


def _continue_workflow_run(run_id: int, from_step: int):
    run_obj = AgentWorkflowRun.objects.get(pk=run_id)
    workflow = run_obj.workflow
    run_obj.status = "running"
    if not run_obj.started_at:
        run_obj.started_at = timezone.now()
    workspace = _get_workspace_path(workflow)
    user_id = run_obj.initiated_by_id
    target_server_id = workflow.target_server_id
    
    # Контекст серверов: ТОЛЬКО если указан target_server
    servers_context = ""
    if target_server_id and user_id:
        servers_context = _get_user_servers_context(user_id, target_server_id)
    
    run_obj.save(update_fields=["status", "started_at"])
    steps = (workflow.script or {}).get("steps", [])
    step_results = []
    try:
        if workflow.runtime == "ralph":
            backend = (
                ((workflow.script or {}).get("ralph_yml") or {}).get("cli", {}).get("backend")
                or (workflow.script or {}).get("backend")
                or "cursor"
            )
            _run_steps_with_backend(
                run_obj=run_obj, steps=steps, runtime=backend, workflow=workflow,
                step_results=step_results, workspace=workspace, start_from_step=from_step,
                servers_context=servers_context,
            )
        else:
            _run_steps_with_backend(
                run_obj=run_obj, steps=steps, runtime=workflow.runtime, workflow=workflow,
                step_results=step_results, workspace=workspace, start_from_step=from_step,
                servers_context=servers_context,
            )
        run_obj.status = "succeeded"
        run_obj.output_text = json.dumps(step_results, ensure_ascii=False)
    except Exception as exc:
        run_obj.status = "failed"
        run_obj.logs = (run_obj.logs or "") + f"\n{exc}\n"
        run_obj.output_text = json.dumps(step_results, ensure_ascii=False)
    finally:
        run_obj.finished_at = timezone.now()
        run_obj.save()


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_skip_step(request, run_id: int):
    run = get_object_or_404(AgentWorkflowRun, id=run_id, initiated_by=request.user)
    if run.status not in ("failed", "paused"):
        return JsonResponse({"error": "Can only skip steps for failed/paused workflows"}, status=400)
    current_step = run.current_step
    steps = (run.workflow.script or {}).get("steps", [])
    if current_step >= len(steps):
        return JsonResponse({"error": "No more steps to skip"}, status=400)
    step_results = run.step_results or []
    step_title = steps[current_step - 1].get("title", f"Шаг {current_step}")
    step_results.append({"step_idx": current_step, "step": step_title, "status": "skipped", "retries": 0})
    run.step_results = step_results
    run.logs = (run.logs or "") + f"\n[Шаг {current_step} ({step_title}) пропущен пользователем]\n"
    run.save(update_fields=["step_results", "logs"])
    next_step = current_step + 1
    if next_step > len(steps):
        run.status = "succeeded"
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "finished_at"])
        return JsonResponse({"success": True, "message": "Workflow completed (last step skipped)"})
    run.status = "queued"
    run.save(update_fields=["status"])
    thread = threading.Thread(target=_continue_workflow_run, args=(run.id, next_step), daemon=True)
    thread.start()
    return JsonResponse({"success": True, "message": f"Step {current_step} skipped, continuing from step {next_step}"})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_skip_specific_step(request, run_id: int):
    """Пропустить конкретный шаг по индексу"""
    run = get_object_or_404(AgentWorkflowRun, id=run_id, initiated_by=request.user)
    data = _parse_json_request(request)
    if run.status not in ("failed", "paused"):
        return JsonResponse({"error": "Can only skip steps for failed/paused workflows"}, status=400)
    step_idx = data.get("step_idx")
    if not step_idx:
        return JsonResponse({"error": "step_idx is required"}, status=400)
    steps = (run.workflow.script or {}).get("steps", [])
    if step_idx < 1 or step_idx > len(steps):
        return JsonResponse({"error": f"Invalid step index: {step_idx}"}, status=400)
    step_results = run.step_results or []
    step_results = [r for r in step_results if r.get("step_idx") != step_idx]
    step_title = steps[step_idx - 1].get("title", f"Шаг {step_idx}")
    step_results.append({"step_idx": step_idx, "step": step_title, "status": "skipped", "retries": 0})
    run.step_results = step_results
    run.logs = (run.logs or "") + f"\n[Шаг {step_idx} ({step_title}) пропущен пользователем]\n"
    completed_or_skipped = {r.get("step_idx") for r in step_results if r.get("status") in ("completed", "skipped")}
    next_step = None
    for i in range(1, len(steps) + 1):
        if i not in completed_or_skipped:
            next_step = i
            break
    if next_step is None:
        run.status = "succeeded"
        run.finished_at = timezone.now()
        run.save(update_fields=["step_results", "logs", "status", "finished_at"])
        return JsonResponse({"success": True, "message": "Workflow completed (all steps done or skipped)"})
    run.status = "queued"
    run.save(update_fields=["step_results", "logs", "status"])
    thread = threading.Thread(target=_continue_workflow_run, args=(run.id, next_step), daemon=True)
    thread.start()
    return JsonResponse({"success": True, "message": f"Step {step_idx} skipped, continuing from step {next_step}"})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_continue(request, run_id: int):
    run = get_object_or_404(AgentWorkflowRun, id=run_id, initiated_by=request.user)
    data = _parse_json_request(request)
    if run.status not in ("failed", "paused"):
        return JsonResponse({"error": "Can only continue failed/paused workflows"}, status=400)
    from_step = data.get("from_step", run.current_step)
    steps = (run.workflow.script or {}).get("steps", [])
    if from_step < 1 or from_step > len(steps):
        return JsonResponse({"error": f"Invalid step number: {from_step}"}, status=400)
    run.status = "queued"
    run.logs = (run.logs or "") + f"\n[Продолжение с шага {from_step}]\n"
    run.save(update_fields=["status", "logs"])
    thread = threading.Thread(target=_continue_workflow_run, args=(run.id, from_step), daemon=True)
    thread.start()
    return JsonResponse({"success": True, "message": f"Continuing from step {from_step}"})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_retry_step(request, run_id: int):
    run = get_object_or_404(AgentWorkflowRun, id=run_id, initiated_by=request.user)
    if run.status not in ("failed", "paused"):
        return JsonResponse({"error": "Can only retry failed/paused workflows"}, status=400)
    current_step = run.current_step
    step_results = run.step_results or []
    step_results = [r for r in step_results if r.get("step_idx") != current_step]
    run.step_results = step_results
    run.retry_count = 0
    run.status = "queued"
    run.logs = (run.logs or "") + f"\n[Повтор шага {current_step}]\n"
    run.save(update_fields=["step_results", "retry_count", "status", "logs"])
    thread = threading.Thread(target=_continue_workflow_run, args=(run.id, current_step), daemon=True)
    thread.start()
    return JsonResponse({"success": True, "message": f"Retrying step {current_step}"})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_assist_config(request):
    data = _parse_json_request(request)
    task = data.get("task", "").strip()
    if not task:
        return JsonResponse({"error": "Task is required"}, status=400)

    parsed = _generate_profile_config(task)
    return JsonResponse(
        {
            "success": True,
            "config": parsed,
            "questions": parsed.get("questions") or [],
            "assumptions": parsed.get("assumptions") or [],
        }
    )


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_assist_auto(request):
    data = _parse_json_request(request)
    task = data.get("task", "").strip()
    
    # Используем default_provider из настроек вместо "ralph"
    from app.core.model_config import model_manager
    default_runtime = model_manager.config.default_provider or "cursor"
    runtime = data.get("runtime", default_runtime)
    
    action = data.get("action", "both")
    run_workflow = bool(data.get("run_workflow", True))
    
    # Обработка проекта
    project_path = data.get("project_path", "").strip()
    create_new_project = data.get("create_new_project", False)
    new_project_name = data.get("new_project_name", "").strip()

    if not task:
        return JsonResponse({"error": "Task is required"}, status=400)
    if runtime not in ALLOWED_RUNTIMES:
        runtime = default_runtime

    # Создаем новую папку проекта если нужно
    if create_new_project:
        if new_project_name:
            project_path = _create_project_folder(new_project_name)
        else:
            # Генерируем имя из задачи
            import re
            safe_name = re.sub(r'[^\w\-_. ]', '', task[:50]).strip().replace(' ', '_')
            if not safe_name:
                safe_name = f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            project_path = _create_project_folder(safe_name)
    elif not project_path:
        try:
            from app.core.model_config import model_manager
            project_path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
        except Exception:
            pass

    profile_id = None
    workflow_id = None
    run_id = None

    if action in ["profile", "both"]:
        cfg = _generate_profile_config(task)
        profile = AgentProfile.objects.create(
            owner=request.user,
            name=cfg.get("name", "AI Profile"),
            description=cfg.get("description", ""),
            agent_type=cfg.get("agent_type", "react"),
            runtime=cfg.get("runtime", default_runtime),  # Используем default_runtime
            mode=cfg.get("mode", "simple"),
            config=cfg.get("config", {}),
        )
        profile_id = profile.id

    if action in ["workflow", "both"]:
        script = _generate_workflow_script(task, runtime)
        if not script:
            return JsonResponse({"error": "Failed to generate workflow"}, status=500)

        workflow = AgentWorkflow.objects.create(
            owner=request.user,
            name=script.get("name", "New Workflow"),
            description=script.get("description", ""),
            runtime=script.get("runtime", runtime),
            script=script,
            project_path=project_path,
        )

        workflows_dir = Path(settings.MEDIA_ROOT) / "workflows"
        workflows_dir.mkdir(parents=True, exist_ok=True)
        file_path = workflows_dir / f"workflow-{workflow.id}.json"
        script["script_file"] = str(file_path)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(script, f, ensure_ascii=False, indent=2)

        if script.get("ralph_yml"):
            ralph_path = workflows_dir / f"workflow-{workflow.id}.ralph.yml"
            script["ralph_yml_path"] = str(ralph_path)
            _write_ralph_yml(ralph_path, script["ralph_yml"])

        workflow.script = script
        workflow.save(update_fields=["script"])
        workflow_id = workflow.id

        if run_workflow:
            run = _start_workflow_run(workflow, request.user)
            run_id = run.id

    return JsonResponse(
        {"success": True, "profile_id": profile_id, "workflow_id": workflow_id, "run_id": run_id}
    )


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_mcp_servers(request):
    tool_manager = get_tool_manager()
    tool_manager.refresh_mcp_config()
    servers = list(tool_manager.get_mcp_servers().values())
    return JsonResponse({"servers": servers, "sources": tool_manager.mcp_config_sources})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_mcp_server_connect(request):
    data = _parse_json_request(request)
    name = (data.get("name") or "").strip()
    if not name:
        return JsonResponse({"error": "name is required"}, status=400)
    tool_manager = get_tool_manager()
    try:
        status = async_to_sync(tool_manager.connect_mcp_server)(name)
        return JsonResponse({"success": True, "status": status})
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_mcp_server_disconnect(request):
    data = _parse_json_request(request)
    name = (data.get("name") or "").strip()
    if not name:
        return JsonResponse({"error": "name is required"}, status=400)
    tool_manager = get_tool_manager()
    ok = async_to_sync(tool_manager.disconnect_mcp_server)(name)
    return JsonResponse({"success": bool(ok)})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_mcp_server_tools(request):
    name = (request.GET.get("name") or "").strip()
    if not name:
        return JsonResponse({"error": "name is required"}, status=400)
    tool_manager = get_tool_manager()
    tools = tool_manager.get_mcp_tools(name)
    return JsonResponse({"tools": tools})


# Кэш для списка моделей (TTL 5 минут)
_models_cache = {"data": None, "timestamp": 0}
_MODELS_CACHE_TTL = 300  # 5 минут


def _get_cursor_models_from_cli() -> list:
    """Получить список моделей из agent --list-models."""
    import time
    now = time.time()
    
    # Проверяем кэш
    if _models_cache["data"] and (now - _models_cache["timestamp"]) < _MODELS_CACHE_TTL:
        return _models_cache["data"]
    
    try:
        cmd_path = _resolve_cli_command("cursor")
        env = dict(os.environ)
        env.update(getattr(settings, "CURSOR_CLI_EXTRA_ENV", None) or {})
        
        proc = subprocess.run(
            [cmd_path, "--list-models"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=30,
        )
        
        if proc.returncode == 0 and proc.stdout:
            # Парсим вывод CLI - ожидаем формат: model_id\nmodel_id2\n...
            lines = [line.strip() for line in proc.stdout.strip().split("\n") if line.strip()]
            models = []
            for line in lines:
                # Пропускаем заголовки и пустые строки
                if not line or line.startswith("#") or line.startswith("Available"):
                    continue
                model_id = line.split()[0] if line.split() else line
                if model_id:
                    models.append({
                        "id": model_id,
                        "name": model_id.replace("-", " ").title(),
                        "description": f"Модель {model_id}",
                        "from_cli": True,
                    })
            
            if models:
                _models_cache["data"] = models
                _models_cache["timestamp"] = now
                return models
    except subprocess.TimeoutExpired:
        logger.warning("Cursor --list-models timeout")
    except Exception as e:
        logger.warning(f"Error getting models from CLI: {e}")
    
    # Fallback на статический список
    return list(getattr(settings, "CURSOR_AVAILABLE_MODELS", []))


@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_list_models(request):
    """
    Получить список доступных моделей Cursor CLI.
    Кэшируется на 5 минут, fallback на статический список.
    """
    models = _get_cursor_models_from_cli()
    
    # Добавляем рекомендации если есть
    recommendations = getattr(settings, "MODEL_RECOMMENDATIONS", {})
    
    return JsonResponse({
        "models": models,
        "recommendations": recommendations,
        "default": "auto",
    })


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_smart_analyze(request):
    """
    Умный анализ задачи с рекомендацией модели и декомпозицией.
    
    Request:
    {
        "task": "Описание задачи",
        "context": {  // опционально
            "project_type": "django",
            "existing_files": ["models.py", "views.py"]
        },
        "use_llm": true  // использовать LLM для глубокого анализа (по умолчанию true)
    }
    
    Response:
    {
        "questions": ["Наводящий вопрос 1", ...],
        "recommended_model": "sonnet-4",
        "complexity": "standard",
        "task_type": "new_feature",
        "subtasks": [
            {
                "title": "Название подзадачи",
                "prompt": "Детальное описание",
                "recommended_model": "sonnet-4",
                "reasoning": "Почему эта модель",
                "complexity": "standard",
                "completion_promise": "STEP_DONE",
                "max_iterations": 5,
                "verify_prompt": "...",
                "verify_promise": "PASS"
            }
        ],
        "estimated_steps": 4,
        "warnings": [],
        "reasoning": "Общее обоснование"
    }
    """
    from .smart_analyzer import get_smart_analyzer
    
    data = _parse_json_request(request)
    task = data.get("task", "").strip()
    
    if not task:
        return JsonResponse({"error": "Task is required"}, status=400)
    
    context = data.get("context")
    use_llm = data.get("use_llm", True)
    
    try:
        analyzer = get_smart_analyzer()
        result = analyzer.analyze(task, context=context, use_llm=use_llm)
        return JsonResponse(result.to_dict())
    except Exception as e:
        logger.error(f"Smart analyze failed: {e}")
        return JsonResponse({
            "error": str(e),
            "questions": [],
            "recommended_model": "auto",
            "complexity": "standard",
            "subtasks": [],
            "warnings": [f"Анализ не удался: {str(e)[:100]}"],
        }, status=500)


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_tasks_generate(request):
    """AI генерация задач по описанию проекта"""
    data = _parse_json_request(request)
    description = data.get("description", "").strip()
    
    if not description:
        return JsonResponse({"error": "Description is required"}, status=400)
    
    llm = LLMProvider()
    from app.core.model_config import model_manager
    model_preference = model_manager.config.default_provider
    
    prompt = f"""You generate task lists for AI agents.
Return ONLY JSON array of tasks:
[
  {{
    "title": "Short task title",
    "prompt": "Detailed description of what the agent should do",
    "completion_promise": "STEP_DONE",
    "verify_prompt": "How to verify the task is complete (optional, can be null)",
    "verify_promise": "PASS",
    "max_iterations": 5
  }}
]

Rules:
- Each task should be specific and actionable
- Tasks should be in logical order
- Include verify_prompt for tasks that need testing
- Keep prompts clear and detailed
- Return 3-8 tasks typically
- If requirements are unclear, include an early task "Clarify requirements" with questions to ask.

Project description:
{description}
"""
    
    async def _consume():
        chunks = []
        async for chunk in llm.stream_chat(prompt, model=model_preference):
            chunks.append(chunk)
        return "".join(chunks)
    
    response_text = async_to_sync(_consume)()
    
    # Parse JSON from response
    import re
    try:
        tasks = json.loads(response_text)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", response_text, re.DOTALL)
        if match:
            try:
                tasks = json.loads(match.group())
            except json.JSONDecodeError:
                return JsonResponse({"error": "Failed to parse AI response"}, status=500)
        else:
            return JsonResponse({"error": "Failed to parse AI response"}, status=500)
    
    if not isinstance(tasks, list):
        return JsonResponse({"error": "Invalid AI response format"}, status=500)
    
    return JsonResponse({"success": True, "tasks": tasks})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_create_manual(request):
    """Ручное создание workflow из списка задач"""
    data = _parse_json_request(request)
    name = data.get("name", "").strip() or "New Workflow"
    
    # Используем default_provider из настроек
    from app.core.model_config import model_manager
    default_runtime = model_manager.config.default_provider or "cursor"
    runtime = data.get("runtime", default_runtime)
    
    steps = data.get("steps", [])
    run_after_save = data.get("run_after_save", False)
    target_server_id = data.get("target_server_id")
    workflow_model = data.get("model", "auto")  # Модель workflow-level
    
    # Обработка проекта
    project_path = data.get("project_path", "").strip()
    create_new_project = data.get("create_new_project", False)
    new_project_name = data.get("new_project_name", "").strip()
    
    if not steps:
        return JsonResponse({"error": "At least one step is required"}, status=400)
    
    if runtime not in ALLOWED_RUNTIMES:
        runtime = default_runtime
    
    # Валидация модели
    valid_models = [m["id"] for m in getattr(settings, "CURSOR_AVAILABLE_MODELS", [])]
    if workflow_model and workflow_model not in valid_models:
        workflow_model = "auto"
    
    # Создаем папку проекта если нужно
    if create_new_project:
        if new_project_name:
            project_path = _create_project_folder(new_project_name)
        else:
            import re
            safe_name = re.sub(r'[^\w\-_. ]', '', name[:50]).strip().replace(' ', '_')
            if not safe_name:
                safe_name = f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            project_path = _create_project_folder(safe_name)
    elif not project_path:
        try:
            from app.core.model_config import model_manager
            project_path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
        except Exception:
            pass
    
    # Формируем script
    script = {
        "name": name,
        "runtime": runtime,
        "model": workflow_model,  # Модель workflow-level
        "steps": []
    }
    
    for step in steps:
        step_data = {
            "title": step.get("title", ""),
            "prompt": step.get("prompt", ""),
            "completion_promise": step.get("completion_promise", "STEP_DONE"),
            "max_iterations": step.get("max_iterations", 5),
        }
        # Step-level модель (если разрешено в настройках и передана)
        if step.get("model") and step["model"] != "auto":
            step_model = step["model"]
            if step_model in valid_models:
                step_data["model"] = step_model
        if step.get("verify_prompt"):
            step_data["verify_prompt"] = step["verify_prompt"]
            step_data["verify_promise"] = step.get("verify_promise", "PASS")
        script["steps"].append(step_data)
    
    # Генерируем ralph_yml если runtime == ralph
    if runtime == "ralph":
        completion = "LOOP_COMPLETE"
        max_iter = 50
        backend = "cursor"
        hats = {}
        previous_event = "task.start"
        
        for idx, step in enumerate(script["steps"], start=1):
            hat_name = f"step_{idx}"
            next_event = f"step_{idx}.done"
            hats[hat_name] = {
                "name": f"Step {idx}",
                "description": step.get("title", f"Step {idx}"),
                "triggers": [previous_event],
                "publishes": [next_event],
                "instructions": step.get("prompt", ""),
            }
            previous_event = next_event
        
        script["ralph_yml"] = {
            "cli": {"backend": backend},
            "event_loop": {
                "completion_promise": completion,
                "max_iterations": max_iter,
                "starting_event": "task.start",
            },
            "hats": hats,
        }
    
    # Проверяем и получаем целевой сервер
    target_server = None
    if target_server_id:
        from servers.models import Server
        target_server = Server.objects.filter(id=target_server_id, user=request.user).first()
    
    # Создаем workflow
    workflow = AgentWorkflow.objects.create(
        owner=request.user,
        name=name,
        description=f"Created manually with {len(steps)} steps",
        runtime=runtime,
        script=script,
        project_path=project_path,
        target_server=target_server,
    )
    
    # Сохраняем файлы
    workflows_dir = Path(settings.MEDIA_ROOT) / "workflows"
    workflows_dir.mkdir(parents=True, exist_ok=True)
    file_path = workflows_dir / f"workflow-{workflow.id}.json"
    script["script_file"] = str(file_path)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(script, f, ensure_ascii=False, indent=2)
    
    if script.get("ralph_yml"):
        ralph_path = workflows_dir / f"workflow-{workflow.id}.ralph.yml"
        script["ralph_yml_path"] = str(ralph_path)
        _write_ralph_yml(ralph_path, script["ralph_yml"])
    
    workflow.script = script
    workflow.save(update_fields=["script"])
    
    run_id = None
    if run_after_save:
        run = _start_workflow_run(workflow, request.user)
        run_id = run.id
    
    return JsonResponse({
        "success": True,
        "workflow_id": workflow.id,
        "run_id": run_id,
        "project_path": project_path,
    })


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_import(request):
    """Импорт workflow из JSON файла"""
    if "file" not in request.FILES:
        return JsonResponse({"success": False, "error": "No file uploaded"}, status=400)
    uploaded_file = request.FILES["file"]
    if not uploaded_file.name.endswith(".json"):
        return JsonResponse({"success": False, "error": "Only JSON files are supported"}, status=400)
    try:
        content = uploaded_file.read().decode("utf-8")
        script = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        return JsonResponse({"success": False, "error": f"Invalid JSON: {str(e)}"}, status=400)
    project_path = request.POST.get("project_path", "").strip()
    if project_path == "__new__":
        new_project_name = request.POST.get("new_project_name", "").strip()
        if new_project_name:
            project_path = _create_project_folder(new_project_name)
        else:
            import re
            safe_name = re.sub(r"[^\w\-_. ]", "", (script.get("name", "imported_workflow") or "")[:50]).strip().replace(" ", "_") or f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            project_path = _create_project_folder(safe_name)
    name = (script.get("name") or uploaded_file.name.replace(".json", "")).strip() or "Imported Workflow"
    description = script.get("description", "") or f"Imported from {uploaded_file.name}"
    
    # Используем default_provider из настроек
    from app.core.model_config import model_manager
    default_runtime = model_manager.config.default_provider or "cursor"
    
    runtime = script.get("runtime", default_runtime)
    if runtime not in ALLOWED_RUNTIMES:
        runtime = default_runtime
    script["runtime"] = runtime
    script["name"] = name
    # Если runtime ralph, но ralph_yml нет — генерируем из steps (чтобы не было «Ralph script отсутствует»)
    if runtime == "ralph" and not script.get("ralph_yml"):
        backend = script.get("backend") or default_runtime
        steps_list = script.get("steps", [])
        hats = {}
        prev_event = "task.start"
        for idx, step in enumerate(steps_list, start=1):
            nxt_event = f"step_{idx}.done"
            hats[f"step_{idx}"] = {
                "name": step.get("title", f"Step {idx}"),
                "description": step.get("title", f"Step {idx}"),
                "triggers": [prev_event],
                "publishes": [nxt_event],
                "instructions": step.get("prompt", ""),
            }
            prev_event = nxt_event
        script["ralph_yml"] = {
            "cli": {"backend": backend},
            "event_loop": {
                "completion_promise": "LOOP_COMPLETE",
                "max_iterations": 50,
                "starting_event": "task.start",
            },
            "hats": hats,
        }
    workflow = AgentWorkflow.objects.create(
        owner=request.user,
        name=name,
        description=description,
        runtime=runtime,
        script=script,
        project_path=project_path or None,
    )
    steps = script.get("steps", [])
    return JsonResponse({"success": True, "workflow_id": workflow.id, "name": name, "steps_count": len(steps), "project_path": project_path})


@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_workflow_get(request, workflow_id: int):
    """Получить детали workflow для редактирования"""
    workflow = get_object_or_404(AgentWorkflow.objects.select_related("target_server"), id=workflow_id, owner=request.user)
    script = workflow.script or {}
    steps = script.get("steps", [])
    return JsonResponse({
        "success": True,
        "workflow": {
            "id": workflow.id,
            "name": workflow.name or "",
            "description": getattr(workflow, "description", "") or "",
            "runtime": workflow.runtime or "ralph",
            "project_path": workflow.project_path or "",
            "target_server_id": workflow.target_server_id,
            "target_server_name": workflow.target_server.name if workflow.target_server else None,
            "steps": steps,
            "created_at": workflow.created_at.isoformat() if hasattr(workflow, "created_at") else "",
        },
    })


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_update(request, workflow_id: int):
    """Обновление workflow (шаги, название, проект)"""
    workflow = get_object_or_404(AgentWorkflow, id=workflow_id, owner=request.user)
    data = _parse_json_request(request)
    if "name" in data:
        workflow.name = (data["name"] or "").strip() or workflow.name
    if "description" in data:
        workflow.description = data.get("description", "")
    if "runtime" in data and data["runtime"] in ALLOWED_RUNTIMES:
        workflow.runtime = data["runtime"]
    if "project_path" in data:
        pp = data["project_path"]
        if pp == "__new__":
            new_name = (data.get("new_project_name") or "").strip()
            workflow.project_path = _create_project_folder(new_name or (workflow.name or "workflow")[:50].replace(" ", "_") or f"p_{datetime.now().strftime('%Y%m%d')}")
        else:
            workflow.project_path = pp or None
    if "target_server_id" in data:
        from servers.models import Server
        ts_id = data.get("target_server_id")
        if ts_id:
            workflow.target_server = Server.objects.filter(id=ts_id, user=request.user).first()
        else:
            workflow.target_server = None
    # Обновление модели workflow-level
    if "model" in data:
        script = workflow.script or {}
        workflow_model = data.get("model", "auto")
        valid_models = [m["id"] for m in getattr(settings, "CURSOR_AVAILABLE_MODELS", [])]
        if workflow_model and workflow_model in valid_models:
            script["model"] = workflow_model
        workflow.script = script
    
    if "steps" in data:
        script = workflow.script or {}
        # Валидируем модели шагов (если разрешено в настройках)
        valid_models = [m["id"] for m in getattr(settings, "CURSOR_AVAILABLE_MODELS", [])]
        validated_steps = []
        for step in data["steps"]:
            step_data = dict(step)
            # Проверяем step-level модель
            if step_data.get("model"):
                if step_data["model"] not in valid_models or step_data["model"] == "auto":
                    step_data.pop("model", None)
            validated_steps.append(step_data)
        
        script["steps"] = validated_steps
        script["name"] = workflow.name
        script["runtime"] = workflow.runtime
        if workflow.runtime == "ralph":
            completion, max_iter, backend = "LOOP_COMPLETE", 50, "cursor"
            hats = {}
            prev = "task.start"
            for idx, step in enumerate(validated_steps, start=1):
                nxt = f"step_{idx}.done"
                hats[f"step_{idx}"] = {
                    "name": f"Step {idx}",
                    "description": step.get("title", f"Step {idx}"),
                    "triggers": [prev],
                    "publishes": [nxt],
                    "instructions": step.get("prompt", ""),
                }
                prev = nxt
            script["ralph_yml"] = {"cli": {"backend": backend}, "event_loop": {"completion_promise": completion, "max_iterations": max_iter, "starting_event": "task.start"}, "hats": hats}
        workflow.script = script
    workflow.save()
    return JsonResponse({"success": True, "workflow_id": workflow.id})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_workflow_download_project(request, workflow_id: int):
    """
    Скачать проект воркфлоу как ZIP архив.
    Архивирует папку project_path и отдаёт как attachment.
    """
    import zipfile
    import tempfile
    from django.http import FileResponse, HttpResponse
    
    workflow = get_object_or_404(AgentWorkflow, id=workflow_id, owner=request.user)
    
    project_path = workflow.get_full_project_path()
    if not project_path or not project_path.exists():
        return JsonResponse({
            "error": "Папка проекта не найдена. Возможно, воркфлоу ещё не выполнялся."
        }, status=404)
    
    # Проверяем что это директория
    if not project_path.is_dir():
        return JsonResponse({"error": "project_path не является директорией"}, status=400)
    
    # Имя архива
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in workflow.name)[:50] or "project"
    zip_filename = f"{safe_name}.zip"
    
    # Создаём zip в памяти
    try:
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        with zipfile.ZipFile(temp_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(project_path):
                # Пропускаем .git, __pycache__, node_modules и т.п.
                dirs[:] = [d for d in dirs if d not in ('.git', '__pycache__', 'node_modules', '.venv', 'venv', '.cursor')]
                for file in files:
                    file_path = Path(root) / file
                    # Пропускаем большие файлы (>50MB) и бинарники
                    try:
                        if file_path.stat().st_size > 50 * 1024 * 1024:
                            continue
                    except OSError:
                        continue
                    # Относительный путь для архива
                    arcname = file_path.relative_to(project_path)
                    try:
                        zf.write(file_path, arcname)
                    except Exception as e:
                        logger.warning(f"Skip file {file_path}: {e}")
        
        temp_file.close()
        
        # Отправляем файл
        response = FileResponse(
            open(temp_file.name, 'rb'),
            as_attachment=True,
            filename=zip_filename,
            content_type='application/zip'
        )
        # Удаляем temp файл после отправки (через callback)
        response._temp_file_path = temp_file.name
        return response
        
    except Exception as e:
        logger.error(f"Error creating zip for workflow {workflow_id}: {e}")
        return JsonResponse({"error": f"Ошибка создания архива: {str(e)}"}, status=500)


# ============================================
# Custom Agents Views
# ============================================

@login_required
@require_feature('agents')
def custom_agents_view(request):
    """Страница кастомных агентов"""
    template = get_template_name(request, 'agent_hub/custom_agents.html')
    return render(request, template, {})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET", "POST"])
def api_custom_agents_list(request):
    """
    GET: список кастомных агентов пользователя
    POST: создание нового кастомного агента
    """
    if request.method == 'GET':
        try:
            agents = CustomAgent.objects.filter(owner=request.user, is_active=True).order_by('-updated_at')
            
            agents_data = []
            for agent in agents:
                agents_data.append({
                    'id': agent.id,
                    'name': agent.name,
                    'description': agent.description,
                    'runtime': agent.runtime,
                    'model': agent.model,
                    'orchestrator_mode': agent.orchestrator_mode,
                    'allowed_tools': agent.allowed_tools,
                    'usage_count': agent.usage_count,
                    'is_public': agent.is_public,
                    'created_at': agent.created_at.isoformat(),
                    'updated_at': agent.updated_at.isoformat(),
                })
            
            return JsonResponse({'success': True, 'agents': agents_data})
        
        except Exception as e:
            logger.error(f"Error listing custom agents: {e}")
            return JsonResponse({'success': False, 'error': str(e)}, status=500)
    
    elif request.method == 'POST':
        try:
            data = _parse_json_request(request)
            
            # Создание агента
            agent = CustomAgent.objects.create(
                owner=request.user,
                name=data.get('name', 'New Agent'),
                description=data.get('description', ''),
                system_prompt=data.get('system_prompt', ''),
                instructions=data.get('instructions', ''),
                allowed_tools=data.get('allowed_tools', []),
                max_iterations=data.get('max_iterations', 5),
                temperature=data.get('temperature', 0.7),
                completion_promise=data.get('completion_promise', 'COMPLETE'),
                runtime=data.get('runtime', 'claude'),
                model=data.get('model', 'claude-4.5-sonnet'),
                orchestrator_mode=data.get('orchestrator_mode', 'ralph_internal'),
                mcp_servers=data.get('mcp_servers', {}),
                mcp_auto_approve=data.get('mcp_auto_approve', False),
            )
            
            logger.info(f"Created custom agent: {agent.name} (id={agent.id})")
            
            return JsonResponse({
                'success': True,
                'message': 'Агент создан успешно',
                'agent_id': agent.id
            })
        
        except Exception as e:
            logger.error(f"Error creating custom agent: {e}")
            return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET", "PUT", "DELETE"])
def api_custom_agent_detail(request, agent_id: int):
    """
    GET: получить агента
    PUT: обновить агента
    DELETE: удалить агента
    """
    try:
        agent = CustomAgent.objects.get(id=agent_id, owner=request.user)
    except CustomAgent.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Agent not found'}, status=404)
    
    if request.method == 'GET':
        return JsonResponse({
            'success': True,
            'agent': {
                'id': agent.id,
                'name': agent.name,
                'description': agent.description,
                'system_prompt': agent.system_prompt,
                'instructions': agent.instructions,
                'allowed_tools': agent.allowed_tools,
                'max_iterations': agent.max_iterations,
                'temperature': agent.temperature,
                'completion_promise': agent.completion_promise,
                'runtime': agent.runtime,
                'model': agent.model,
                'orchestrator_mode': agent.orchestrator_mode,
                'mcp_servers': agent.mcp_servers,
                'mcp_auto_approve': agent.mcp_auto_approve,
                'usage_count': agent.usage_count,
                'is_public': agent.is_public,
                'created_at': agent.created_at.isoformat(),
                'updated_at': agent.updated_at.isoformat(),
            }
        })
    
    elif request.method == 'PUT':
        try:
            data = _parse_json_request(request)
            
            # Обновление полей
            if 'name' in data:
                agent.name = data['name']
            if 'description' in data:
                agent.description = data['description']
            if 'system_prompt' in data:
                agent.system_prompt = data['system_prompt']
            if 'instructions' in data:
                agent.instructions = data['instructions']
            if 'allowed_tools' in data:
                agent.allowed_tools = data['allowed_tools']
            if 'max_iterations' in data:
                agent.max_iterations = data['max_iterations']
            if 'temperature' in data:
                agent.temperature = data['temperature']
            if 'completion_promise' in data:
                agent.completion_promise = data['completion_promise']
            if 'runtime' in data:
                agent.runtime = data['runtime']
            if 'model' in data:
                agent.model = data['model']
            if 'orchestrator_mode' in data:
                agent.orchestrator_mode = data['orchestrator_mode']
            if 'mcp_servers' in data:
                agent.mcp_servers = data['mcp_servers']
            if 'mcp_auto_approve' in data:
                agent.mcp_auto_approve = data['mcp_auto_approve']
            
            agent.save()
            
            logger.info(f"Updated custom agent: {agent.name} (id={agent.id})")
            
            return JsonResponse({'success': True, 'message': 'Агент обновлён'})
        
        except Exception as e:
            logger.error(f"Error updating custom agent: {e}")
            return JsonResponse({'success': False, 'error': str(e)}, status=500)
    
    elif request.method == 'DELETE':
        try:
            agent.is_active = False
            agent.save()
            
            logger.info(f"Deleted custom agent: {agent.name} (id={agent.id})")
            
            return JsonResponse({'success': True, 'message': 'Агент удалён'})
        
        except Exception as e:
            logger.error(f"Error deleting custom agent: {e}")
            return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["GET"])
def api_custom_agent_export(request, agent_id: int):
    """Экспорт агента в JSON формат (для Claude Code CLI)"""
    try:
        agent = CustomAgent.objects.get(id=agent_id, owner=request.user)
        
        config = agent.to_cli_agent_config()
        
        return JsonResponse({
            'success': True,
            'config': config,
            'format': 'claude_code_agent',
            'filename': f"{agent.name.replace(' ', '_')}.agent.json"
        })
    
    except CustomAgent.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Agent not found'}, status=404)
    except Exception as e:
        logger.error(f"Error exporting custom agent: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)
