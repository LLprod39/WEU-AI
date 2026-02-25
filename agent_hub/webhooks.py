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
ALLOWED_WORKFLOW_RUNTIMES = {"internal", "cursor", "claude", "codex", "opencode", "gemini", "ralph"}


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


def _clamp_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(min_value, min(max_value, parsed))


def _normalize_runtime_name(runtime: Any, default: str = "cursor") -> str:
    value = str(runtime or "").strip().lower()
    return value if value in ALLOWED_WORKFLOW_RUNTIMES else default


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        norm = value.strip().lower()
        if norm in {"1", "true", "yes", "on"}:
            return True
        if norm in {"0", "false", "no", "off", ""}:
            return False
    return default


def _normalize_email_list(value: Any) -> list[str]:
    if isinstance(value, str):
        raw_items = [part.strip() for part in value.split(",")]
    elif isinstance(value, list):
        raw_items = [str(item or "").strip() for item in value]
    else:
        return []

    emails: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        if not item or "@" not in item:
            continue
        lower = item.lower()
        if lower in seen:
            continue
        seen.add(lower)
        emails.append(item)
    return emails


def _normalize_notify_config(raw_notify: Any) -> Dict[str, Any]:
    if not isinstance(raw_notify, dict):
        return {}
    notify: Dict[str, Any] = {}
    emails = _normalize_email_list(raw_notify.get("emails"))
    if emails:
        notify["emails"] = emails
    if "on_success" in raw_notify:
        notify["on_success"] = _as_bool(raw_notify.get("on_success"), default=True)
    if "on_failure" in raw_notify:
        notify["on_failure"] = _as_bool(raw_notify.get("on_failure"), default=True)
    return notify


def _build_notify_config_from_webhook_config(config: Dict[str, Any]) -> Dict[str, Any]:
    notify: Dict[str, Any] = {}
    emails = _normalize_email_list(config.get("notify_emails"))
    if emails:
        notify["emails"] = emails
    if "notify_on_success" in config:
        notify["on_success"] = _as_bool(config.get("notify_on_success"), default=True)
    if "notify_on_failure" in config:
        notify["on_failure"] = _as_bool(config.get("notify_on_failure"), default=True)
    return notify


def _normalize_int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    out: list[int] = []
    seen: set[int] = set()
    for raw in value:
        try:
            num = int(raw)
        except (TypeError, ValueError):
            continue
        if num <= 0 or num in seen:
            continue
        seen.add(num)
        out.append(num)
    return out


def _normalize_workflow_script(raw_script: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw_script, str):
        try:
            raw_script = json.loads(raw_script)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw_script, dict):
        return None

    script: Dict[str, Any] = {}
    name = str(raw_script.get("name") or "").strip()
    description = str(raw_script.get("description") or "").strip()
    runtime = str(raw_script.get("runtime") or "").strip().lower()
    task_type = str(raw_script.get("task_type") or "").strip().lower()
    model = str(raw_script.get("model") or "").strip()

    if name:
        script["name"] = name[:200]
    if description:
        script["description"] = description[:5000]
    if runtime:
        script["runtime"] = _normalize_runtime_name(runtime, default=runtime)
    if task_type in {"server", "code"}:
        script["task_type"] = task_type
    if model:
        script["model"] = model[:100]

    steps_raw = raw_script.get("steps")
    steps: list[Dict[str, Any]] = []
    if isinstance(steps_raw, list):
        for idx, raw_step in enumerate(steps_raw[:30], start=1):
            if not isinstance(raw_step, dict):
                continue
            prompt = str(raw_step.get("prompt") or "").strip()
            if not prompt:
                continue
            step: Dict[str, Any] = {
                "title": (str(raw_step.get("title") or f"Step {idx}").strip() or f"Step {idx}")[:200],
                "prompt": prompt,
                "completion_promise": (str(raw_step.get("completion_promise") or "STEP_DONE").strip() or "STEP_DONE")[:100],
                "max_iterations": _clamp_int(raw_step.get("max_iterations"), default=5, min_value=1, max_value=30),
            }
            verify_prompt = str(raw_step.get("verify_prompt") or "").strip()
            if verify_prompt:
                step["verify_prompt"] = verify_prompt
                step["verify_promise"] = (
                    str(raw_step.get("verify_promise") or DEFAULT_VERIFY_PROMISE).strip()
                    or DEFAULT_VERIFY_PROMISE
                )[:100]
            step_model = str(raw_step.get("model") or "").strip()
            if step_model:
                step["model"] = step_model[:100]
            steps.append(step)

    if not steps:
        return None
    script["steps"] = steps

    skill_ids = _normalize_int_list(raw_script.get("skill_ids"))
    if skill_ids:
        script["skill_ids"] = skill_ids

    notify = _normalize_notify_config(raw_script.get("notify"))
    if notify:
        script["notify"] = notify

    return script


def _normalize_webhook_config(raw_config: Any) -> Dict[str, Any]:
    if not isinstance(raw_config, dict):
        return {}

    cfg: Dict[str, Any] = {}
    for key in (
        "workflow_template",
        "workflow_name_template",
        "workflow_description_template",
        "server_field",
        "event_id_field",
        "event_name_field",
        "event_name",
        "title_template",
        "description_template",
        "verify_prompt",
    ):
        value = raw_config.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            cfg[key] = text
    runtime_value = raw_config.get("runtime")
    if runtime_value not in (None, ""):
        cfg["runtime"] = _normalize_runtime_name(runtime_value)
    notify_emails = raw_config.get("notify_emails")
    if notify_emails not in (None, ""):
        normalized_emails = _normalize_email_list(notify_emails)
        if normalized_emails:
            cfg["notify_emails"] = ", ".join(normalized_emails)
    if "notify_on_success" in raw_config:
        cfg["notify_on_success"] = _as_bool(raw_config.get("notify_on_success"), default=True)
    if "notify_on_failure" in raw_config:
        cfg["notify_on_failure"] = _as_bool(raw_config.get("notify_on_failure"), default=True)

    target_server_id = raw_config.get("target_server_id")
    if target_server_id not in (None, ""):
        try:
            parsed_id = int(target_server_id)
        except (TypeError, ValueError):
            parsed_id = None
        if parsed_id and parsed_id > 0:
            cfg["target_server_id"] = parsed_id

    server_map_raw = raw_config.get("server_map")
    if isinstance(server_map_raw, dict):
        server_map: Dict[str, int] = {}
        for raw_name, raw_id in server_map_raw.items():
            name = str(raw_name or "").strip()
            if not name:
                continue
            try:
                sid = int(raw_id)
            except (TypeError, ValueError):
                continue
            if sid > 0:
                server_map[name] = sid
        if server_map:
            cfg["server_map"] = server_map

    skill_ids = _normalize_int_list(raw_config.get("skill_ids"))
    if skill_ids:
        cfg["skill_ids"] = skill_ids

    workflow_script = _normalize_workflow_script(raw_config.get("workflow_script"))
    if workflow_script:
        cfg["workflow_script"] = workflow_script
        cfg.setdefault("workflow_template", "custom")

    return cfg


def _render_template_tree(value: Any, payload: Dict[str, Any], extra: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        return _render_template(value, payload, extra)
    if isinstance(value, list):
        return [_render_template_tree(item, payload, extra) for item in value]
    if isinstance(value, dict):
        return {str(k): _render_template_tree(v, payload, extra) for k, v in value.items()}
    return value


def _ensure_ralph_yml(script: Dict[str, Any], runtime: str) -> None:
    if runtime != "ralph" or script.get("ralph_yml"):
        return
    steps = script.get("steps") if isinstance(script.get("steps"), list) else []
    hats: Dict[str, Any] = {}
    previous_event = "task.start"
    for idx, step in enumerate(steps, start=1):
        next_event = f"step_{idx}.done"
        hats[f"step_{idx}"] = {
            "name": (step.get("title") or f"Step {idx}") if isinstance(step, dict) else f"Step {idx}",
            "description": (step.get("title") or f"Step {idx}") if isinstance(step, dict) else f"Step {idx}",
            "triggers": [previous_event],
            "publishes": [next_event],
            "instructions": step.get("prompt", "") if isinstance(step, dict) else "",
        }
        previous_event = next_event
    script["ralph_yml"] = {
        "cli": {"backend": "cursor"},
        "event_loop": {
            "completion_promise": "LOOP_COMPLETE",
            "max_iterations": 50,
            "starting_event": "task.start",
        },
        "hats": hats,
    }


def _apply_workflow_script_overrides(
    script: Dict[str, Any],
    config: Dict[str, Any],
    payload: Dict[str, Any],
    extra: Dict[str, Any],
    target_server: Optional[Server],
    default_name: str,
    default_description: str,
) -> Dict[str, Any]:
    if not isinstance(script, dict):
        script = {}

    name_template = str(config.get("workflow_name_template") or "").strip()
    if name_template:
        rendered_name = _render_template(name_template, payload, extra).strip()
        if rendered_name:
            script["name"] = rendered_name[:200]
    script.setdefault("name", default_name[:200])

    desc_template = str(config.get("workflow_description_template") or "").strip()
    if desc_template:
        rendered_desc = _render_template(desc_template, payload, extra).strip()
        if rendered_desc:
            script["description"] = rendered_desc[:5000]
    script.setdefault("description", default_description[:5000])

    script.setdefault("task_type", "server" if target_server else "code")

    notify_from_cfg = _build_notify_config_from_webhook_config(config)
    existing_notify = _normalize_notify_config(script.get("notify"))
    merged_notify: Dict[str, Any] = {}
    emails = _normalize_email_list((existing_notify.get("emails") or []) + (notify_from_cfg.get("emails") or []))
    if emails:
        merged_notify["emails"] = emails
    if "on_success" in existing_notify:
        merged_notify["on_success"] = existing_notify["on_success"]
    if "on_failure" in existing_notify:
        merged_notify["on_failure"] = existing_notify["on_failure"]
    if "on_success" in notify_from_cfg:
        merged_notify["on_success"] = notify_from_cfg["on_success"]
    if "on_failure" in notify_from_cfg:
        merged_notify["on_failure"] = notify_from_cfg["on_failure"]
    if merged_notify:
        script["notify"] = merged_notify

    return script


def _create_workflow_from_script(
    owner,
    task: Task,
    target_server: Optional[Server],
    script: Dict[str, Any],
    runtime: str,
):
    from pathlib import Path
    from django.conf import settings
    from agent_hub.models import AgentWorkflow
    from agent_hub.views import _start_workflow_run, _write_ralph_yml

    workflow = AgentWorkflow.objects.create(
        owner=owner,
        name=script.get("name", task.title[:80]),
        description=(script.get("description") or "")[:200],
        runtime=runtime,
        script=script,
        project_path="",
        target_server=target_server,
        task=task,
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
    run = _start_workflow_run(workflow, owner)
    task.ai_execution_status = "RUNNING"
    task.save(update_fields=["ai_execution_status"])
    return workflow, run


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
        config = _normalize_webhook_config(webhook.config or {})
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
                runtime_override = (
                    _normalize_runtime_name(config.get("runtime"), default="").strip()
                    or None
                )
                skill_ids_override = None
                if isinstance(config.get("skill_ids"), list):
                    skill_ids_override = config.get("skill_ids")
                elif custom_agent:
                    skill_ids_override = list(custom_agent.skills.values_list("id", flat=True))

                workflow_script_cfg = config.get("workflow_script")
                if isinstance(workflow_script_cfg, dict):
                    rendered_script_raw = _render_template_tree(workflow_script_cfg, payload, extra)
                    script = _normalize_workflow_script(rendered_script_raw)
                    if not script:
                        raise ValueError("workflow_script is invalid after template rendering")
                    runtime = _normalize_runtime_name(
                        runtime_override
                        or (script.get("runtime") if isinstance(script.get("runtime"), str) else "")
                        or (custom_agent.runtime if custom_agent else None)
                        or "cursor",
                        default="cursor",
                    )
                    script["runtime"] = runtime
                    script = _apply_workflow_script_overrides(
                        script=script,
                        config=config,
                        payload=payload,
                        extra=extra,
                        target_server=target_server,
                        default_name=f"Webhook workflow: {task.title[:60]}",
                        default_description=f"Webhook-driven workflow for task {task.id}",
                    )
                    if skill_ids_override and not script.get("skill_ids"):
                        script["skill_ids"] = skill_ids_override
                    verify_prompt = (config.get("verify_prompt") or "").strip()
                    if verify_prompt:
                        steps = script.get("steps") if isinstance(script.get("steps"), list) else []
                        if steps:
                            last_step = steps[-1]
                            if isinstance(last_step, dict) and not str(last_step.get("verify_prompt") or "").strip():
                                last_step["verify_prompt"] = verify_prompt
                                last_step["verify_promise"] = DEFAULT_VERIFY_PROMISE
                    _ensure_ralph_yml(script, runtime)
                    workflow, run = _create_workflow_from_script(
                        owner=webhook.owner,
                        task=task,
                        target_server=target_server,
                        script=script,
                        runtime=runtime,
                    )
                elif template_mode == "remediation":
                    runtime = _normalize_runtime_name(
                        runtime_override or (custom_agent.runtime if custom_agent else None) or "cursor",
                        default="cursor",
                    )
                    script = _build_remediation_script(
                        task=task,
                        payload=payload,
                        target_server=target_server,
                        runtime=runtime,
                        skill_ids=skill_ids_override,
                        verify_prompt=(config.get("verify_prompt") or "").strip() or None,
                    )
                    script = _apply_workflow_script_overrides(
                        script=script,
                        config=config,
                        payload=payload,
                        extra=extra,
                        target_server=target_server,
                        default_name=script.get("name", f"Remediation: {task.title[:60]}"),
                        default_description=script.get("description", f"Auto-remediation workflow for {task.title}"),
                    )
                    _ensure_ralph_yml(script, runtime)
                    workflow, run = _create_workflow_from_script(
                        owner=webhook.owner,
                        task=task,
                        target_server=target_server,
                        script=script,
                        runtime=runtime,
                    )
                else:
                    script_patch = _apply_workflow_script_overrides(
                        script={},
                        config=config,
                        payload=payload,
                        extra=extra,
                        target_server=target_server,
                        default_name=f"Webhook workflow: {task.title[:60]}",
                        default_description=f"Webhook-generated workflow for task {task.id}",
                    )
                    workflow, run = WorkflowService.create_from_task(
                        task,
                        webhook.owner,
                        runtime_override=runtime_override,
                        skill_ids_override=skill_ids_override,
                        extra_script_patch=script_patch,
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
                "custom_agent_name": hook.custom_agent.name if hook.custom_agent else "",
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
    if execution_mode == "workflow" and not custom_agent:
        return JsonResponse(
            {"success": False, "error": "custom_agent_id is required for workflow mode"},
            status=400,
        )

    hook = AgentWebhook.objects.create(
        owner=request.user,
        name=data.get("name", "New Webhook"),
        description=data.get("description", ""),
        source=data.get("source", "generic"),
        config=_normalize_webhook_config(data.get("config", {}) or {}),
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
                "custom_agent_name": hook.custom_agent.name if hook.custom_agent else "",
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
            hook.config = _normalize_webhook_config(data["config"] or {})
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
        if hook.execution_mode == "workflow" and not hook.custom_agent:
            return JsonResponse(
                {"success": False, "error": "custom_agent_id is required for workflow mode"},
                status=400,
            )

        hook.save()
        return JsonResponse({"success": True, "message": "Webhook updated"})

    hook.is_active = False
    hook.save(update_fields=["is_active"])
    return JsonResponse({"success": True, "message": "Webhook disabled"})
