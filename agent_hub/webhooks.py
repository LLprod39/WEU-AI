"""
Webhook endpoints for automatic agent execution.
"""
from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from asgiref.sync import async_to_sync
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from loguru import logger

from core_ui.decorators import require_feature
from agent_hub.models import AgentWebhook, AgentWebhookEvent, CustomAgent
from servers.models import Server
from tasks.models import Task
from tasks.task_executor import TaskExecutor
from app.services.workflow_service import WorkflowService


DEFAULT_TITLE_TEMPLATE = "{{webhook_name}}: {{event_name}}"
DEFAULT_DESCRIPTION_TEMPLATE = "Источник: {{source}}\nВремя: {{received_at}}\n\nPayload:\n{{payload_json}}"
DEFAULT_VERIFY_PROMISE = "PASS"


def _parse_payload(request) -> Dict[str, Any]:
    try:
        body = request.body.decode("utf-8") if request.body else ""
        if body:
            return json.loads(body)
    except Exception:
        pass

    if request.POST:
        if "payload" in request.POST:
            try:
                return json.loads(request.POST.get("payload", "{}"))
            except Exception:
                return {"payload": request.POST.get("payload")}
        return dict(request.POST)

    return {}


def _get_by_path(data: Any, path: str) -> Any:
    if not path:
        return None
    current = data
    for part in path.split("."):
        if part == "":
            continue
        if current is None:
            return None

        array_match = re.match(r"^([^\[]+)\[(\d+)\]$", part)
        if array_match:
            key = array_match.group(1)
            idx = int(array_match.group(2))
            if not isinstance(current, dict) or key not in current:
                return None
            current = current.get(key)
            if not isinstance(current, list) or idx >= len(current):
                return None
            current = current[idx]
            continue

        if part.isdigit() and isinstance(current, list):
            idx = int(part)
            if idx >= len(current):
                return None
            current = current[idx]
            continue

        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None

    return current


def _render_template(template: str, payload: Dict[str, Any], extra: Dict[str, Any]) -> str:
    if not template:
        return ""

    def _replace(match: re.Match) -> str:
        key = match.group(1).strip()
        if key in extra:
            return str(extra[key])
        if key in {"payload_json", "json", "_json"}:
            return json.dumps(payload, ensure_ascii=False, indent=2)
        if key.startswith("payload."):
            key = key[len("payload."):]
        value = _get_by_path(payload, key)
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    return re.sub(r"\{\{\s*([^}]+)\s*\}\}", _replace, template)


def _resolve_server(owner, payload: Dict[str, Any], config: Dict[str, Any]) -> Optional[Server]:
    if not owner:
        return None

    target_server_id = config.get("target_server_id")
    if target_server_id:
        return Server.objects.filter(user=owner, id=target_server_id, is_active=True).first()

    server_map = config.get("server_map") or {}
    server_field = config.get("server_field")

    candidate = None
    if server_field:
        candidate = _get_by_path(payload, server_field)
    else:
        for key in ["host", "hostname", "server", "node", "server_name"]:
            candidate = _get_by_path(payload, key)
            if candidate:
                break

    if candidate is None:
        return None

    candidate_str = str(candidate)

    mapped_id = server_map.get(candidate_str)
    if mapped_id:
        mapped = Server.objects.filter(user=owner, id=mapped_id, is_active=True).first()
        if mapped:
            return mapped

    return Server.objects.filter(
        user=owner,
        is_active=True,
    ).filter(Q(name__iexact=candidate_str) | Q(host__iexact=candidate_str)).first()


def _build_remediation_script(
    task: Task,
    payload: Dict[str, Any],
    target_server: Optional[Server],
    runtime: str,
    skill_ids: Optional[list[int]] = None,
    verify_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    payload_json = json.dumps(payload, ensure_ascii=False, indent=2)
    server_name = target_server.name if target_server else ""
    server_hint = f"Target server: {server_name}" if server_name else "No explicit server"
    tool_hint = (
        f"Use ONLY server_execute with server_name_or_id=\"{server_name}\"."
        if server_name
        else "No server_execute required unless you need one."
    )
    verify_text = verify_prompt or (
        "Проверь, что проблема устранена. Проверь статус сервисов и метрики. "
        f"Когда всё ок, выведи <promise>{DEFAULT_VERIFY_PROMISE}</promise>."
    )

    steps = [
        {
            "title": "Triage",
            "prompt": (
                "Собери диагностику и опиши первопричину.\n"
                f"{server_hint}\n{tool_hint}\n\n"
                f"Payload:\n{payload_json}\n\n"
                "Когда готово, выведи <promise>STEP_DONE</promise>."
            ),
            "completion_promise": "STEP_DONE",
            "max_iterations": 3,
        },
        {
            "title": "Remediate",
            "prompt": (
                "Устрани проблему. Объясни, что меняешь и почему.\n"
                f"{server_hint}\n{tool_hint}\n\n"
                f"Payload:\n{payload_json}\n\n"
                "Когда готово, выведи <promise>STEP_DONE</promise>."
            ),
            "completion_promise": "STEP_DONE",
            "max_iterations": 5,
        },
        {
            "title": "Verify",
            "prompt": (
                "Верифицируй результат.\n"
                f"{server_hint}\n{tool_hint}\n\n"
                f"{verify_text}\n"
                "Когда готово, выведи <promise>STEP_DONE</promise>."
            ),
            "completion_promise": "STEP_DONE",
            "max_iterations": 3,
            "verify_prompt": verify_text,
            "verify_promise": DEFAULT_VERIFY_PROMISE,
        },
    ]

    script = {
        "name": f"Remediation: {task.title[:60]}",
        "description": f"Auto-remediation workflow for {task.title}",
        "runtime": runtime,
        "task_type": "server" if target_server else "code",
        "steps": steps,
    }
    if skill_ids:
        script["skill_ids"] = skill_ids
    return script


def _start_task_execution(task: Task, user_id: int) -> None:
    executor = TaskExecutor()
    thread = threading.Thread(
        target=lambda: async_to_sync(executor.execute_task)(task.id, user_id)
    )
    thread.daemon = True
    thread.start()


@csrf_exempt
@require_http_methods(["POST"])
def api_webhook_receive(request, secret: str):
    webhook = AgentWebhook.objects.filter(secret=secret, is_active=True).first()
    if not webhook:
        return JsonResponse({"success": False, "error": "Webhook not found"}, status=404)

    payload = _parse_payload(request)
    event = AgentWebhookEvent.objects.create(webhook=webhook, payload=payload, status="received")

    try:
        config = webhook.config or {}
        received_at = datetime.now(timezone.utc).isoformat()
        extra = {
            "webhook_name": webhook.name,
            "source": webhook.source,
            "received_at": received_at,
            "event_name": _get_by_path(payload, config.get("event_name_field", "")) or config.get("event_name") or "Webhook Event",
        }

        title_template = config.get("title_template") or DEFAULT_TITLE_TEMPLATE
        description_template = config.get("description_template") or DEFAULT_DESCRIPTION_TEMPLATE
        task_title = _render_template(title_template, payload, extra).strip() or webhook.name
        task_description = _render_template(description_template, payload, extra).strip()

        target_server = _resolve_server(webhook.owner, payload, config)
        server_name_mentioned = None
        server_field = config.get("server_field")
        if server_field:
            server_name_mentioned = _get_by_path(payload, server_field)
        elif target_server:
            server_name_mentioned = target_server.name

        custom_agent = webhook.custom_agent if webhook.custom_agent and webhook.custom_agent.is_active else None
        agent_type = webhook.agent_type or "react"

        event_id_field = config.get("event_id_field") or "event_id"
        external_id = _get_by_path(payload, event_id_field)
        if external_id is not None:
            external_id = str(external_id)

        task = Task.objects.create(
            title=task_title[:200],
            description=task_description,
            status="TODO",
            created_by=webhook.owner,
            assigned_to_ai=True,
            ai_agent_type=agent_type,
            recommended_custom_agent=custom_agent,
            auto_execution_suggested=True,
            auto_execution_approved=bool(webhook.auto_execute),
            ai_execution_status="PENDING",
            target_server=target_server,
            server_name_mentioned=str(server_name_mentioned) if server_name_mentioned else "",
            external_id=external_id or "",
            sync_back=False,
        )

        result: Dict[str, Any] = {
            "task_id": task.id,
            "task_title": task.title,
            "target_server": target_server.name if target_server else None,
            "execution_mode": webhook.execution_mode,
        }

        if webhook.auto_execute:
            if not target_server and webhook.execution_mode == "task":
                task.ai_execution_status = "FAILED"
                task.save(update_fields=["ai_execution_status"])
                result["error"] = "Target server not resolved; execution skipped"
            elif webhook.execution_mode == "workflow":
                template_mode = (config.get("workflow_template") or "").strip().lower()
                runtime_override = (config.get("runtime") or "").strip() or None
                skill_ids_override = None
                if isinstance(config.get("skill_ids"), list):
                    skill_ids_override = config.get("skill_ids")
                elif custom_agent:
                    skill_ids_override = list(custom_agent.skills.values_list("id", flat=True))

                if template_mode == "remediation":
                    from pathlib import Path
                    from django.conf import settings
                    from agent_hub.models import AgentWorkflow
                    from agent_hub.views_legacy import _start_workflow_run, _write_ralph_yml

                    runtime = runtime_override or (custom_agent.runtime if custom_agent else None) or "cursor"
                    script = _build_remediation_script(
                        task=task,
                        payload=payload,
                        target_server=target_server,
                        runtime=runtime,
                        skill_ids=skill_ids_override,
                        verify_prompt=(config.get("verify_prompt") or "").strip() or None,
                    )

                    workflow = AgentWorkflow.objects.create(
                        owner=webhook.owner,
                        name=script.get("name", task.title[:80]),
                        description=script.get("description", "")[:200],
                        runtime=runtime,
                        script=script,
                        project_path="",
                        target_server=target_server,
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

                    run = _start_workflow_run(workflow, webhook.owner)
                    task.ai_execution_status = "RUNNING"
                    task.save(update_fields=["ai_execution_status"])
                else:
                    workflow, run = WorkflowService.create_from_task(
                        task,
                        webhook.owner,
                        runtime_override=runtime_override,
                        skill_ids_override=skill_ids_override,
                    )

                result["workflow_id"] = workflow.id if workflow else None
                result["workflow_run_id"] = run.id if run else None
            else:
                _start_task_execution(task, webhook.owner.id)

        event.status = "processed"
        event.result = result
        event.save(update_fields=["status", "result"])

        return JsonResponse({"success": True, "event_id": event.id, "result": result})

    except Exception as e:
        logger.error(f"Webhook processing failed: {e}")
        event.status = "failed"
        event.error_message = str(e)
        event.save(update_fields=["status", "error_message"])
        return JsonResponse({"success": False, "error": str(e), "event_id": event.id}, status=500)


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET", "POST"])
def api_webhooks_list(request):
    if request.method == "GET":
        hooks = AgentWebhook.objects.filter(owner=request.user).order_by("-updated_at")
        data = []
        for hook in hooks:
            data.append({
                "id": hook.id,
                "name": hook.name,
                "description": hook.description,
                "source": hook.source,
                "secret": hook.secret,
                "config": hook.config,
                "custom_agent_id": hook.custom_agent_id,
                "agent_type": hook.agent_type,
                "auto_execute": hook.auto_execute,
                "execution_mode": hook.execution_mode,
                "is_active": hook.is_active,
                "created_at": hook.created_at.isoformat() if hook.created_at else None,
                "updated_at": hook.updated_at.isoformat() if hook.updated_at else None,
            })
        return JsonResponse({"success": True, "webhooks": data})

    data = json.loads(request.body or "{}")
    custom_agent_id = data.get("custom_agent_id")
    custom_agent = None
    if custom_agent_id:
        custom_agent = CustomAgent.objects.filter(owner=request.user, id=custom_agent_id, is_active=True).first()

    execution_mode = data.get("execution_mode", "task")
    if execution_mode not in ("task", "workflow"):
        execution_mode = "task"

    hook = AgentWebhook.objects.create(
        owner=request.user,
        name=data.get("name", "New Webhook"),
        description=data.get("description", ""),
        source=data.get("source", "generic"),
        config=data.get("config", {}) or {},
        custom_agent=custom_agent,
        agent_type=data.get("agent_type", "react"),
        auto_execute=bool(data.get("auto_execute", True)),
        execution_mode=execution_mode,
        is_active=bool(data.get("is_active", True)),
    )

    return JsonResponse({"success": True, "webhook_id": hook.id, "secret": hook.secret})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET", "PUT", "DELETE"])
def api_webhook_detail(request, webhook_id: int):
    hook = AgentWebhook.objects.filter(owner=request.user, id=webhook_id).first()
    if not hook:
        return JsonResponse({"success": False, "error": "Webhook not found"}, status=404)

    if request.method == "GET":
        return JsonResponse({
            "success": True,
            "webhook": {
                "id": hook.id,
                "name": hook.name,
                "description": hook.description,
                "source": hook.source,
                "secret": hook.secret,
                "config": hook.config,
                "custom_agent_id": hook.custom_agent_id,
                "agent_type": hook.agent_type,
                "auto_execute": hook.auto_execute,
                "execution_mode": hook.execution_mode,
                "is_active": hook.is_active,
                "created_at": hook.created_at.isoformat() if hook.created_at else None,
                "updated_at": hook.updated_at.isoformat() if hook.updated_at else None,
            },
        })

    if request.method == "PUT":
        data = json.loads(request.body or "{}")
        if "name" in data:
            hook.name = data["name"]
        if "description" in data:
            hook.description = data["description"]
        if "source" in data:
            hook.source = data["source"]
        if "config" in data:
            hook.config = data["config"] or {}
        if "agent_type" in data:
            hook.agent_type = data["agent_type"]
        if "auto_execute" in data:
            hook.auto_execute = bool(data["auto_execute"])
        if "execution_mode" in data:
            mode = data["execution_mode"]
            hook.execution_mode = mode if mode in ("task", "workflow") else "task"
        if "is_active" in data:
            hook.is_active = bool(data["is_active"])
        if "custom_agent_id" in data:
            custom_agent_id = data.get("custom_agent_id")
            hook.custom_agent = CustomAgent.objects.filter(owner=request.user, id=custom_agent_id, is_active=True).first() if custom_agent_id else None

        hook.save()
        return JsonResponse({"success": True, "message": "Webhook updated"})

    hook.is_active = False
    hook.save(update_fields=["is_active"])
    return JsonResponse({"success": True, "message": "Webhook disabled"})
