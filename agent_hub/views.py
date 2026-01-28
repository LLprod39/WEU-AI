"""
Views for Agent Hub: profiles, runs, and AI config assistant.
"""
import json
import threading
from pathlib import Path
import subprocess
import os
import shutil
from datetime import datetime
from typing import Dict, Any
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.utils import timezone
from django.conf import settings
from asgiref.sync import async_to_sync
from loguru import logger

from .models import AgentProfile, AgentRun, AgentPreset, AgentWorkflow, AgentWorkflowRun
from app.agents.manager import get_agent_manager
from core_ui.decorators import require_feature
from app.core.llm import LLMProvider
from app.agents.cli_runtime import CliRuntimeManager

ALLOWED_RUNTIMES = {"ralph", "cursor"}
ALLOWED_RALPH_BACKENDS = {"cursor"}


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


def _get_workspace_path(workflow: AgentWorkflow) -> str:
    """Возвращает путь к workspace для workflow"""
    path = (workflow.project_path or "").strip()
    if not path:
        try:
            from app.core.model_config import model_manager
            path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
        except Exception:
            path = ""
    if path:
        full_path = settings.AGENT_PROJECTS_DIR / path
        full_path.mkdir(parents=True, exist_ok=True)
        return str(full_path)
    return str(settings.BASE_DIR)


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
  "config": {{
    "model": "gpt-5|sonnet-4|sonnet-4-thinking",
    "specific_model": null,
    "use_rag": true,
    "max_iterations": 10,
    "completion_promise": "DONE",
    "ralph_backend": "cursor",
    "initial_prompt": ""
  }}
}}

Task description:
{task}

Rules:
- Use ralph for multi-step tasks, cursor for direct execution.
- If using ralph runtime, set ralph_backend to "cursor".
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
            "config": {"model": "gpt-5", "use_rag": True, "ralph_backend": "cursor"},
        }
    parsed["runtime"] = parsed.get("runtime") if parsed.get("runtime") in ALLOWED_RUNTIMES else "ralph"
    cfg = parsed.get("config", {})
    if parsed["runtime"] == "ralph":
        cfg["ralph_backend"] = "cursor"
    # Для cursor модель всегда auto (уже в args), убираем из config
    if parsed["runtime"] == "cursor":
        cfg.pop("model", None)
        cfg.pop("specific_model", None)
    parsed["config"] = cfg
    return parsed


def _generate_workflow_script(task: str, runtime: str, from_task: bool = False, user_id: int = None) -> Dict[str, Any]:
    llm = LLMProvider()
    from app.core.model_config import model_manager

    model_preference = model_manager.config.default_provider
    ralph_block = ""
    if from_task:
        ralph_block = """
RALPH WORKFLOW (важно):
- Ralph — оркестратор по шагам: каждый шаг = "шляпа" (hat) с triggers (событие предыдущего шага) и publishes (событие по завершении).
- completion_promise (например STEP_DONE) — что должен вывести агент, чтобы шаг считался выполненным.
- Обязательно заполняй verify_prompt и verify_promise для шагов, где нужны проверки и тесты: verify_prompt = инструкция агенту (запусти тесты, проверь результат), verify_promise = PASS; агент должен вывести <promise>PASS</promise> в выводе, когда проверка пройдена.
- Шаги должны идти по порядку: подготовка → реализация → тесты/проверка. Для шагов с кодом/скриптами добавляй verify_prompt типа «Запусти тесты (pytest/unit/интеграцию по контексту). Убедись что всё зелёное. Выведи <promise>PASS</promise> если тесты прошли.»
"""
    # Контекст серверов пользователя для SSH-задач
    servers_hint = ""
    if user_id:
        servers_ctx = _get_user_servers_context(user_id)
        if servers_ctx:
            servers_hint = f"""
SERVERS (SSH):
Если задача связана с сервером — данные серверов пользователя будут автоматически добавлены в промпт при выполнении.
Доступные серверы: {', '.join([s.strip().split(':')[0].replace('- ', '') for s in servers_ctx.split('\\n') if s.strip().startswith('- ')])}
Для SSH-команд на сервере используй sshpass (будет подставлена готовая команда).
"""
    prompt = f"""You generate workflow scripts for CLI agents.
Return ONLY JSON:
{{
  "name": "Workflow name",
  "description": "Short description",
  "runtime": "{runtime}",
  "prompt": "High-level goal summary",
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

Rules:
- Keep steps short and actionable.
- Each step must include completion_promise.
- If tests are needed, include verify_prompt and verify_promise (агент выводит <promise>PASS</promise> когда тесты/проверка прошли).
{ralph_block}{servers_hint}
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

    if runtime == "ralph":
        completion = parsed.get("completion_promise", "LOOP_COMPLETE")
        max_iter = parsed.get("max_iterations", 50)
        backend = "cursor"

        hats = {}
        previous_event = "task.start"
        for idx, step in enumerate(parsed.get("steps", []), start=1):
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

        parsed["ralph_yml"] = {
            "cli": {"backend": backend},
            "event_loop": {
                "completion_promise": completion,
                "max_iterations": max_iter,
                "starting_event": "task.start",
            },
            "hats": hats,
        }

    return parsed


@login_required
@require_feature('agents', redirect_on_forbidden=True)
def agents_page(request):
    profiles = AgentProfile.objects.filter(owner=request.user, is_active=True)
    presets = AgentPreset.objects.all()
    recent_runs = AgentRun.objects.filter(initiated_by=request.user)[:10]
    workflows = AgentWorkflow.objects.filter(owner=request.user)[:10]
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
        }
        for workflow in workflows
    ]
    projects_data = _get_project_folders(include_files_count=False)
    return render(
        request,
        "agent_hub/agents.html",
        {
            "profiles": profiles,
            "presets": presets,
            "recent_runs": recent_runs,
            "workflows": workflows,
            "workflow_runs": workflow_runs_data,
            "presets_data": presets_data,
            "workflows_data": workflows_data,
            "projects_data": projects_data,
        },
    )


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
        return JsonResponse({"error": "Runtime запрещен. Доступны: ralph, cursor"}, status=400)

    # Для cursor модель всегда auto (уже в args), убираем из config
    if runtime == "cursor":
        config = {k: v for k, v in config.items() if k not in ["model", "specific_model"]}

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
    if "runtime" in data and data.get("runtime") not in ALLOWED_RUNTIMES:
        return JsonResponse({"error": "Runtime запрещен. Доступны: ralph, cursor"}, status=400)
    profile.runtime = data.get("runtime", profile.runtime)
    profile.mode = data.get("mode", profile.mode)
    config = data.get("config", profile.config or {})
    # Для cursor модель всегда auto (уже в args), убираем из config
    if profile.runtime == "cursor":
        config = {k: v for k, v in config.items() if k not in ["model", "specific_model"]}
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

    agent_type = data.get("agent_type") or (profile.agent_type if profile else "react")
    runtime = data.get("runtime") or (profile.runtime if profile else "ralph")
    config = data.get("config") or (profile.config if profile else {})
    if runtime not in ALLOWED_RUNTIMES:
        return JsonResponse({"error": "Runtime запрещен. Доступны: ralph, cursor"}, status=400)
    # Для cursor модель всегда auto (уже в args), убираем из config
    if runtime == "cursor":
        config = {k: v for k, v in config.items() if k not in ["model", "specific_model"]}
    if agent_type == "ralph" and runtime not in ["internal", "ralph"]:
        config = {**config, "use_ralph_loop": True}
        if not config.get("completion_promise"):
            config["completion_promise"] = "COMPLETE"

    run = AgentRun.objects.create(
        profile=profile,
        initiated_by=request.user,
        runtime=runtime,
        status="queued",
        input_task=task,
        started_at=None,
    )

    def _execute_run(run_id: int, agent_type: str, runtime: str, task: str, config: Dict[str, Any]):
        run_obj = AgentRun.objects.get(id=run_id)
        run_obj.status = "running"
        run_obj.started_at = timezone.now()
        run_obj.save(update_fields=["status", "started_at"])

        try:
            if runtime == "internal":
                agent_manager = get_agent_manager()
                agent_name = _agent_name_from_type(agent_type)
                result = async_to_sync(agent_manager.execute_agent)(agent_name, task, config)
                run_obj.output_text = result.get("result") or ""
                run_obj.logs = json.dumps(result.get("metadata") or {}, ensure_ascii=False)
                run_obj.status = "succeeded" if result.get("success") else "failed"
            else:
                cli_manager = CliRuntimeManager()
                result = async_to_sync(cli_manager.run)(runtime, task, config)
                run_obj.output_text = result.get("output", "")
                run_obj.logs = result.get("logs", "")
                run_obj.status = "succeeded" if result.get("success") else "failed"
                run_obj.meta = result.get("meta", {})
        except Exception as exc:
            logger.error(f"Agent run failed: {exc}")
            run_obj.status = "failed"
            run_obj.logs = str(exc)
        finally:
            run_obj.finished_at = timezone.now()
            run_obj.save()

    thread = threading.Thread(
        target=_execute_run,
        args=(run.id, agent_type, runtime, task, config),
        daemon=True,
    )
    thread.start()

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
def api_run_status(request, run_id: int):
    run = get_object_or_404(AgentRun, id=run_id, initiated_by=request.user)
    return JsonResponse(
        {
            "status": run.status,
            "runtime": run.runtime,
            "logs": (run.logs or "")[-5000:],
            "output": (run.output_text or "")[-2000:],
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
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
        except Exception:
            pass

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
            except Exception:
                pass
    workflow.delete()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_workflow_generate(request):
    data = _parse_json_request(request)
    task = data.get("task", "").strip()
    runtime = data.get("runtime", "ralph")
    project_path = data.get("project_path", "").strip()
    create_new_project = data.get("create_new_project", False)
    new_project_name = data.get("new_project_name", "").strip()
    
    if not task:
        return JsonResponse({"error": "Task is required"}, status=400)
    if runtime not in ALLOWED_RUNTIMES:
        return JsonResponse({"error": "Runtime запрещен. Доступны: ralph, cursor"}, status=400)

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
        try:
            from tasks.views import _user_can_edit_task
            if not _user_can_edit_task(request.user, task):
                return JsonResponse({"error": "No access to this task"}, status=403)
        except Exception:
            return JsonResponse({"error": "No access to this task"}, status=403)
    task_text = f"{task.title}\n\n{task.description or ''}".strip()
    if not task_text:
        return JsonResponse({"error": "Task has no title/description"}, status=400)
    project_path = ""
    try:
        from app.core.model_config import model_manager
        project_path = (getattr(model_manager.config, "default_agent_output_path", None) or "").strip()
    except Exception:
        pass
    parsed = _generate_workflow_script(task_text, "ralph", from_task=True, user_id=request.user.id)
    if not parsed:
        return JsonResponse({"error": "Failed to generate workflow"}, status=500)
    workflow = AgentWorkflow.objects.create(
        owner=request.user,
        name=parsed.get("name", (task.title or "Workflow")[:80]),
        description=parsed.get("description", "") or (task.description or "")[:200],
        runtime="ralph",
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
    run = _start_workflow_run(workflow, request.user)
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
    if workflow.runtime not in ALLOWED_RUNTIMES:
        return JsonResponse({"error": "Runtime запрещен. Доступны: ralph, cursor"}, status=400)
    run = _start_workflow_run(workflow, request.user)
    return JsonResponse({"success": True, "run_id": run.id})


def _build_cli_command(runtime: str, prompt: str, config: Dict[str, Any], workspace: str = None) -> list:
    runtime_cfg = settings.CLI_RUNTIME_CONFIG.get(runtime)
    if not runtime_cfg:
        raise ValueError(f"Runtime '{runtime}' is not configured")
    cmd = [_resolve_cli_command(runtime)]
    cmd += [_format_arg(runtime_cfg, arg, workspace) for arg in runtime_cfg.get("args", [])]
    allowed_args = runtime_cfg.get("allowed_args", [])
    cli_args = []
    for arg_name in allowed_args:
        value = config.get(arg_name)
        if value is None:
            underscore_key = arg_name.replace("-", "_")
            value = config.get(underscore_key)
        if value not in (None, "", []):
            if isinstance(value, bool):
                if value:
                    cli_args.append(f"--{arg_name}")
            else:
                cli_args.extend([f"--{arg_name}", str(value)])
    prompt_style = runtime_cfg.get("prompt_style", "flag")
    if prompt_style == "positional":
        return cmd + cli_args + [prompt]
    return cmd + cli_args + [prompt]


# Сколько строк лога накапливать перед записью в БД (снижает "database is locked" при SQLite)
_LOG_SAVE_BATCH_SIZE = 10


def _get_cursor_cli_extra_env() -> dict:
    """Переменные окружения для Cursor CLI (напр. HTTP/1.0)."""
    env = getattr(settings, "CURSOR_CLI_EXTRA_ENV", None)
    return env if isinstance(env, dict) and env else {}


def _short_path(path: str, max_len: int = 50) -> str:
    if len(path) <= max_len:
        return path
    parts = path.replace("\\", "/").split("/")
    if len(parts) > 3:
        return f"{parts[0]}/.../{'/'.join(parts[-2:])}"
    return f"...{path[-(max_len - 3):]}"


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
    msg_type = data.get("type")
    subtype = data.get("subtype")
    if msg_type == "system" and subtype == "init":
        return f"🤖 Модель: {data.get('model', 'unknown')}"
    if msg_type == "assistant":
        content = data.get("message", {}).get("content", [])
        if content and isinstance(content, list) and content[0].get("text"):
            text = content[0].get("text", "")
            return f"💬 {text[:100]}..." if len(text) > 100 else f"💬 {text}"
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
    run_obj: AgentWorkflowRun,
    step_label: str,
    process_env: dict = None,
    extra_env: dict = None,
) -> Dict[str, Any]:
    """Запуск CLI с парсингом stream-json для детального логирования."""
    spawn_env = extra_env or process_env
    if spawn_env and os.environ:
        spawn_env = {**os.environ, **spawn_env}
    run_obj.logs = (run_obj.logs or "") + f"\n{'='*50}\n[CMD] {' '.join(cmd)}\n{'='*50}\n"
    run_obj.save(update_fields=["logs"])
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
    process = subprocess.Popen(cmd, **popen_kw)
    run_obj.meta = {**(run_obj.meta or {}), f"pid_{step_label}": process.pid}
    run_obj.save(update_fields=["meta"])
    output_chunks = []
    accumulated_text = ""
    tool_count = 0
    pending_lines = 0

    def maybe_flush():
        nonlocal pending_lines
        if pending_lines >= _LOG_SAVE_BATCH_SIZE:
            run_obj.save(update_fields=["logs"])
            pending_lines = 0

    for line in process.stdout:
        output_chunks.append(line)
        line_stripped = line.strip()
        if line_stripped.startswith("{"):
            try:
                data = json.loads(line_stripped)
                log_line = _format_stream_json_log(data, run_obj)
                if data.get("type") == "tool_call" and data.get("subtype") == "started":
                    tool_count += 1
                if data.get("type") == "assistant":
                    content = data.get("message", {}).get("content", [])
                    if content and isinstance(content, list) and content[0].get("text"):
                        accumulated_text += content[0].get("text", "")
                if log_line:
                    run_obj.logs = (run_obj.logs or "") + log_line + "\n"
                    pending_lines += 1
                    maybe_flush()
            except json.JSONDecodeError:
                run_obj.logs = (run_obj.logs or "") + line
                pending_lines += 1
                maybe_flush()
        else:
            if line_stripped:
                run_obj.logs = (run_obj.logs or "") + line
                pending_lines += 1
                maybe_flush()

    timeout_sec = getattr(settings, "CLI_RUNTIME_TIMEOUT_SECONDS", None)
    try:
        exit_code = process.wait(timeout=timeout_sec) if timeout_sec else process.wait()
    except subprocess.TimeoutExpired:
        process.kill()
        run_obj.logs = (run_obj.logs or "") + "[TIMEOUT] Process killed after timeout\n"
        run_obj.save(update_fields=["logs"])
        return {"success": False, "output": "".join(output_chunks), "exit_code": -1}

    summary = f"\n{'─'*40}\n📊 Итого: {tool_count} операций, {len(accumulated_text)} символов\n"
    summary += "✅ Успешно завершено\n" if exit_code == 0 else f"❌ Завершено с ошибкой (код {exit_code})\n"
    summary += f"{'─'*40}\n"
    run_obj.logs = (run_obj.logs or "") + summary
    run_obj.save(update_fields=["logs"])
    return {"success": exit_code == 0, "output": "".join(output_chunks), "exit_code": exit_code}


def _resolve_cli_command(runtime: str) -> str:
    env_var = _cli_env_var(runtime)
    # Для cursor в Docker/на хосте явно учитываем CURSOR_CLI_PATH при каждом вызове
    if runtime == "cursor":
        path_from_env = (os.getenv("CURSOR_CLI_PATH") or "").strip()
        if path_from_env:
            if Path(path_from_env).exists():
                return path_from_env
            raise RuntimeError(
                f"CURSOR_CLI_PATH задан, но файл не найден: {path_from_env}. "
                "Проверь путь в .env (в Docker — путь внутри контейнера, например к смонтированному бинарнику)."
            )

    runtime_cfg = settings.CLI_RUNTIME_CONFIG.get(runtime) or {}
    command = runtime_cfg.get("command", "")
    if not command:
        raise RuntimeError(f"CLI для '{runtime}' не настроен")
    if os.path.isabs(command):
        if not Path(command).exists():
            raise RuntimeError(
                f"CLI для '{runtime}' не найден: {command}. "
                f"Проверь путь или переменную окружения {env_var}"
            )
        return command

    resolved = shutil.which(command)
    if not resolved:
        if runtime == "cursor":
            raise RuntimeError(
                "CLI для 'cursor' не найден (бинарник agent). "
                "В Docker в .env задай CURSOR_CLI_PATH=/полный/путь/к/agent (бинарник должен быть в образе или смонтирован). "
                "На хосте добавь agent в PATH или задай CURSOR_CLI_PATH."
            )
        raise RuntimeError(
            f"CLI для '{runtime}' не найден: {command}. "
            f"Добавь в PATH или задай переменную окружения {env_var}"
        )
    return resolved


def _cli_env_var(runtime: str) -> str:
    return {
        "cursor": "CURSOR_CLI_PATH",
        "opencode": "OPENCODE_CLI_PATH",
        "gemini": "GEMINI_CLI_PATH",
        "ralph": "RALPH_CLI_PATH",
    }.get(runtime, "CLI_PATH")


def _format_arg(runtime_cfg: Dict[str, Any], arg: str, workspace: str = None) -> str:
    if arg != "{workspace}":
        return arg
    if workspace:
        return workspace
    return str(getattr(settings, "BASE_DIR", ""))


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


def _get_user_servers_context(user_id: int) -> str:
    """
    Возвращает контекст о серверах пользователя из вкладки Servers для промпта воркфлоу.
    Если серверы есть — возвращает инструкции и список; иначе пустую строку.
    Если задан MASTER_PASSWORD в env — расшифровывает пароли и подставляет команды подключения.
    """
    try:
        from servers.models import Server
        from passwords.encryption import PasswordEncryption
        master_pwd = os.environ.get("MASTER_PASSWORD", "").strip()
        servers = list(Server.objects.filter(user_id=user_id).only(
            "id", "name", "host", "port", "username", "auth_method", "key_path", "encrypted_password", "salt"
        ))
        if not servers:
            return ""
        lines = [
            "\n\n=== СЕРВЕРЫ ПОЛЬЗОВАТЕЛЯ (из вкладки Servers) ===",
            "ВАЖНО: Данные серверов хранятся в БД. НЕ ищи их в коде!",
            "Для выполнения команд используй SSH напрямую по указанным данным.",
            "",
        ]
        for s in servers:
            auth = s.auth_method or "password"
            key_path = s.key_path or ""
            pwd_decrypted = ""
            if auth in ("password", "key_password") and s.encrypted_password and master_pwd and s.salt:
                try:
                    pwd_decrypted = PasswordEncryption.decrypt_password(s.encrypted_password, master_pwd, bytes(s.salt))
                except Exception:
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

    # Контекст серверов пользователя
    user_id = run_obj.initiated_by_id
    servers_context = _get_user_servers_context(user_id) if user_id else ""

    # Получаем путь к workspace
    workspace = _get_workspace_path(workflow)
    run_obj.logs = (run_obj.logs or "") + f"[Workflow started]\n[Workspace: {workspace}]\n"
    if servers_context:
        run_obj.logs = (run_obj.logs or "") + "[Servers context loaded from DB]\n"
    run_obj.save(update_fields=["status", "started_at", "logs"])

    steps = (workflow.script or {}).get("steps", [])
    step_results = []

    try:
        if workflow.runtime == "ralph":
            script = workflow.script or {}
            backend = (
                (script.get("ralph_yml") or {}).get("cli", {}).get("backend")
                or script.get("backend")
                or "cursor"
            )
            run_obj.logs = (run_obj.logs or "") + (
                f"[Ralph mode: orchestrate via {backend} CLI]\n"
            )
            run_obj.save(update_fields=["logs"])
            _run_steps_with_backend(
                run_obj=run_obj,
                steps=steps,
                runtime=backend,
                workflow=workflow,
                step_results=step_results,
                workspace=workspace,
                servers_context=servers_context,
            )
        else:
            _run_steps_with_backend(
                run_obj=run_obj,
                steps=steps,
                runtime=workflow.runtime,
                workflow=workflow,
                step_results=step_results,
                workspace=workspace,
                servers_context=servers_context,
            )

        run_obj.status = "succeeded"
        run_obj.output_text = json.dumps(step_results, ensure_ascii=False)
        run_obj.meta = {"steps": len(steps), "workspace": workspace}
    except Exception as exc:
        run_obj.status = "failed"
        run_obj.logs = (run_obj.logs or "") + f"\n{exc}\n"
        run_obj.output_text = json.dumps(step_results, ensure_ascii=False)
    finally:
        run_obj.finished_at = timezone.now()
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
    extra_env = _get_cursor_cli_extra_env() if runtime == "cursor" else None
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
        step_prompt = step.get("prompt", "")
        completion_promise = step.get("completion_promise", "STEP_DONE")
        max_iterations = step.get("max_iterations", 5)
        verify_prompt = step.get("verify_prompt")
        verify_promise = step.get("verify_promise", "PASS")
        config = {
            "use_ralph_loop": True,
            "completion_promise": completion_promise,
            "max_iterations": max_iterations,
        }
        if runtime != "cursor":
            config["model"] = (workflow.script or {}).get("model")
            config["specific_model"] = (workflow.script or {}).get("specific_model")

        step_success = False
        last_error = None
        retry_attempt = 0
        while retry_attempt <= max_retries and not step_success:
            try:
                run_obj.retry_count = retry_attempt
                run_obj.save(update_fields=["retry_count"])
                current_prompt = step_prompt
                if servers_context:
                    current_prompt = servers_context + "\n\n" + current_prompt
                if retry_attempt > 0:
                    current_prompt = (
                        f"Previous attempt failed with error: {last_error}\n\n"
                        f"Please fix the issue and try again.\n\nOriginal task:\n{step_prompt}"
                    )
                    if servers_context:
                        current_prompt = servers_context + "\n\n" + current_prompt
                    run_obj.logs = (run_obj.logs or "") + f"\n[Retry {retry_attempt}/{max_retries} for {step_title}]\n"
                    run_obj.save(update_fields=["logs"])
                if completion_promise:
                    current_prompt = f"{current_prompt}\n\nWhen complete output exactly: <promise>{completion_promise}</promise>."
                cmd = _build_cli_command(runtime, current_prompt, config, workspace)
                result = _run_cli_stream(cmd, run_obj, step_label=step_title, extra_env=extra_env)
                if verify_prompt:
                    verify_text = f"{verify_prompt}\n\nWhen verified output exactly: <promise>{verify_promise}</promise>." if verify_promise else verify_prompt
                    verify_cmd = _build_cli_command(runtime, verify_text, {**config, "completion_promise": verify_promise}, workspace)
                    verify_result = _run_cli_stream(verify_cmd, run_obj, step_label=f"{step_title} - verify", extra_env=extra_env)
                    if verify_promise and not _promise_found(verify_result.get("output", ""), verify_promise):
                        last_error = f"Verification failed: expected {verify_promise}"
                        retry_attempt += 1
                        continue
                step_success = True
                sr = {"step_idx": idx, "step": step_title, "status": "completed", "retries": retry_attempt, "result": result}
                step_results.append(sr)
                step_results_existing.append(sr)
                run_obj.step_results = step_results_existing
                run_obj.save(update_fields=["step_results"])
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
    servers_context = _get_user_servers_context(user_id) if user_id else ""
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
    return JsonResponse({"success": True, "config": parsed})


@csrf_exempt
@login_required
@require_feature('agents')
@require_http_methods(["POST"])
def api_assist_auto(request):
    data = _parse_json_request(request)
    task = data.get("task", "").strip()
    runtime = data.get("runtime", "ralph")
    action = data.get("action", "both")
    run_workflow = bool(data.get("run_workflow", True))
    
    # Обработка проекта
    project_path = data.get("project_path", "").strip()
    create_new_project = data.get("create_new_project", False)
    new_project_name = data.get("new_project_name", "").strip()

    if not task:
        return JsonResponse({"error": "Task is required"}, status=400)
    if runtime not in ALLOWED_RUNTIMES:
        runtime = "ralph"

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
            runtime=cfg.get("runtime", "ralph"),
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
    runtime = data.get("runtime", "ralph")
    steps = data.get("steps", [])
    run_after_save = data.get("run_after_save", False)
    
    # Обработка проекта
    project_path = data.get("project_path", "").strip()
    create_new_project = data.get("create_new_project", False)
    new_project_name = data.get("new_project_name", "").strip()
    
    if not steps:
        return JsonResponse({"error": "At least one step is required"}, status=400)
    
    if runtime not in ALLOWED_RUNTIMES:
        runtime = "ralph"
    
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
        "steps": []
    }
    
    for step in steps:
        step_data = {
            "title": step.get("title", ""),
            "prompt": step.get("prompt", ""),
            "completion_promise": step.get("completion_promise", "STEP_DONE"),
            "max_iterations": step.get("max_iterations", 5),
        }
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
    
    # Создаем workflow
    workflow = AgentWorkflow.objects.create(
        owner=request.user,
        name=name,
        description=f"Created manually with {len(steps)} steps",
        runtime=runtime,
        script=script,
        project_path=project_path,
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
    runtime = script.get("runtime", "ralph")
    if runtime not in ALLOWED_RUNTIMES:
        runtime = "ralph"
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
    workflow = get_object_or_404(AgentWorkflow, id=workflow_id, owner=request.user)
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
    if "steps" in data:
        script = workflow.script or {}
        script["steps"] = data["steps"]
        script["name"] = workflow.name
        script["runtime"] = workflow.runtime
        if workflow.runtime == "ralph":
            completion, max_iter, backend = "LOOP_COMPLETE", 50, "cursor"
            hats = {}
            prev = "task.start"
            for idx, step in enumerate(data["steps"], start=1):
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
