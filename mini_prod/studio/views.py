"""
Agent Studio REST API Views

All endpoints require authentication (session or token).
Base URL: /api/studio/

Endpoints:
  GET  /api/studio/pipelines/               — list pipelines
  POST /api/studio/pipelines/               — create pipeline
  GET  /api/studio/pipelines/<id>/          — get pipeline detail
  PUT  /api/studio/pipelines/<id>/          — update pipeline
  DELETE /api/studio/pipelines/<id>/        — delete pipeline
  POST /api/studio/pipelines/<id>/run/      — trigger manual run
  POST /api/studio/pipelines/<id>/clone/    — clone pipeline
  GET  /api/studio/pipelines/<id>/runs/     — list runs for pipeline

  GET  /api/studio/runs/                    — list all runs (user)
  GET  /api/studio/runs/<id>/              — get run detail
  POST /api/studio/runs/<id>/stop/         — stop running pipeline

  GET  /api/studio/agents/                  — list agent configs
  POST /api/studio/agents/                  — create agent config
  GET  /api/studio/agents/<id>/             — get agent config
  PUT  /api/studio/agents/<id>/             — update agent config
  DELETE /api/studio/agents/<id>/           — delete agent config
  GET  /api/studio/skills/                  — list available skill packs
  GET  /api/studio/skills/<slug>/           — get full skill pack detail
  GET  /api/studio/skills/templates/        — list built-in skill templates
  POST /api/studio/skills/scaffold/         — create a skill pack from UI/JSON payload
  POST /api/studio/skills/validate/         — validate skill packs

  GET  /api/studio/mcp/                     — list MCP server pool
  POST /api/studio/mcp/                     — add MCP server
  GET  /api/studio/mcp/<id>/               — get MCP server
  PUT  /api/studio/mcp/<id>/               — update MCP server
  DELETE /api/studio/mcp/<id>/             — delete MCP server
  POST /api/studio/mcp/<id>/test/          — test MCP connection
  GET  /api/studio/mcp/<id>/tools/         — inspect MCP tools
  GET  /api/studio/mcp/templates/           — list MCP templates

  GET  /api/studio/triggers/               — list triggers
  POST /api/studio/triggers/               — create trigger
  PUT  /api/studio/triggers/<id>/          — update trigger
  DELETE /api/studio/triggers/<id>/        — delete trigger
  POST /api/studio/triggers/<token>/receive/ — webhook endpoint (csrf_exempt)

  GET  /api/studio/templates/              — list pipeline templates
  POST /api/studio/templates/<slug>/use/   — instantiate template

  GET  /api/studio/servers/               — list accessible servers (for node config)
"""

import asyncio
import contextlib
import json
import os
import shutil
import threading
from pathlib import Path

from django.conf import settings as django_settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .mcp_client import MCPClientError, inspect_mcp_server
from .models import AgentConfig, MCPServerPool, Pipeline, PipelineRun, PipelineTemplate, PipelineTrigger
from .skill_authoring import parse_csv_items, scaffold_skill, validate_skill_dir, validate_skills
from .skill_registry import SkillNotFoundError, get_skill, list_skills, normalise_skill_slugs
from .skill_templates import get_skill_template, list_skill_templates

# ---------------------------------------------------------------------------
# Notification config helpers  (stored in BASE_DIR/.notification_config.json)
# ---------------------------------------------------------------------------

_NOTIF_CONFIG_PATH = Path(getattr(django_settings, "BASE_DIR", ".")) / ".notification_config.json"

_NOTIF_DEFAULTS = {
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "notify_email": "",
    "smtp_host": "",
    "smtp_port": "587",
    "smtp_user": "",
    "smtp_password": "",
    "from_email": "",
    "site_url": "",
}


def _load_notif_config() -> dict:
    """Read notification config from file; fall back to Django / env defaults."""
    base: dict = {
        "telegram_bot_token": os.getenv("TELEGRAM_BOT_TOKEN", "") or getattr(django_settings, "TELEGRAM_BOT_TOKEN", "") or "",
        "telegram_chat_id": os.getenv("TELEGRAM_CHAT_ID", "") or getattr(django_settings, "TELEGRAM_CHAT_ID", "") or "",
        "notify_email": (
            os.getenv("PIPELINE_NOTIFY_EMAIL", "")
            or getattr(django_settings, "PIPELINE_NOTIFY_EMAIL", "")
            or os.getenv("EMAIL_HOST_USER", "")
            or getattr(django_settings, "EMAIL_HOST_USER", "")
            or ""
        ),
        "smtp_host": getattr(django_settings, "EMAIL_HOST", "smtp.gmail.com") or "",
        "smtp_port": str(getattr(django_settings, "EMAIL_PORT", 587)),
        "smtp_user": getattr(django_settings, "EMAIL_HOST_USER", "") or "",
        "smtp_password": getattr(django_settings, "EMAIL_HOST_PASSWORD", "") or "",
        "from_email": getattr(django_settings, "DEFAULT_FROM_EMAIL", "") or "",
        "site_url": getattr(django_settings, "SITE_URL", "http://localhost:8000") or "http://localhost:8000",
    }
    if _NOTIF_CONFIG_PATH.exists():
        try:
            saved = json.loads(_NOTIF_CONFIG_PATH.read_text(encoding="utf-8"))
            for k, v in saved.items():
                if k in base and v:  # only override with non-empty saved values
                    base[k] = v
        except Exception:
            pass
    return base


def _save_notif_config(data: dict):
    """Persist notification config (only non-empty values)."""
    existing = {}
    if _NOTIF_CONFIG_PATH.exists():
        with contextlib.suppress(Exception):
            existing = json.loads(_NOTIF_CONFIG_PATH.read_text(encoding="utf-8"))
    for k in _NOTIF_DEFAULTS:
        if k in data:
            existing[k] = data[k]
    _NOTIF_CONFIG_PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")


def _resolve_from_email_smtp(from_email: str, smtp_user: str, smtp_host: str) -> str:
    """Use real mailbox as From when default is noreply@weuai.site or broken like noreply@login."""
    if not from_email or "weuai.site" in from_email or "noreply@" in (from_email or "").lower():
        if not smtp_user:
            return from_email or "pipeline@noreply.local"
        user = (smtp_user or "").strip()
        if "@" in user:
            return user
        host = (smtp_host or "").lower()
        if "yandex" in host:
            return f"{user}@yandex.ru"
        if "gmail" in host:
            return f"{user}@gmail.com"
        return user
    return from_email


def _normalize_email_recipient(to_email: str, smtp_host: str) -> str:
    """If recipient is only login (no @), append domain for Yandex/Gmail."""
    to_email = (to_email or "").strip()
    if not to_email or "@" in to_email:
        return to_email
    host = (smtp_host or "").lower()
    if "yandex" in host:
        return f"{to_email}@yandex.ru"
    if "gmail" in host:
        return f"{to_email}@gmail.com"
    return to_email


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _json_body(request) -> dict:
    try:
        return json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _err(msg: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"error": msg}, status=status)


def _ok(data, status: int = 200) -> JsonResponse:
    return JsonResponse(data, safe=False, status=status)


# ---------------------------------------------------------------------------
# Pipelines
# ---------------------------------------------------------------------------


@login_required
def api_pipelines(request):
    if request.method == "GET":
        qs = Pipeline.objects.filter(owner=request.user).order_by("-updated_at")
        search = request.GET.get("q", "").strip()
        if search:
            qs = qs.filter(name__icontains=search)
        return _ok([p.to_list_dict() for p in qs])

    if request.method == "POST":
        data = _json_body(request)
        name = data.get("name", "").strip()
        if not name:
            return _err("name is required")
        pipeline = Pipeline.objects.create(
            name=name,
            description=data.get("description", ""),
            icon=data.get("icon", "⚡"),
            tags=data.get("tags", []),
            nodes=data.get("nodes", []),
            edges=data.get("edges", []),
            owner=request.user,
        )
        pipeline.sync_triggers_from_nodes()
        return _ok(pipeline.to_detail_dict(), status=201)

    return _err("Method not allowed", 405)


@login_required
def api_pipeline_detail(request, pipeline_id: int):
    pipeline = _get_pipeline(request, pipeline_id)
    if pipeline is None:
        return _err("Pipeline not found", 404)

    if request.method == "GET":
        return _ok(pipeline.to_detail_dict())

    if request.method == "PUT":
        data = _json_body(request)
        for field in ("name", "description", "icon", "tags", "nodes", "edges", "is_shared"):
            if field in data:
                setattr(pipeline, field, data[field])
        pipeline.save()
        pipeline.sync_triggers_from_nodes()
        return _ok(pipeline.to_detail_dict())

    if request.method == "DELETE":
        pipeline.delete()
        return JsonResponse({"ok": True})

    return _err("Method not allowed", 405)


@login_required
@require_http_methods(["POST"])
def api_pipeline_run(request, pipeline_id: int):
    """Trigger a manual pipeline run."""
    pipeline = _get_pipeline(request, pipeline_id)
    if pipeline is None:
        return _err("Pipeline not found", 404)

    context = _json_body(request).get("context", {})
    run = PipelineRun.objects.create(
        pipeline=pipeline,
        triggered_by=request.user,
        status=PipelineRun.STATUS_PENDING,
        context=context,
        trigger_data={"source": "manual"},
    )
    _launch_pipeline_run_async(run)
    return _ok(run.to_dict(), status=202)


@login_required
@require_http_methods(["POST"])
def api_pipeline_clone(request, pipeline_id: int):
    pipeline = _get_pipeline(request, pipeline_id)
    if pipeline is None:
        return _err("Pipeline not found", 404)

    clone = Pipeline.objects.create(
        name=f"{pipeline.name} (copy)",
        description=pipeline.description,
        icon=pipeline.icon,
        tags=pipeline.tags,
        nodes=pipeline.nodes,
        edges=pipeline.edges,
        owner=request.user,
    )
    clone.sync_triggers_from_nodes()
    return _ok(clone.to_detail_dict(), status=201)


@login_required
def api_pipeline_runs(request, pipeline_id: int):
    pipeline = _get_pipeline(request, pipeline_id)
    if pipeline is None:
        return _err("Pipeline not found", 404)
    runs = pipeline.runs.order_by("-created_at")[:50]
    return _ok([r.to_dict() for r in runs])


def _get_pipeline(request, pipeline_id: int) -> Pipeline | None:
    try:
        return Pipeline.objects.get(pk=pipeline_id, owner=request.user)
    except Pipeline.DoesNotExist:
        return None


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


@login_required
def api_runs(request):
    qs = PipelineRun.objects.filter(triggered_by=request.user).order_by("-created_at")[:100]
    return _ok([r.to_dict() for r in qs])


@login_required
def api_run_detail(request, run_id: int):
    try:
        run = PipelineRun.objects.get(pk=run_id, triggered_by=request.user)
    except PipelineRun.DoesNotExist:
        return _err("Run not found", 404)
    return _ok(run.to_dict())


@login_required
@require_http_methods(["POST"])
def api_run_stop(request, run_id: int):
    try:
        run = PipelineRun.objects.get(pk=run_id, triggered_by=request.user)
    except PipelineRun.DoesNotExist:
        return _err("Run not found", 404)

    if run.status == PipelineRun.STATUS_RUNNING:
        run.status = PipelineRun.STATUS_STOPPED
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "finished_at"])
    return _ok({"ok": True})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def api_run_approve(request, run_id: int, node_id: str):
    """
    Public endpoint — authenticated only by the one-time token embedded in the URL.

    Approve:  GET /api/studio/runs/<id>/approve/<node_id>/?token=...&decision=approved
    Reject:   GET /api/studio/runs/<id>/approve/<node_id>/?token=...&decision=rejected
    Respond:  POST with JSON {"token": "...", "decision": "approved", "response_text": "..."}

    The human_approval node polls the DB for `approval_decision` to appear.
    """
    # Accept token/decision from query string (GET link in email) or JSON body (POST from bot)
    if request.method == "GET":
        token = request.GET.get("token", "")
        decision = request.GET.get("decision", "")
        response_text = request.GET.get("response", "")
    else:
        body = _json_body(request)
        token = body.get("token", "")
        decision = body.get("decision", "")
        response_text = body.get("response_text", "")

    if not token:
        return _err("token is required", 400)
    if decision not in ("approved", "rejected"):
        return _err("decision must be 'approved' or 'rejected'", 400)

    try:
        run = PipelineRun.objects.get(pk=run_id)
    except PipelineRun.DoesNotExist:
        return _err("Run not found", 404)

    node_state = run.node_states.get(node_id)
    if not node_state:
        return _err(f"Node '{node_id}' not found in run #{run_id}", 404)

    stored_token = node_state.get("approval_token", "")
    if not stored_token or stored_token != token:
        return _err("Invalid or expired token", 403)

    if node_state.get("approval_decision"):
        existing = node_state["approval_decision"]
        return _ok({"ok": True, "message": f"Already decided: {existing}"})

    # Record the decision — the polling loop in the executor will pick this up
    run.node_states[node_id] = {
        **node_state,
        "approval_decision": decision,
        "approval_response": response_text,
        "decided_at": timezone.now().isoformat(),
    }
    PipelineRun.objects.filter(pk=run_id).update(node_states=run.node_states)

    emoji = "✅" if decision == "approved" else "❌"
    html = (
        f"<html><body style='font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center'>"
        f"<h1>{emoji} {decision.capitalize()}</h1>"
        f"<p>Your decision for pipeline <strong>{run.pipeline.name}</strong> (run #{run_id}) "
        f"has been recorded.</p>"
        f"<p style='color:#888'>You can close this tab.</p>"
        f"</body></html>"
    )
    from django.http import HttpResponse

    return HttpResponse(html, content_type="text/html")


# ---------------------------------------------------------------------------
# Agent Configs
# ---------------------------------------------------------------------------


@login_required
def api_agents(request):
    if request.method == "GET":
        qs = AgentConfig.objects.filter(owner=request.user).order_by("-updated_at")
        return _ok([a.to_dict() for a in qs])

    if request.method == "POST":
        data = _json_body(request)
        name = data.get("name", "").strip()
        if not name:
            return _err("name is required")

        agent = AgentConfig.objects.create(
            name=name,
            description=data.get("description", ""),
            icon=data.get("icon", "🤖"),
            system_prompt=data.get("system_prompt", ""),
            instructions=data.get("instructions", ""),
            model=data.get("model", "gemini-2.0-flash-exp"),
            max_iterations=data.get("max_iterations", 10),
            allowed_tools=data.get("allowed_tools", []),
            skill_slugs=_normalise_skill_payload(
                data.get("skill_slugs") if "skill_slugs" in data else data.get("skills")
            ),
            owner=request.user,
        )
        _set_m2m(
            agent,
            "mcp_servers",
            _normalise_related_ids(data.get("mcp_server_ids") if "mcp_server_ids" in data else data.get("mcp_servers")),
            MCPServerPool,
        )
        from servers.models import Server

        _set_m2m(
            agent,
            "server_scope",
            _normalise_related_ids(data.get("server_scope_ids") if "server_scope_ids" in data else data.get("server_scope")),
            Server,
        )
        return _ok(agent.to_dict(), status=201)

    return _err("Method not allowed", 405)


@login_required
def api_agent_detail(request, agent_id: int):
    try:
        agent = AgentConfig.objects.get(pk=agent_id, owner=request.user)
    except AgentConfig.DoesNotExist:
        return _err("Agent config not found", 404)

    if request.method == "GET":
        return _ok(agent.to_dict())

    if request.method == "PUT":
        data = _json_body(request)
        for field in (
            "name",
            "description",
            "icon",
            "system_prompt",
            "instructions",
            "model",
            "max_iterations",
            "allowed_tools",
            "is_shared",
        ):
            if field in data:
                setattr(agent, field, data[field])
        if "skill_slugs" in data or "skills" in data:
            agent.skill_slugs = _normalise_skill_payload(
                data.get("skill_slugs") if "skill_slugs" in data else data.get("skills")
            )
        agent.save()
        if "mcp_server_ids" in data or "mcp_servers" in data:
            _set_m2m(
                agent,
                "mcp_servers",
                _normalise_related_ids(data.get("mcp_server_ids") if "mcp_server_ids" in data else data.get("mcp_servers")),
                MCPServerPool,
            )
        if "server_scope_ids" in data or "server_scope" in data:
            from servers.models import Server

            _set_m2m(
                agent,
                "server_scope",
                _normalise_related_ids(data.get("server_scope_ids") if "server_scope_ids" in data else data.get("server_scope")),
                Server,
            )
        return _ok(agent.to_dict())

    if request.method == "DELETE":
        agent.delete()
        return JsonResponse({"ok": True})

    return _err("Method not allowed", 405)


def _set_m2m(obj, attr: str, ids: list, model):
    if ids is not None:
        items = list(model.objects.filter(pk__in=ids))
        getattr(obj, attr).set(items)


def _normalise_related_ids(raw_values) -> list[int]:
    if raw_values is None or not isinstance(raw_values, list):
        return []

    ids: list[int] = []
    for item in raw_values:
        value = item.get("id") if isinstance(item, dict) else item
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return ids


def _normalise_skill_payload(raw_values) -> list[str]:
    return normalise_skill_slugs(raw_values)


def _normalise_string_list(raw_values) -> list[str]:
    return parse_csv_items(raw_values)


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------


@login_required
@require_http_methods(["GET"])
def api_skills(_request):
    return _ok([skill.to_summary_dict() for skill in list_skills()])


@login_required
@require_http_methods(["GET"])
def api_skill_detail(_request, slug: str):
    try:
        skill = get_skill(slug)
    except SkillNotFoundError:
        return _err("Skill not found", 404)
    return _ok(skill.to_detail_dict())


@login_required
@require_http_methods(["GET"])
def api_skill_templates(_request):
    return _ok([item.to_dict() for item in list_skill_templates()])


@login_required
@require_http_methods(["POST"])
def api_skill_scaffold(request):
    data = _json_body(request)
    template_slug = str(data.get("template_slug") or "").strip()
    template = get_skill_template(template_slug) if template_slug else None
    if template_slug and template is None:
        return _err("Unknown skill template")

    defaults = dict(template.defaults) if template else {}
    name = str(data.get("name") or defaults.get("name") or "").strip()
    description = str(data.get("description") or defaults.get("description") or "").strip()
    if not name:
        return _err("name is required")
    if not description:
        return _err("description is required")

    raw_runtime_policy = data.get("runtime_policy")
    if raw_runtime_policy not in (None, "") and not isinstance(raw_runtime_policy, dict):
        return _err("runtime_policy must be a JSON object")

    runtime_policy = dict(defaults.get("runtime_policy") or {})
    runtime_policy.update(dict(raw_runtime_policy or {}))

    try:
        skill_dir = scaffold_skill(
            name=name,
            description=description,
            slug=str(data.get("slug") or "").strip() or None,
            service=str(data.get("service") or defaults.get("service") or "").strip(),
            category=str(data.get("category") or defaults.get("category") or "").strip(),
            safety_level=str(data.get("safety_level") or defaults.get("safety_level") or "standard").strip() or "standard",
            ui_hint=str(data.get("ui_hint") or defaults.get("ui_hint") or "").strip(),
            tags=_normalise_string_list(data.get("tags") or defaults.get("tags")),
            guardrail_summary=_normalise_string_list(data.get("guardrail_summary") or defaults.get("guardrail_summary")),
            recommended_tools=_normalise_string_list(data.get("recommended_tools") or defaults.get("recommended_tools")),
            runtime_policy=runtime_policy,
            with_scripts=bool(data.get("with_scripts")),
            with_references=bool(data.get("with_references")),
            with_assets=bool(data.get("with_assets")),
            force=bool(data.get("force")),
        )
    except (ValueError, FileExistsError) as exc:
        return _err(str(exc))

    validation = validate_skill_dir(skill_dir)
    if validation.errors:
        shutil.rmtree(skill_dir, ignore_errors=True)
        return JsonResponse(
            {
                "error": "Skill scaffold did not pass validation",
                "validation": validation.to_dict(),
            },
            status=400,
        )

    try:
        skill = get_skill(skill_dir.name)
    except SkillNotFoundError:
        return _err("Skill was created but could not be loaded", 500)

    return _ok(
        {
            "ok": True,
            "skill": skill.to_detail_dict(),
            "validation": validation.to_dict(),
        },
        status=201,
    )


@login_required
@require_http_methods(["POST"])
def api_skill_validate(request):
    data = _json_body(request)
    slugs = _normalise_string_list(data.get("slugs"))
    strict = bool(data.get("strict"))
    results = validate_skills(slugs or None)

    if slugs:
        found = {item.slug.lower() for item in results}
        missing = [slug for slug in slugs if slug.lower() not in found]
        if missing:
            return _err(f"Skills not found: {', '.join(missing)}", 404)

    error_count = sum(len(item.errors) for item in results)
    warning_count = sum(len(item.warnings) for item in results)
    return _ok(
        {
            "results": [item.to_dict() for item in results],
            "summary": {
                "skills": len(results),
                "errors": error_count,
                "warnings": warning_count,
                "is_valid": error_count == 0 and (warning_count == 0 if strict else True),
                "strict": strict,
            },
        }
    )


# ---------------------------------------------------------------------------
# MCP Server Pool
# ---------------------------------------------------------------------------

KEYCLOAK_TEMPLATE_URL = os.getenv("STUDIO_KEYCLOAK_MCP_URL", "http://127.0.0.1:8766/mcp")


MCP_TEMPLATES = [
    {
        "slug": "github",
        "name": "GitHub",
        "description": "GitHub repository management via MCP",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": ""},
        "icon": "🐙",
    },
    {
        "slug": "filesystem",
        "name": "Filesystem",
        "description": "Read/write local filesystem via MCP",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"],
        "env": {},
        "icon": "📁",
    },
    {
        "slug": "kubernetes",
        "name": "Kubernetes",
        "description": "Manage Kubernetes clusters via kubectl MCP",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-kubernetes"],
        "env": {"KUBECONFIG": "~/.kube/config"},
        "icon": "☸️",
    },
    {
        "slug": "docker",
        "name": "Docker",
        "description": "Manage Docker containers and images",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-docker"],
        "env": {},
        "icon": "🐳",
    },
    {
        "slug": "postgres",
        "name": "PostgreSQL",
        "description": "Query and manage PostgreSQL databases",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": {"POSTGRES_CONNECTION_STRING": "postgresql://user:pass@localhost/db"},
        "icon": "🐘",
    },
    {
        "slug": "slack",
        "name": "Slack",
        "description": "Send notifications and interact with Slack",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-slack"],
        "env": {"SLACK_BOT_TOKEN": "", "SLACK_TEAM_ID": ""},
        "icon": "💬",
    },
    {
        "slug": "custom_python",
        "name": "Custom Python MCP",
        "description": "Your own Python MCP server",
        "transport": "stdio",
        "command": "python",
        "args": ["path/to/your_mcp_server.py"],
        "env": {},
        "icon": "🐍",
    },
    {
        "slug": "keycloak_admin",
        "name": "Keycloak Admin",
        "description": "Manage Keycloak users, roles, clients, and groups via the project's Docker-friendly HTTP MCP",
        "transport": "sse",
        "command": "",
        "args": [],
        "env": {},
        "url": KEYCLOAK_TEMPLATE_URL,
        "icon": "🔐",
    },
]


@login_required
def api_mcp_list(request):
    if request.method == "GET":
        qs = MCPServerPool.objects.filter(owner=request.user).order_by("name")
        return _ok([_mcp_to_dict(m) for m in qs])

    if request.method == "POST":
        data = _json_body(request)
        name = data.get("name", "").strip()
        if not name:
            return _err("name is required")
        transport = data.get("transport", MCPServerPool.TRANSPORT_STDIO)
        url = (data.get("url") or "").strip()
        if transport == MCPServerPool.TRANSPORT_SSE and url:
            url = _normalize_sse_url(url)
        mcp = MCPServerPool.objects.create(
            name=name,
            description=data.get("description", ""),
            transport=transport,
            command=data.get("command", ""),
            args=data.get("args", []),
            env=data.get("env", {}),
            url=url,
            owner=request.user,
        )
        return _ok(_mcp_to_dict(mcp), status=201)

    return _err("Method not allowed", 405)


@login_required
def api_mcp_detail(request, mcp_id: int):
    try:
        mcp = MCPServerPool.objects.get(pk=mcp_id, owner=request.user)
    except MCPServerPool.DoesNotExist:
        return _err("MCP server not found", 404)

    if request.method == "GET":
        return _ok(_mcp_to_dict(mcp))

    if request.method == "PUT":
        data = _json_body(request)
        for field in ("name", "description", "transport", "command", "args", "env", "url", "is_shared"):
            if field in data:
                val = data[field]
                if field == "url" and (mcp.transport or data.get("transport")) == MCPServerPool.TRANSPORT_SSE and val:
                    val = _normalize_sse_url((val or "").strip())
                setattr(mcp, field, val)
        mcp.save()
        return _ok(_mcp_to_dict(mcp))

    if request.method == "DELETE":
        mcp.delete()
        return JsonResponse({"ok": True})

    return _err("Method not allowed", 405)


@login_required
@require_http_methods(["POST"])
def api_mcp_test(request, mcp_id: int):
    try:
        mcp = MCPServerPool.objects.get(pk=mcp_id, owner=request.user)
    except MCPServerPool.DoesNotExist:
        return _err("MCP server not found", 404)

    ok, error = _test_mcp_connection(mcp)
    mcp.last_test_ok = ok
    mcp.last_test_at = timezone.now()
    mcp.last_test_error = error or ""
    mcp.save(update_fields=["last_test_ok", "last_test_at", "last_test_error"])
    return _ok({"ok": ok, "error": error})


def _normalize_sse_url(url: str) -> str:
    """Ensure SSE URL has http:// or https:// so httpx/requests accept it."""
    u = (url or "").strip()
    if not u:
        return u
    if u.startswith(("http://", "https://")):
        return u
    return "http://" + u


def _test_mcp_connection(mcp: MCPServerPool) -> tuple[bool, str | None]:
    """Basic connectivity test for MCP server."""
    import subprocess

    if mcp.transport == MCPServerPool.TRANSPORT_SSE:
        url = _normalize_sse_url(mcp.url or "")
        if not url:
            return False, "SSE URL is required"
        try:
            import httpx

            httpx.get(url, timeout=10)
            return True, None
        except Exception as exc:
            return False, str(exc)

    # stdio: try to start process and check it exits cleanly (or stays alive)
    if not mcp.command:
        return False, "No command configured"
    try:
        env = {**__import__("os").environ, **mcp.env}
        proc = subprocess.Popen(
            [mcp.command] + (mcp.args or []),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        try:
            out, err = proc.communicate(timeout=5)
            return True, None
        except subprocess.TimeoutExpired:
            proc.kill()
            # Process stayed alive — likely a valid long-running MCP server
            return True, None
    except FileNotFoundError:
        return False, f"Command not found: {mcp.command}"
    except Exception as exc:
        return False, str(exc)


@login_required
def api_mcp_templates(request):
    return _ok(MCP_TEMPLATES)


@login_required
@require_http_methods(["GET"])
def api_mcp_tools(request, mcp_id: int):
    try:
        mcp = MCPServerPool.objects.get(pk=mcp_id, owner=request.user)
    except MCPServerPool.DoesNotExist:
        return _err("MCP server not found", 404)

    try:
        return _ok(asyncio.run(inspect_mcp_server(mcp)))
    except MCPClientError as exc:
        return _err(str(exc), 400)
    except Exception as exc:
        return _err(f"Failed to inspect MCP server: {exc}", 500)


def _mcp_to_dict(mcp: MCPServerPool) -> dict:
    return {
        "id": mcp.pk,
        "name": mcp.name,
        "description": mcp.description,
        "transport": mcp.transport,
        "command": mcp.command,
        "args": mcp.args,
        "env": mcp.env,
        "url": mcp.url,
        "is_shared": mcp.is_shared,
        "last_test_ok": mcp.last_test_ok,
        "last_test_at": mcp.last_test_at.isoformat() if mcp.last_test_at else None,
        "last_test_error": mcp.last_test_error,
    }


# ---------------------------------------------------------------------------
# Triggers
# ---------------------------------------------------------------------------


@login_required
def api_triggers(request):
    if request.method == "GET":
        pipeline_id = request.GET.get("pipeline_id")
        qs = PipelineTrigger.objects.filter(pipeline__owner=request.user)
        if pipeline_id:
            qs = qs.filter(pipeline_id=pipeline_id)
        return _ok([t.to_dict() for t in qs])

    if request.method == "POST":
        data = _json_body(request)
        pipeline_id = data.get("pipeline_id")
        if not pipeline_id:
            return _err("pipeline_id is required")
        pipeline = _get_pipeline(request, int(pipeline_id))
        if pipeline is None:
            return _err("Pipeline not found", 404)

        trigger = PipelineTrigger.objects.create(
            pipeline=pipeline,
            node_id=data.get("node_id", ""),
            name=data.get("name", ""),
            trigger_type=data.get("trigger_type", PipelineTrigger.TYPE_MANUAL),
            is_active=data.get("is_active", True),
            cron_expression=data.get("cron_expression", ""),
            webhook_payload_map=data.get("webhook_payload_map", {}),
        )
        return _ok(trigger.to_dict(), status=201)

    return _err("Method not allowed", 405)


@login_required
def api_trigger_detail(request, trigger_id: int):
    try:
        trigger = PipelineTrigger.objects.get(pk=trigger_id, pipeline__owner=request.user)
    except PipelineTrigger.DoesNotExist:
        return _err("Trigger not found", 404)

    if request.method == "PUT":
        data = _json_body(request)
        for field in ("node_id", "name", "trigger_type", "is_active", "cron_expression", "webhook_payload_map"):
            if field in data:
                setattr(trigger, field, data[field])
        trigger.save()
        return _ok(trigger.to_dict())

    if request.method == "DELETE":
        trigger.delete()
        return JsonResponse({"ok": True})

    return _err("Method not allowed", 405)


@csrf_exempt
@require_http_methods(["POST"])
def api_trigger_receive(request, token: str):
    """Public webhook endpoint — authenticated by token in URL."""
    try:
        trigger = PipelineTrigger.objects.select_related("pipeline").get(
            webhook_token=token,
            trigger_type=PipelineTrigger.TYPE_WEBHOOK,
            is_active=True,
        )
    except PipelineTrigger.DoesNotExist:
        return _err("Invalid token", 404)

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = {}

    context = _map_payload(payload, trigger.webhook_payload_map)

    run = PipelineRun.objects.create(
        pipeline=trigger.pipeline,
        trigger=trigger,
        status=PipelineRun.STATUS_PENDING,
        trigger_data=payload,
        context=context,
    )
    trigger.last_triggered_at = timezone.now()
    trigger.save(update_fields=["last_triggered_at"])

    _launch_pipeline_run_async(run)
    return _ok({"ok": True, "run_id": run.pk})


def _map_payload(payload: dict, mapping: dict) -> dict:
    """Map incoming webhook payload to pipeline context variables."""
    if not mapping:
        return dict(payload)
    ctx = {}
    for ctx_key, payload_path in mapping.items():
        parts = payload_path.split(".")
        val = payload
        for p in parts:
            if isinstance(val, dict):
                val = val.get(p)
            else:
                val = None
                break
        ctx[ctx_key] = val
    return ctx


# ---------------------------------------------------------------------------
# Pipeline Templates
# ---------------------------------------------------------------------------


@login_required
def api_templates(request):
    templates = PipelineTemplate.objects.all().order_by("category", "name")
    return _ok([t.to_dict() for t in templates])


@login_required
@require_http_methods(["POST"])
def api_template_use(request, slug: str):
    try:
        template = PipelineTemplate.objects.get(slug=slug)
    except PipelineTemplate.DoesNotExist:
        return _err("Template not found", 404)
    pipeline = template.instantiate_for_user(request.user)
    pipeline.sync_triggers_from_nodes()
    return _ok(pipeline.to_detail_dict(), status=201)


# ---------------------------------------------------------------------------
# Servers (for node config dropdowns)
# ---------------------------------------------------------------------------


@login_required
def api_studio_servers(request):
    from servers.models import Server

    servers = Server.objects.filter(user=request.user).order_by("name")
    return _ok([{"id": s.pk, "name": s.name, "host": s.host} for s in servers])


# ---------------------------------------------------------------------------
# Notification settings
# ---------------------------------------------------------------------------


@login_required
def api_notification_settings(request):
    """
    GET  /api/studio/notifications/  — return current notification settings
    POST /api/studio/notifications/  — save notification settings
    """
    if request.method == "GET":
        cfg = _load_notif_config()
        # Mask password in GET response
        masked = dict(cfg)
        if masked.get("smtp_password"):
            masked["smtp_password"] = "••••••••"
        if masked.get("telegram_bot_token") and len(masked["telegram_bot_token"]) > 10:
            tok = masked["telegram_bot_token"]
            masked["telegram_bot_token"] = tok[:8] + "•" * (len(tok) - 8)
        return _ok(masked)

    if request.method == "POST":
        data = _json_body(request)
        allowed = set(_NOTIF_DEFAULTS.keys())
        to_save = {k: v for k, v in data.items() if k in allowed}
        # Don't overwrite password with mask placeholder
        if to_save.get("smtp_password", "").startswith("•"):
            existing = _load_notif_config()
            to_save["smtp_password"] = existing.get("smtp_password", "")
        if to_save.get("telegram_bot_token", "").endswith("•" * 4):
            existing = _load_notif_config()
            to_save["telegram_bot_token"] = existing.get("telegram_bot_token", "")
        _save_notif_config(to_save)
        return _ok({"ok": True, "saved": list(to_save.keys())})

    return _err("Method not allowed", 405)


@login_required
@require_http_methods(["POST"])
def api_notification_test_telegram(request):
    """POST /api/studio/notifications/test-telegram/ — send a test Telegram message."""
    import asyncio

    cfg = _load_notif_config()
    bot_token = cfg.get("telegram_bot_token", "").strip()
    chat_id = cfg.get("telegram_chat_id", "").strip()

    if not bot_token or not chat_id:
        return _err("Telegram bot_token and chat_id must be configured first.")

    async def _send():
        import httpx

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": "✅ *WEU Platform* — Telegram notifications are working correctly!",
                    "parse_mode": "Markdown",
                },
            )
            return resp.status_code, resp.text[:300]

    try:
        code, body = asyncio.run(_send())
        if code == 200:
            return _ok({"ok": True, "message": f"Test message sent to chat {chat_id}"})
        return _err(f"Telegram API returned {code}: {body}")
    except Exception as exc:
        return _err(f"Send failed: {exc}")


@login_required
@require_http_methods(["POST"])
def api_notification_test_email(request):
    """POST /api/studio/notifications/test-email/ — send a test email."""
    import smtplib
    from email.mime.text import MIMEText

    cfg = _load_notif_config()
    to_email = cfg.get("notify_email", "").strip()
    smtp_host = cfg.get("smtp_host", "").strip() or getattr(django_settings, "EMAIL_HOST", "smtp.gmail.com")
    smtp_port = int(cfg.get("smtp_port") or getattr(django_settings, "EMAIL_PORT", 587))
    smtp_user = cfg.get("smtp_user", "").strip() or getattr(django_settings, "EMAIL_HOST_USER", "")
    smtp_password = cfg.get("smtp_password", "").strip() or getattr(django_settings, "EMAIL_HOST_PASSWORD", "")
    from_email = cfg.get("from_email", "").strip() or smtp_user or getattr(django_settings, "DEFAULT_FROM_EMAIL", "") or "pipeline@noreply.local"
    from_email = _resolve_from_email_smtp(from_email, smtp_user, smtp_host)

    # Recipient must be a full email; if user entered only login (e.g. germane.keller), add domain
    to_email = _normalize_email_recipient(to_email, smtp_host)

    if not to_email:
        return _err("notify_email is not configured.")
    if not smtp_user:
        return _err("smtp_user (email login) is not configured.")

    try:
        msg = MIMEText("✅ WEU Platform — Email notifications are working correctly!", "plain", "utf-8")
        msg["Subject"] = "WEU Platform — Test Email"
        msg["From"] = from_email
        msg["To"] = to_email

        # Port 465 = SSL from the start (Yandex); 587 = STARTTLS
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as server:
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.sendmail(from_email, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                server.ehlo()
                if smtp_port == 587:
                    server.starttls()
                    server.ehlo()
                if smtp_user and smtp_password:
                    server.login(smtp_user, smtp_password)
                server.sendmail(from_email, [to_email], msg.as_string())

        return _ok({"ok": True, "message": f"Test email sent to {to_email}"})
    except Exception as exc:
        return _err(f"SMTP error: {exc}")


# ---------------------------------------------------------------------------
# Background run launcher
# ---------------------------------------------------------------------------


def _launch_pipeline_run_async(run: PipelineRun):
    """Launch pipeline execution in a background thread (Django dev server)."""

    run_pk = run.pk

    def _run_in_thread():
        async def _main():
            from asgiref.sync import sync_to_async

            from studio.pipeline_executor import PipelineExecutor

            run_obj = await sync_to_async(
                lambda: PipelineRun.objects.select_related("pipeline", "triggered_by").get(pk=run_pk)
            )()
            executor = PipelineExecutor(run_obj)
            await executor.execute(context=run_obj.context)

        asyncio.run(_main())

    thread = threading.Thread(target=_run_in_thread, daemon=True)
    thread.start()
