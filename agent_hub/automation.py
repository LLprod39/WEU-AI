"""
Automation and run endpoints for custom agents.
"""
from __future__ import annotations

import json
import threading
from typing import Any, Dict

from asgiref.sync import async_to_sync
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from loguru import logger

from core_ui.decorators import require_feature
from agent_hub.models import CustomAgent
from app.services.workflow_service import WorkflowService
from tasks.models import Task
from tasks.task_executor import TaskExecutor


def _parse_json_body(request) -> Dict[str, Any]:
    try:
        return json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return {}


def _start_task_executor(task_id: int, user_id: int) -> None:
    executor = TaskExecutor()
    thread = threading.Thread(
        target=lambda: async_to_sync(executor.execute_task)(task_id, user_id)
    )
    thread.daemon = True
    thread.start()


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_custom_agent_run(request):
    """
    Run a custom agent by creating a Task and optionally executing it.

    Payload:
    {
        "agent_id": 1,
        "task": "string",
        "title": "optional title",
        "server_id": 3 | null,
        "auto_execute": true|false,
        "project_path": "optional",
        "runtime": "cursor|claude|gemini|grok",
        "skill_ids": [1,2]
    }
    """
    data = _parse_json_body(request)
    agent_id = data.get("agent_id")
    task_text = (data.get("task") or "").strip()
    if not agent_id or not task_text:
        return JsonResponse({"success": False, "error": "agent_id and task are required"}, status=400)

    custom_agent = CustomAgent.objects.filter(
        owner=request.user,
        id=agent_id,
        is_active=True,
    ).first()
    if not custom_agent:
        return JsonResponse({"success": False, "error": "Agent not found"}, status=404)

    title = (data.get("title") or "").strip() or task_text.split("\n", 1)[0][:200]
    server_id = data.get("server_id")
    try:
        server_id = int(server_id) if server_id not in (None, "") else None
    except (TypeError, ValueError):
        server_id = None
    auto_execute = bool(data.get("auto_execute", True))
    project_path = (data.get("project_path") or "").strip()
    runtime_override = (data.get("runtime") or "").strip() or None
    skill_ids_override = data.get("skill_ids") if isinstance(data.get("skill_ids"), list) else None
    if skill_ids_override is None:
        skill_ids_override = list(custom_agent.skills.values_list("id", flat=True))

    task = Task.objects.create(
        title=title[:200],
        description=task_text,
        status="TODO",
        created_by=request.user,
        assigned_to_ai=True,
        ai_agent_type="react",
        recommended_custom_agent=custom_agent,
        auto_execution_suggested=True,
        auto_execution_approved=auto_execute,
        ai_execution_status="PENDING",
        sync_back=False,
    )

    if server_id:
        from servers.models import Server

        server = Server.objects.filter(user=request.user, id=server_id, is_active=True).first()
        if not server:
            task.delete()
            return JsonResponse({"success": False, "error": "Server not found"}, status=404)

        allowed_servers = custom_agent.allowed_servers
        if isinstance(allowed_servers, list) and server_id not in allowed_servers:
            task.delete()
            return JsonResponse({"success": False, "error": "Agent has no access to this server"}, status=403)

        task.target_server = server
        task.server_name_mentioned = server.name
        task.save(update_fields=["target_server", "server_name_mentioned"])

        if auto_execute:
            _start_task_executor(task.id, request.user.id)
            return JsonResponse({"success": True, "task_id": task.id, "started": True})

        return JsonResponse({"success": True, "task_id": task.id, "started": False})

    if not auto_execute:
        return JsonResponse({"success": True, "task_id": task.id, "started": False})

    try:
        workflow, run = WorkflowService.create_from_task(
            task,
            request.user,
            runtime_override=runtime_override,
            project_path_override=project_path or None,
            skill_ids_override=skill_ids_override,
        )
    except Exception as e:
        logger.error(f"Failed to create workflow from custom agent run: {e}")
        task.ai_execution_status = "FAILED"
        task.save(update_fields=["ai_execution_status"])
        return JsonResponse({"success": False, "error": str(e)}, status=500)

    return JsonResponse({
        "success": True,
        "task_id": task.id,
        "workflow_id": workflow.id if workflow else None,
        "workflow_run_id": run.id if run else None,
        "started": True,
    })
