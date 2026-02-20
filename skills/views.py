import json
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

from django.contrib.auth.models import User
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils.text import slugify
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core_ui.context_processors import user_can_feature
from core_ui.decorators import require_feature
from django.contrib.auth.decorators import login_required

from skills.assistant import SkillAssistantError, run_skill_assistant
from skills.models import Skill, SkillShare, UserMCPServer
from skills.services import SkillService


@login_required
@require_feature("agents", redirect_on_forbidden=True)
def skills_page(request):
    # Pre-load data to avoid empty page on first render
    skills_qs = (
        Skill.objects.filter(is_active=True)
        .filter(SkillService._base_scope_filter(request.user))
        .distinct()
        .order_by("owner_id", "name")
    )
    skills_list = []
    for s in skills_qs:
        skills_list.append({
            "id": s.id,
            "name": s.name,
            "slug": s.slug,
            "description": s.description,
            "status": s.status,
            "version": s.version,
            "owner_id": s.owner_id,
            "owner_username": s.owner.username if s.owner else None,
            "is_owner": s.owner_id == request.user.id,
            "source_type": s.source_type,
            "auto_apply_chat": s.auto_apply_chat,
            "auto_apply_agents": s.auto_apply_agents,
            "auto_apply_workflows": s.auto_apply_workflows,
            "tags": s.tags,
            "allowed_runtimes": s.allowed_runtimes,
            "updated_at": s.updated_at.isoformat(),
        })

    mcp_pool = list(
        UserMCPServer.objects.filter(user=request.user)
        .order_by("-updated_at")
        .values("id", "name", "command", "args", "env", "description", "source_url")
    )

    mcp_catalog = _load_mcp_catalog()
    skill_catalog = _load_skill_catalog()

    agents_list = []
    try:
        from agent_hub.models import CustomAgent
        for a in CustomAgent.objects.filter(owner=request.user, is_active=True).order_by("-updated_at"):
            agents_list.append({
                "id": a.id,
                "name": a.name,
                "runtime": a.runtime,
                "skill_ids": list(a.skills.values_list("id", flat=True)),
                "mcp_names": list((a.mcp_servers or {}).keys()),
            })
    except Exception:
        pass

    servers_list = []
    try:
        if user_can_feature(request.user, "servers"):
            from servers.models import Server
            for srv in Server.objects.filter(user=request.user, is_active=True).select_related("group").order_by("name"):
                servers_list.append({
                    "id": srv.id,
                    "name": srv.name,
                    "host": srv.host,
                    "group": srv.group.name if srv.group else None,
                })
    except Exception:
        pass

    context = {
        "skills_json": json.dumps(skills_list, default=str, ensure_ascii=False),
        "mcp_pool_json": json.dumps(mcp_pool, default=str, ensure_ascii=False),
        "mcp_catalog_json": json.dumps(mcp_catalog, default=str, ensure_ascii=False),
        "skill_catalog_json": json.dumps(skill_catalog, default=str, ensure_ascii=False),
        "agents_json": json.dumps(agents_list, default=str, ensure_ascii=False),
        "servers_json": json.dumps(servers_list, default=str, ensure_ascii=False),
        "skills_count": len(skills_list),
        "mcp_pool_count": len(mcp_pool),
        "agents_count": len(agents_list),
    }
    return render(request, "skills/hub.html", context)


@login_required
@require_feature("agents", redirect_on_forbidden=True)
def skills_page_legacy(request):
    """Полная страница Skills без табов (fallback)."""
    return render(request, "skills/index.html", {})




@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET", "POST"])
def api_skills_list_create(request):
    if request.method == "GET":
        skills = (
            Skill.objects.filter(is_active=True)
            .filter(SkillService._base_scope_filter(request.user))
            .distinct()
            .order_by("owner_id", "name")
        )

        payload = [
            {
                "id": s.id,
                "name": s.name,
                "slug": s.slug,
                "description": s.description,
                "status": s.status,
                "version": s.version,
                "owner_id": s.owner_id,
                "owner_username": s.owner.username if s.owner else None,
                "is_owner": s.owner_id == request.user.id,
                "can_edit": SkillService.can_edit_skill(request.user, s),
                "can_manage": SkillService.can_manage_skill(request.user, s),
                "source_type": s.source_type,
                "source_url": s.source_url,
                "source_ref": s.source_ref,
                "source_path": s.source_path,
                "auto_sync_enabled": s.auto_sync_enabled,
                "sync_interval_minutes": s.sync_interval_minutes,
                "last_synced_at": s.last_synced_at.isoformat() if s.last_synced_at else None,
                "last_sync_error": s.last_sync_error,
                "auto_apply_chat": s.auto_apply_chat,
                "auto_apply_agents": s.auto_apply_agents,
                "auto_apply_workflows": s.auto_apply_workflows,
                "allowed_runtimes": s.allowed_runtimes,
                "server_scope_all": s.server_scope_all,
                "server_scope_ids": s.server_scope_ids,
                "tags": s.tags,
                "updated_at": s.updated_at.isoformat(),
            }
            for s in skills
        ]
        return JsonResponse({"success": True, "skills": payload})

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    name = (data.get("name") or "").strip()
    if not name:
        return JsonResponse({"success": False, "error": "name is required"}, status=400)

    slug = (data.get("slug") or slugify(name)).strip()
    if not slug:
        return JsonResponse({"success": False, "error": "slug is required"}, status=400)

    server_scope_all = bool(data.get("server_scope_all", True))
    server_scope_ids = _normalize_server_ids(
        request.user,
        data.get("server_scope_ids") if isinstance(data.get("server_scope_ids"), list) else [],
    )
    if server_scope_all:
        server_scope_ids = []

    skill = Skill.objects.create(
        owner=request.user,
        name=name,
        slug=slug,
        description=(data.get("description") or "").strip(),
        status=(data.get("status") or Skill.STATUS_DRAFT).strip(),
        system_prompt=(data.get("system_prompt") or "").strip(),
        instructions=(data.get("instructions") or "").strip(),
        rules=(data.get("rules") or "").strip(),
        references=_normalize_references(data.get("references")),
        variables=data.get("variables") if isinstance(data.get("variables"), dict) else {},
        tags=data.get("tags") if isinstance(data.get("tags"), list) else [],
        allowed_runtimes=data.get("allowed_runtimes") if isinstance(data.get("allowed_runtimes"), list) else [],
        server_scope_all=server_scope_all,
        server_scope_ids=server_scope_ids,
        auto_apply_chat=bool(data.get("auto_apply_chat")),
        auto_apply_agents=bool(data.get("auto_apply_agents")),
        auto_apply_workflows=bool(data.get("auto_apply_workflows")),
        source_type=(data.get("source_type") or Skill.SOURCE_MANUAL).strip(),
        source_url=(data.get("source_url") or "").strip(),
        source_ref=(data.get("source_ref") or "main").strip(),
        source_path=(data.get("source_path") or "SKILL.md").strip(),
        auto_sync_enabled=bool(data.get("auto_sync_enabled")),
        sync_interval_minutes=int(data.get("sync_interval_minutes") or 60),
    )
    return JsonResponse({"success": True, "skill_id": skill.id})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET", "PUT", "DELETE"])
def api_skill_detail(request, skill_id: int):
    skill = _get_skill_for_user(request.user, skill_id)

    if request.method == "GET":
        return JsonResponse(
            {
                "success": True,
                "skill": {
                    "id": skill.id,
                    "name": skill.name,
                    "slug": skill.slug,
                    "description": skill.description,
                    "status": skill.status,
                    "version": skill.version,
                    "owner_id": skill.owner_id,
                    "owner_username": skill.owner.username if skill.owner else None,
                    "is_owner": skill.owner_id == request.user.id,
                    "can_edit": SkillService.can_edit_skill(request.user, skill),
                    "can_manage": SkillService.can_manage_skill(request.user, skill),
                    "system_prompt": skill.system_prompt,
                    "instructions": skill.instructions,
                    "rules": skill.rules,
                    "references": skill.references,
                    "variables": skill.variables,
                    "tags": skill.tags,
                    "allowed_runtimes": skill.allowed_runtimes,
                    "server_scope_all": skill.server_scope_all,
                    "server_scope_ids": skill.server_scope_ids,
                    "auto_apply_chat": skill.auto_apply_chat,
                    "auto_apply_agents": skill.auto_apply_agents,
                    "auto_apply_workflows": skill.auto_apply_workflows,
                    "source_type": skill.source_type,
                    "source_url": skill.source_url,
                    "source_ref": skill.source_ref,
                    "source_path": skill.source_path,
                    "auto_sync_enabled": skill.auto_sync_enabled,
                    "sync_interval_minutes": skill.sync_interval_minutes,
                    "last_synced_at": skill.last_synced_at.isoformat() if skill.last_synced_at else None,
                    "last_sync_error": skill.last_sync_error,
                    "is_active": skill.is_active,
                },
            }
        )

    if request.method == "DELETE":
        if not SkillService.can_manage_skill(request.user, skill):
            return JsonResponse({"success": False, "error": "No permission to delete this skill"}, status=403)
        skill.is_active = False
        skill.save(update_fields=["is_active", "updated_at"])
        return JsonResponse({"success": True})

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    if not SkillService.can_edit_skill(request.user, skill):
        return JsonResponse({"success": False, "error": "No permission to edit this skill"}, status=403)

    editable = {
        "name",
        "slug",
        "description",
        "status",
        "system_prompt",
        "instructions",
        "rules",
        "references",
        "variables",
        "tags",
        "allowed_runtimes",
        "server_scope_all",
        "server_scope_ids",
        "auto_apply_chat",
        "auto_apply_agents",
        "auto_apply_workflows",
        "source_type",
        "source_url",
        "source_ref",
        "source_path",
        "auto_sync_enabled",
        "sync_interval_minutes",
        "is_active",
    }

    for key, value in data.items():
        if key not in editable:
            continue
        if key == "references":
            setattr(skill, key, _normalize_references(value))
            continue
        if key == "variables":
            setattr(skill, key, value if isinstance(value, dict) else {})
            continue
        if key in {"tags", "allowed_runtimes"}:
            setattr(skill, key, value if isinstance(value, list) else [])
            continue
        if key == "server_scope_ids":
            setattr(skill, key, _normalize_server_ids(request.user, value if isinstance(value, list) else []))
            continue
        setattr(skill, key, value)

    if data.get("server_scope_all") is True:
        skill.server_scope_ids = []

    skill.save()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_skill_sync(request, skill_id: int):
    skill = _get_skill_for_user(request.user, skill_id)
    if not SkillService.can_manage_skill(request.user, skill):
        return JsonResponse({"success": False, "error": "No permission to sync this skill"}, status=403)

    result = SkillService.sync_skill(skill, triggered_by=f"user:{request.user.id}")
    status = 200 if result.get("success") else 500
    return JsonResponse(result, status=status)


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_skill_context_preview(request):
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    channel = (data.get("channel") or "chat").strip().lower()
    runtime = (data.get("runtime") or "").strip().lower() or None
    skill_ids = data.get("skill_ids") if isinstance(data.get("skill_ids"), list) else None

    ctx = SkillService.build_skill_context(
        user=request.user,
        skill_ids=skill_ids,
        channel=channel,
        runtime=runtime,
        include_references=bool(data.get("include_references", True)),
    )
    return JsonResponse(
        {
            "success": True,
            "skill_ids": ctx["skill_ids"],
            "skill_names": ctx["skill_names"],
            "text": ctx["text"],
        }
    )


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET"])
def api_skill_options(request):
    skills = Skill.objects.filter(SkillService._base_scope_filter(request.user), is_active=True).order_by(
        "owner_id", "name"
    )
    payload = [{"id": s.id, "name": s.name, "slug": s.slug, "version": s.version} for s in skills]
    return JsonResponse({"success": True, "skills": payload})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET"])
def api_skill_servers(request):
    if not user_can_feature(request.user, "servers"):
        return JsonResponse({"success": True, "servers": []})
    try:
        from servers.models import Server
    except Exception:
        return JsonResponse({"success": True, "servers": []})

    servers = (
        Server.objects.filter(user=request.user, is_active=True)
        .select_related("group")
        .order_by("name")
    )
    payload = [
        {
            "id": s.id,
            "name": s.name,
            "host": s.host,
            "group": s.group.name if s.group else None,
            "tags": s.tags,
        }
        for s in servers
    ]
    return JsonResponse({"success": True, "servers": payload})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_skill_assistant(request):
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    mode = (payload.get("mode") or "draft").strip().lower()
    if mode not in {"draft", "questions"}:
        mode = "draft"

    goal = (payload.get("goal") or "").strip()
    data_blob = (payload.get("data") or payload.get("context") or "").strip()
    answers = (payload.get("answers") or "").strip()
    existing_skill = payload.get("existing_skill") if isinstance(payload.get("existing_skill"), dict) else {}
    raw_server_ids = payload.get("server_ids") if isinstance(payload.get("server_ids"), list) else []
    raw_server_names = payload.get("server_names") if isinstance(payload.get("server_names"), list) else []
    if isinstance(payload.get("servers"), str):
        raw_server_names.extend([s.strip() for s in payload.get("servers").split(",")])

    server_ids: list[int] = []
    for raw in raw_server_ids:
        try:
            sid = int(raw)
        except (TypeError, ValueError):
            continue
        if sid > 0 and sid not in server_ids:
            server_ids.append(sid)

    server_names: list[str] = []
    for raw in raw_server_names:
        name = str(raw or "").strip()
        if name and name not in server_names:
            server_names.append(name)

    try:
        result = run_skill_assistant(
            user=request.user,
            mode=mode,
            goal=goal,
            data=data_blob,
            answers=answers,
            existing_skill=existing_skill,
            server_ids=server_ids,
            server_names=server_names,
        )
    except SkillAssistantError as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=400)
    except Exception:
        return JsonResponse({"success": False, "error": "Skill assistant failed"}, status=500)

    return JsonResponse({"success": True, **result})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET", "POST"])
def api_skill_shares(request, skill_id: int):
    skill = _get_skill_for_user(request.user, skill_id)

    if request.method == "GET":
        if not SkillService.can_view_skill(request.user, skill):
            return JsonResponse({"success": False, "error": "Forbidden"}, status=403)
        shares = (
            SkillShare.objects.filter(skill=skill)
            .select_related("shared_with", "shared_by")
            .order_by("-updated_at")
        )
        payload = [
            {
                "id": s.id,
                "username": s.shared_with.username,
                "user_id": s.shared_with_id,
                "can_edit": s.can_edit,
                "can_manage": s.can_manage,
                "shared_by": s.shared_by.username if s.shared_by else None,
                "updated_at": s.updated_at.isoformat(),
            }
            for s in shares
        ]
        return JsonResponse({"success": True, "shares": payload})

    if not SkillService.can_manage_skill(request.user, skill):
        return JsonResponse({"success": False, "error": "No permission to manage sharing"}, status=403)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    username = (data.get("username") or "").strip()
    if not username:
        return JsonResponse({"success": False, "error": "username is required"}, status=400)

    target_user = User.objects.filter(username=username).first()
    if not target_user:
        return JsonResponse({"success": False, "error": "User not found"}, status=404)
    if target_user.id == skill.owner_id:
        return JsonResponse({"success": False, "error": "Owner already has full access"}, status=400)

    share, _created = SkillShare.objects.update_or_create(
        skill=skill,
        shared_with=target_user,
        defaults={
            "shared_by": request.user,
            "can_edit": bool(data.get("can_edit")),
            "can_manage": bool(data.get("can_manage")),
        },
    )
    return JsonResponse({"success": True, "share_id": share.id})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["DELETE"])
def api_skill_share_delete(request, skill_id: int, share_id: int):
    skill = _get_skill_for_user(request.user, skill_id)
    if not SkillService.can_manage_skill(request.user, skill):
        return JsonResponse({"success": False, "error": "No permission to manage sharing"}, status=403)
    share = get_object_or_404(SkillShare, id=share_id, skill=skill)
    share.delete()
    return JsonResponse({"success": True})


# --- MCP pool (Мои MCP) API ---


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET", "POST"])
def api_mcp_pool_list_create(request):
    """Список «Моих MCP» и создание новой записи."""
    if request.method == "GET":
        servers = (
            UserMCPServer.objects.filter(user=request.user)
            .order_by("-updated_at")
        )
        payload = [
            {
                "id": s.id,
                "name": s.name,
                "command": s.command,
                "args": s.args,
                "env": s.env,
                "description": s.description,
                "source_url": s.source_url,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat(),
            }
            for s in servers
        ]
        return JsonResponse({"success": True, "servers": payload})

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    name = (data.get("name") or "").strip()
    if not name:
        return JsonResponse({"success": False, "error": "name is required"}, status=400)
    if UserMCPServer.objects.filter(user=request.user, name=name).exists():
        return JsonResponse({"success": False, "error": f"MCP with name '{name}' already exists"}, status=400)

    command = (data.get("command") or "").strip()
    if not command:
        return JsonResponse({"success": False, "error": "command is required"}, status=400)

    args = data.get("args")
    if not isinstance(args, list):
        args = []
    env = data.get("env")
    if not isinstance(env, dict):
        env = {}

    server = UserMCPServer.objects.create(
        user=request.user,
        name=name,
        command=command,
        args=args,
        env=env,
        description=(data.get("description") or "").strip(),
        source_url=(data.get("source_url") or "").strip(),
    )
    return JsonResponse({
        "success": True,
        "server": {
            "id": server.id,
            "name": server.name,
            "command": server.command,
            "args": server.args,
            "env": server.env,
            "description": server.description,
            "source_url": server.source_url,
            "created_at": server.created_at.isoformat(),
            "updated_at": server.updated_at.isoformat(),
        },
    })


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET", "PUT", "DELETE"])
def api_mcp_pool_detail(request, server_id: int):
    server = get_object_or_404(UserMCPServer, id=server_id, user=request.user)

    if request.method == "GET":
        return JsonResponse({
            "success": True,
            "server": {
                "id": server.id,
                "name": server.name,
                "command": server.command,
                "args": server.args,
                "env": server.env,
                "description": server.description,
                "source_url": server.source_url,
                "created_at": server.created_at.isoformat(),
                "updated_at": server.updated_at.isoformat(),
            },
        })

    if request.method == "DELETE":
        server.delete()
        return JsonResponse({"success": True})

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    if data.get("name") is not None:
        name = (data.get("name") or "").strip()
        if name and name != server.name:
            if UserMCPServer.objects.filter(user=request.user, name=name).exists():
                return JsonResponse({"success": False, "error": f"MCP with name '{name}' already exists"}, status=400)
            server.name = name
    if data.get("command") is not None:
        server.command = (data.get("command") or "").strip()
    if "args" in data:
        server.args = data["args"] if isinstance(data["args"], list) else []
    if "env" in data:
        server.env = data["env"] if isinstance(data["env"], dict) else {}
    if "description" in data:
        server.description = (data.get("description") or "").strip()
    if "source_url" in data:
        server.source_url = (data.get("source_url") or "").strip()
    server.save()
    return JsonResponse({
        "success": True,
        "server": {
            "id": server.id,
            "name": server.name,
            "command": server.command,
            "args": server.args,
            "env": server.env,
            "description": server.description,
            "source_url": server.source_url,
            "created_at": server.created_at.isoformat(),
            "updated_at": server.updated_at.isoformat(),
        },
    })


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_mcp_pool_add_to_agent(request, server_id: int):
    """Добавить MCP из пула в агента (CustomAgent)."""
    server = get_object_or_404(UserMCPServer, id=server_id, user=request.user)
    try:
        from agent_hub.models import CustomAgent
    except ImportError:
        return JsonResponse({"success": False, "error": "CustomAgent not available"}, status=500)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    agent_id = data.get("agent_id")
    if agent_id is None:
        return JsonResponse({"success": False, "error": "agent_id is required"}, status=400)
    try:
        agent_id = int(agent_id)
    except (TypeError, ValueError):
        return JsonResponse({"success": False, "error": "agent_id must be integer"}, status=400)

    agent = CustomAgent.objects.filter(owner=request.user, id=agent_id).first()
    if not agent:
        return JsonResponse({"success": False, "error": "Agent not found"}, status=404)

    mcp_servers = dict(agent.mcp_servers or {})
    config = server.to_agent_config()
    mcp_servers[server.name] = config
    agent.mcp_servers = mcp_servers
    agent.save()
    return JsonResponse({"success": True, "message": f"MCP '{server.name}' добавлен в агента"})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_mcp_pool_test(request, server_id: int):
    """
    Проверить работоспособность MCP-сервера из пула.
    Для local/stdio: запускаем процесс и шлём MCP JSON-RPC initialize + tools/list.
    Для remote/HTTP: делаем GET запрос на source_url.
    Возвращает {success, status, message, tools, latency_ms, detail}.
    """
    import subprocess
    import time

    server = get_object_or_404(UserMCPServer, id=server_id, user=request.user)

    command = (server.command or "").strip()
    source_url = (server.source_url or "").strip()
    args = server.args or []
    env_vars = server.env or {}

    # Определяем тип: remote/HTTP или local/stdio
    is_remote = (not command) or source_url.startswith("http")

    t0 = time.monotonic()

    if is_remote:
        # --- Remote/HTTP тест ---
        url = source_url or command
        if not url or not url.startswith("http"):
            return JsonResponse({
                "success": False,
                "status": "error",
                "message": "Нет URL для проверки. Укажи source_url (http://...)",
                "tools": [],
                "latency_ms": 0,
                "detail": "",
            })
        try:
            import urllib.request as _ur
            req = _ur.Request(url, headers={"User-Agent": "WEU-MCP-Test/1.0"})
            with _ur.urlopen(req, timeout=5) as resp:
                status_code = resp.status
            latency_ms = int((time.monotonic() - t0) * 1000)
            if status_code < 400:
                return JsonResponse({
                    "success": True,
                    "status": "ok",
                    "message": f"Сервер доступен (HTTP {status_code})",
                    "tools": [],
                    "latency_ms": latency_ms,
                    "detail": "",
                })
            else:
                return JsonResponse({
                    "success": False,
                    "status": "error",
                    "message": f"Сервер вернул HTTP {status_code}",
                    "tools": [],
                    "latency_ms": latency_ms,
                    "detail": "",
                })
        except Exception as e:
            latency_ms = int((time.monotonic() - t0) * 1000)
            return JsonResponse({
                "success": False,
                "status": "error",
                "message": f"Недоступен: {e}",
                "tools": [],
                "latency_ms": latency_ms,
                "detail": str(e),
            })

    # --- Local/stdio тест ---
    cmd_list = [command] + [str(a) for a in args]

    # Строим окружение с переменными MCP
    import os
    proc_env = dict(os.environ)
    for k, v in env_vars.items():
        if v and str(v).strip():
            proc_env[k] = str(v)

    # MCP JSON-RPC сообщения
    initialize_msg = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "weu-test", "version": "1.0"},
        },
    }) + "\n"
    initialized_notification = json.dumps({
        "jsonrpc": "2.0", "method": "notifications/initialized",
    }) + "\n"
    tools_list_msg = json.dumps({
        "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
    }) + "\n"

    try:
        proc = subprocess.Popen(
            cmd_list,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=proc_env,
        )
    except FileNotFoundError:
        latency_ms = int((time.monotonic() - t0) * 1000)
        return JsonResponse({
            "success": False,
            "status": "error",
            "message": f"Команда не найдена: {command}",
            "tools": [],
            "latency_ms": latency_ms,
            "detail": f"FileNotFoundError: {command}",
        })
    except PermissionError as e:
        latency_ms = int((time.monotonic() - t0) * 1000)
        return JsonResponse({
            "success": False,
            "status": "error",
            "message": f"Нет прав на запуск: {command}",
            "tools": [],
            "latency_ms": latency_ms,
            "detail": str(e),
        })
    except Exception as e:
        latency_ms = int((time.monotonic() - t0) * 1000)
        return JsonResponse({
            "success": False,
            "status": "error",
            "message": f"Не удалось запустить: {e}",
            "tools": [],
            "latency_ms": latency_ms,
            "detail": str(e),
        })

    try:
        # Отправляем initialize → initialized → tools/list
        stdin_data = initialize_msg.encode() + initialized_notification.encode() + tools_list_msg.encode()
        stdout_data, stderr_data = proc.communicate(input=stdin_data, timeout=8)
        latency_ms = int((time.monotonic() - t0) * 1000)

        # Парсим ответы — ищем tools/list response (id=2)
        tools = []
        error_detail = ""
        for line in stdout_data.decode(errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                if msg.get("id") == 2 and "result" in msg:
                    raw_tools = msg["result"].get("tools", [])
                    tools = [t.get("name", "") for t in raw_tools if t.get("name")]
                elif "error" in msg and msg.get("id") == 2:
                    error_detail = str(msg["error"])
            except json.JSONDecodeError:
                pass

        if proc.returncode != 0 and not tools:
            stderr_text = stderr_data.decode(errors="replace")[:500]
            return JsonResponse({
                "success": False,
                "status": "error",
                "message": f"Процесс завершился с кодом {proc.returncode}",
                "tools": [],
                "latency_ms": latency_ms,
                "detail": stderr_text or error_detail,
            })

        if error_detail and not tools:
            return JsonResponse({
                "success": False,
                "status": "error",
                "message": "MCP вернул ошибку",
                "tools": [],
                "latency_ms": latency_ms,
                "detail": error_detail,
            })

        n = len(tools)
        msg_text = f"Работает — {n} {'инструмент' if n == 1 else 'инструментов' if 2 <= n <= 4 else 'инструментов'}"
        if tools:
            msg_text += f": {', '.join(tools[:5])}"
            if n > 5:
                msg_text += f" и ещё {n - 5}"
        else:
            msg_text = "Процесс запустился (инструменты не обнаружены)"

        return JsonResponse({
            "success": True,
            "status": "ok",
            "message": msg_text,
            "tools": tools,
            "latency_ms": latency_ms,
            "detail": "",
        })

    except subprocess.TimeoutExpired:
        proc.kill()
        latency_ms = int((time.monotonic() - t0) * 1000)
        return JsonResponse({
            "success": False,
            "status": "timeout",
            "message": "Сервер не ответил за 8 секунд",
            "tools": [],
            "latency_ms": latency_ms,
            "detail": "TimeoutExpired",
        })
    except Exception as e:
        latency_ms = int((time.monotonic() - t0) * 1000)
        try:
            proc.kill()
        except Exception:
            pass
        return JsonResponse({
            "success": False,
            "status": "error",
            "message": f"Ошибка теста: {e}",
            "tools": [],
            "latency_ms": latency_ms,
            "detail": str(e),
        })


def _load_skill_catalog() -> list:
    """Загрузить встроенный каталог Skills из skills/skill_catalog.json."""
    path = Path(__file__).resolve().parent / "skill_catalog.json"
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET"])
def api_skill_catalog_list(request):
    """Список записей каталога Skills (встроенный JSON)."""
    catalog = _load_skill_catalog()
    return JsonResponse({"success": True, "catalog": catalog})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_skill_catalog_install(request):
    """
    Установить Skill из каталога или по URL.
    Body: catalog_id (из каталога) ИЛИ source_url (+ опционально source_ref, source_path).
    Создаёт Skill с owner=user, source_type=git, выполняет sync.
    """
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    source_url = (data.get("source_url") or "").strip()
    source_ref = (data.get("source_ref") or "main").strip()
    source_path = (data.get("source_path") or "SKILL.md").strip()
    name = (data.get("name") or "").strip()
    slug = (data.get("slug") or "").strip()
    description = (data.get("description") or "").strip()

    if not source_url:
        catalog_id = (data.get("catalog_id") or data.get("id") or "").strip()
        if not catalog_id:
            return JsonResponse({"success": False, "error": "catalog_id or source_url is required"}, status=400)
        catalog = _load_skill_catalog()
        catalog_by_id = {str(item.get("id") or item.get("slug")): item for item in catalog if item.get("id") or item.get("slug")}
        entry = catalog_by_id.get(catalog_id)
        if not entry:
            return JsonResponse({"success": False, "error": f"Catalog entry '{catalog_id}' not found"}, status=404)
        source_url = (entry.get("source_url") or "").strip()
        source_ref = (entry.get("source_ref") or "main").strip()
        source_path = (entry.get("source_path") or "SKILL.md").strip()
        name = (entry.get("name") or "").strip()
        slug = (entry.get("slug") or entry.get("id") or "").strip()
        description = (entry.get("description") or "").strip()

    if not source_url:
        return JsonResponse({"success": False, "error": "source_url is required"}, status=400)

    if not slug:
        slug = slugify(name) if name else slugify(Path(source_url).stem)
    if not name:
        name = slug.replace("-", " ").title()

    if Skill.objects.filter(owner=request.user, slug=slug).exists():
        return JsonResponse({"success": False, "error": f"Skill with slug '{slug}' already exists"}, status=400)

    skill = Skill.objects.create(
        owner=request.user,
        name=name or slug,
        slug=slug,
        description=description,
        status=Skill.STATUS_DRAFT,
        source_type=Skill.SOURCE_GIT,
        source_url=source_url,
        source_ref=source_ref,
        source_path=source_path,
    )
    result = SkillService.sync_skill(skill, triggered_by="catalog_install")
    if not result.get("success"):
        return JsonResponse({
            "success": True,
            "skill_id": skill.id,
            "message": f"Skill создан, но sync не удался: {result.get('message', result)}",
        })
    return JsonResponse({"success": True, "skill_id": skill.id, "message": "Установлено"})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_skill_catalog_install_all(request):
    """
    Установить все Skills из встроенного каталога. Без дубликатов по slug.
    """
    catalog = _load_skill_catalog()
    installed_count = 0
    for entry in catalog:
        source_url = (entry.get("source_url") or "").strip()
        if not source_url:
            continue
        slug = (entry.get("slug") or entry.get("id") or "").strip()
        if not slug:
            slug = slugify(entry.get("name") or "skill")
        if Skill.objects.filter(owner=request.user, slug=slug).exists():
            continue
        name = (entry.get("name") or slug.replace("-", " ").title()).strip()
        source_ref = (entry.get("source_ref") or "main").strip()
        source_path = (entry.get("source_path") or "SKILL.md").strip()
        description = (entry.get("description") or "").strip()
        skill = Skill.objects.create(
            owner=request.user,
            name=name or slug,
            slug=slug,
            description=description,
            status=Skill.STATUS_DRAFT,
            source_type=Skill.SOURCE_GIT,
            source_url=source_url,
            source_ref=source_ref,
            source_path=source_path,
        )
        SkillService.sync_skill(skill, triggered_by="catalog_install_all")
        installed_count += 1
    return JsonResponse({
        "success": True,
        "installed_count": installed_count,
        "message": f"Установлено скиллов: {installed_count}",
    })


def _load_mcp_catalog() -> list:
    """Загрузить встроенный каталог MCP из skills/mcp_catalog.json."""
    path = Path(__file__).resolve().parent / "mcp_catalog.json"
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET"])
def api_mcp_catalog_list(request):
    """Список записей каталога MCP (встроенный JSON). Опционально ?q= — фильтр по name, description, tags."""
    catalog = _load_mcp_catalog()
    q = (request.GET.get("q") or "").strip().lower()
    if q:
        filtered = []
        for item in catalog:
            name = (item.get("name") or item.get("id") or "").lower()
            desc = (item.get("description") or "").lower()
            tags = item.get("tags") or []
            tags_str = " ".join(t if isinstance(t, str) else str(t) for t in tags).lower()
            if q in name or q in desc or q in tags_str:
                filtered.append(item)
        catalog = filtered
    return JsonResponse({"success": True, "catalog": catalog})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_mcp_catalog_install(request):
    """
    Установить MCP из каталога: в «Мои MCP» и/или в агента.
    Body: catalog_id (id из каталога), add_to_pool (bool), agent_id (int, optional).
    """
    catalog = _load_mcp_catalog()
    catalog_by_id = {item.get("id") or item.get("name"): item for item in catalog if item.get("id") or item.get("name")}

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    catalog_id = (data.get("catalog_id") or data.get("id") or "").strip()
    _entry_data = data.get("_entry")
    entry = catalog_by_id.get(catalog_id) if catalog_id else None
    if not entry and isinstance(_entry_data, dict):
        entry = _entry_data
        catalog_id = (entry.get("id") or entry.get("name") or "").strip()
    if not catalog_id:
        return JsonResponse({"success": False, "error": "catalog_id or _entry is required"}, status=400)
    if not entry:
        return JsonResponse({"success": False, "error": f"Catalog entry '{catalog_id}' not found"}, status=404)

    name = (entry.get("name") or entry.get("id") or catalog_id).strip()
    command = (entry.get("command") or "").strip()
    if not command:
        return JsonResponse({"success": False, "error": "Catalog entry has no command"}, status=400)
    args = entry.get("args")
    if not isinstance(args, list):
        args = []
    env = entry.get("env")
    if not isinstance(env, dict):
        env = {}
    description = (entry.get("description") or "").strip()
    source_url = (entry.get("source_url") or "").strip()

    add_to_pool = bool(data.get("add_to_pool"))
    agent_id = data.get("agent_id")

    messages = []

    if add_to_pool:
        server, created = UserMCPServer.objects.update_or_create(
            user=request.user,
            name=name,
            defaults={
                "command": command,
                "args": args,
                "env": env,
                "description": description,
                "source_url": source_url,
            },
        )
        messages.append("Добавлено в Мои MCP" if created else "Обновлено в Мои MCP")

    if agent_id is not None:
        try:
            from agent_hub.models import CustomAgent
        except ImportError:
            return JsonResponse({"success": False, "error": "CustomAgent not available"}, status=500)
        try:
            agent_id = int(agent_id)
        except (TypeError, ValueError):
            return JsonResponse({"success": False, "error": "agent_id must be integer"}, status=400)
        agent = CustomAgent.objects.filter(owner=request.user, id=agent_id).first()
        if not agent:
            return JsonResponse({"success": False, "error": "Agent not found"}, status=404)
        mcp_servers = dict(agent.mcp_servers or {})
        mcp_servers[name] = {
            "enabled": True,
            "command": command,
            "args": args,
            "description": description,
        }
        if env:
            mcp_servers[name]["env"] = env
        agent.mcp_servers = mcp_servers
        agent.save()
        messages.append(f"Добавлено в агента «{agent.name}»")

    if not add_to_pool and agent_id is None:
        return JsonResponse({"success": False, "error": "Set add_to_pool and/or agent_id"}, status=400)

    return JsonResponse({"success": True, "message": "; ".join(messages)})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_mcp_catalog_install_all(request):
    """
    Установить все MCP из встроенного каталога: в «Мои MCP» и/или в агента.
    Body: add_to_pool (bool), agent_id (int, optional).
    """
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    add_to_pool = bool(data.get("add_to_pool"))
    agent_id = data.get("agent_id")
    if not add_to_pool and not agent_id:
        return JsonResponse({"success": False, "error": "Set add_to_pool and/or agent_id"}, status=400)

    catalog = _load_mcp_catalog()
    installed_count = 0
    for item in catalog:
        name = (item.get("name") or item.get("id") or "").strip()
        if not name:
            continue
        command = (item.get("command") or "").strip()
        if not command:
            continue
        args = item.get("args") if isinstance(item.get("args"), list) else []
        env = item.get("env") if isinstance(item.get("env"), dict) else {}
        description = (item.get("description") or "").strip()
        source_url = (item.get("source_url") or "").strip()

        if add_to_pool:
            UserMCPServer.objects.update_or_create(
                user=request.user,
                name=name,
                defaults={
                    "command": command,
                    "args": args,
                    "env": env,
                    "description": description,
                    "source_url": source_url,
                },
            )

        if agent_id is not None:
            try:
                from agent_hub.models import CustomAgent
            except ImportError:
                pass
            else:
                try:
                    aid = int(agent_id)
                except (TypeError, ValueError):
                    pass
                else:
                    agent = CustomAgent.objects.filter(owner=request.user, id=aid).first()
                    if agent:
                        mcp_servers = dict(agent.mcp_servers or {})
                        mcp_servers[name] = {
                            "enabled": True,
                            "command": command,
                            "args": args,
                            "description": description,
                        }
                        if env:
                            mcp_servers[name]["env"] = env
                        agent.mcp_servers = mcp_servers
                        agent.save()
        if add_to_pool or agent_id:
            installed_count += 1
    return JsonResponse({
        "success": True,
        "installed_count": installed_count,
        "message": f"Установлено записей: {installed_count}",
    })


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_mcp_catalog_fetch(request):
    """
    Загрузить каталог MCP по URL. Body: url (строка).
    Возвращает catalog (массив объектов), не сохраняет в БД.
    """
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    url = (data.get("url") or "").strip()
    if not url:
        return JsonResponse({"success": False, "error": "url is required"}, status=400)

    if not url.startswith(("http://", "https://")):
        return JsonResponse({"success": False, "error": "Invalid URL scheme"}, status=400)

    try:
        req = Request(url, headers={"User-Agent": "WEU-Skills-Hub/1.0"})
        with urlopen(req, timeout=15) as resp:
            raw = resp.read()
            if len(raw) > 1024 * 1024:
                return JsonResponse({"success": False, "error": "Response too large (max 1MB)"}, status=400)
            data = json.loads(raw.decode("utf-8", errors="replace"))
    except (URLError, HTTPError, OSError) as e:
        return JsonResponse({"success": False, "error": str(e)}, status=400)
    except json.JSONDecodeError as e:
        return JsonResponse({"success": False, "error": f"Invalid JSON: {e}"}, status=400)

    if not isinstance(data, list):
        return JsonResponse({"success": False, "error": "Expected JSON array"}, status=400)

    # Normalize to catalog format: id/name, command, args, env, description
    catalog = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or item.get("id") or f"item-{i}").strip()
        command = (item.get("command") or "").strip()
        if not command:
            continue
        catalog.append({
            "id": name,
            "name": name,
            "command": command,
            "args": item.get("args") if isinstance(item.get("args"), list) else [],
            "env": item.get("env") if isinstance(item.get("env"), dict) else {},
            "description": (item.get("description") or "").strip(),
            "source_url": (item.get("source_url") or "").strip(),
        })
    return JsonResponse({"success": True, "catalog": catalog})


MCP_REGISTRY_BASE = "https://registry.modelcontextprotocol.io"

# Источники для блока «Реестр MCP»: выбор откуда показывать список
MCP_SOURCES = [
    {"id": "registry", "name": "Официальный реестр MCP", "type": "registry"},
    {"id": "local", "name": "Локальный каталог", "type": "catalog"},
    {"id": "external", "name": "Внешний каталог по URL", "type": "json_url"},
]


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET"])
def api_mcp_sources_list(request):
    """Список источников для реестра MCP (для выбора в UI)."""
    return JsonResponse({"success": True, "sources": MCP_SOURCES})


def _registry_server_to_catalog_entry(server: dict) -> dict | None:
    """Преобразовать один сервер из MCP Registry API в запись нашего каталога."""
    name = (server.get("name") or "").strip()
    if not name:
        return None
    title = (server.get("title") or name).strip()
    description = (server.get("description") or "").strip()
    packages = server.get("packages") or []
    if not packages:
        return {
            "id": name,
            "name": title or name,
            "command": "npx",
            "args": [],
            "env": {},
            "description": description,
            "source_url": "https://registry.modelcontextprotocol.io",
        }
    pkg = packages[0] if isinstance(packages[0], dict) else {}
    registry_type = (pkg.get("registryType") or "").lower()
    identifier = (pkg.get("identifier") or "").strip()
    version = (pkg.get("version") or "").strip()
    runtime_hint = (pkg.get("runtimeHint") or "").lower()
    runtime_args = pkg.get("runtimeArguments")
    if isinstance(runtime_args, list):
        args = [str(a) if not isinstance(a, dict) else (a.get("value") or a.get("id") or "") for a in runtime_args]
        args = [a for a in args if a]
    else:
        args = []

    env = {}
    for ev in pkg.get("environmentVariables") or []:
        if isinstance(ev, dict):
            key = ev.get("key") or ev.get("name")
            if key:
                env[key] = ev.get("value") or ""

    if registry_type == "npm":
        command = runtime_hint or "npx"
        if command == "npx":
            if not args:
                args = ["-y", f"{identifier}@{version}"] if version else ["-y", identifier]
            elif args and args[0] != "-y":
                args = ["-y"] + args
        else:
            if not args:
                args = [f"{identifier}@{version}"] if version else [identifier]
    elif registry_type == "pypi":
        command = runtime_hint or "uvx"
        if not args:
            args = [f"{identifier}=={version}"] if version else [identifier]
    elif registry_type == "oci":
        command = "docker"
        if not args:
            args = ["run", "-i", "--rm", identifier] if identifier else []
    else:
        command = runtime_hint or "npx"
        if not args and identifier:
            args = [f"{identifier}@{version}"] if version else [identifier]

    return {
        "id": name,
        "name": title or name,
        "command": command,
        "args": args,
        "env": env,
        "description": description,
        "source_url": "https://registry.modelcontextprotocol.io",
    }


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_mcp_catalog_fetch_registry(request):
    """
    Загрузить каталог MCP из официального MCP Registry (registry.modelcontextprotocol.io).
    Без параметров или body. Возвращает catalog в формате нашего каталога.
    """
    try:
        list_url = f"{MCP_REGISTRY_BASE}/v0.1/servers?limit=100"
        req = Request(list_url, headers={"User-Agent": "WEU-Skills-Hub/1.0", "Accept": "application/json"})
        with urlopen(req, timeout=20) as resp:
            raw = resp.read()
            if len(raw) > 5 * 1024 * 1024:
                return JsonResponse({"success": False, "error": "Registry response too large"}, status=400)
            data = json.loads(raw.decode("utf-8", errors="replace"))
    except (URLError, HTTPError, OSError) as e:
        return JsonResponse({"success": False, "error": str(e)}, status=400)
    except json.JSONDecodeError as e:
        return JsonResponse({"success": False, "error": f"Invalid JSON: {e}"}, status=400)

    servers = data.get("servers") if isinstance(data, dict) else None
    if not isinstance(servers, list):
        return JsonResponse({"success": False, "error": "Registry did not return servers array"}, status=400)

    catalog = []
    for item in servers:
        if not isinstance(item, dict):
            continue
        s = item.get("server") or item
        if not isinstance(s, dict):
            continue
        entry = _registry_server_to_catalog_entry(s)
        if entry:
            catalog.append(entry)

    return JsonResponse({"success": True, "catalog": catalog})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["GET"])
def api_mcp_registry_search(request):
    """
    Прокси к официальному MCP Registry (registry.modelcontextprotocol.io).
    Поддерживает поиск (q → search в API реестра), пагинацию через cursor.
    GET ?q=search&cursor=...&limit=48
    Возвращает { servers: [...], next_cursor, count }.
    """
    from urllib.request import Request as URLRequest, urlopen
    from urllib.error import URLError, HTTPError
    import urllib.parse

    q = (request.GET.get("q") or "").strip()
    cursor = (request.GET.get("cursor") or "").strip()
    try:
        limit = min(int(request.GET.get("limit", 48)), 100)
    except (TypeError, ValueError):
        limit = 48

    params: dict[str, str] = {"limit": str(limit), "version": "latest"}
    if q:
        params["search"] = q  # Official Registry API uses "search" (substring by name)
    if cursor:
        params["cursor"] = cursor

    qs = urllib.parse.urlencode(params)
    url = f"{MCP_REGISTRY_BASE}/v0.1/servers?{qs}"

    try:
        req = URLRequest(url, headers={"User-Agent": "WEU-Skills-Hub/1.0", "Accept": "application/json"})
        with urlopen(req, timeout=20) as resp:
            raw = resp.read()
            if len(raw) > 10 * 1024 * 1024:
                return JsonResponse({"success": False, "error": "Registry response too large"}, status=400)
            data = json.loads(raw.decode("utf-8", errors="replace"))
    except (URLError, HTTPError, OSError) as e:
        return JsonResponse({"success": False, "error": str(e)}, status=502)
    except json.JSONDecodeError as e:
        return JsonResponse({"success": False, "error": f"Invalid JSON: {e}"}, status=502)

    raw_servers = data.get("servers") if isinstance(data, dict) else None
    if not isinstance(raw_servers, list):
        return JsonResponse({"success": False, "error": "Registry did not return servers array"}, status=502)

    metadata = data.get("metadata") or {}
    next_cursor = metadata.get("nextCursor") or metadata.get("next_cursor") or ""

    # Normalize each server entry for the UI
    result = []
    for item in raw_servers:
        if not isinstance(item, dict):
            continue
        s = item.get("server") or item
        if not isinstance(s, dict):
            continue
        meta_official = (item.get("_meta") or {}).get("io.modelcontextprotocol.registry/official") or {}

        name = (s.get("name") or "").strip()
        title = (s.get("title") or name).strip()
        description = (s.get("description") or "").strip()
        version = (s.get("version") or "").strip()
        repo_url = ((s.get("repository") or {}).get("url") or "").strip()
        website_url = (s.get("websiteUrl") or "").strip()
        icons = s.get("icons") or []
        icon_url = ""
        if icons and isinstance(icons, list):
            icon_url = (icons[0].get("src") or "") if isinstance(icons[0], dict) else ""

        # Determine install type
        packages = s.get("packages") or []
        remotes = s.get("remotes") or []
        install_type = "remote" if remotes and not packages else ("local" if packages else "unknown")

        # Build catalog entry (same format as our catalog)
        catalog_entry = _registry_server_to_catalog_entry(s)

        result.append({
            "id": name,
            "name": name,
            "title": title,
            "description": description,
            "version": version,
            "repo_url": repo_url,
            "website_url": website_url,
            "icon_url": icon_url,
            "install_type": install_type,
            "status": meta_official.get("status", "active"),
            "updated_at": meta_official.get("updatedAt", ""),
            # catalog_entry fields for install
            "command": (catalog_entry or {}).get("command", ""),
            "args": (catalog_entry or {}).get("args", []),
            "env": (catalog_entry or {}).get("env", {}),
        })

    return JsonResponse({
        "success": True,
        "servers": result,
        "next_cursor": next_cursor,
        "count": len(result),
    })


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST", "DELETE"])
def api_skill_bind_agent(request, skill_id: int):
    """Привязать/отвязать skill к агенту через M2M."""
    skill = _get_skill_for_user(request.user, skill_id)
    try:
        from agent_hub.models import CustomAgent
    except ImportError:
        return JsonResponse({"success": False, "error": "CustomAgent not available"}, status=500)

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    agent_id = data.get("agent_id")
    if agent_id is None:
        return JsonResponse({"success": False, "error": "agent_id is required"}, status=400)
    try:
        agent_id = int(agent_id)
    except (TypeError, ValueError):
        return JsonResponse({"success": False, "error": "agent_id must be integer"}, status=400)

    agent = CustomAgent.objects.filter(owner=request.user, id=agent_id).first()
    if not agent:
        return JsonResponse({"success": False, "error": "Agent not found"}, status=404)

    if request.method == "DELETE":
        agent.skills.remove(skill)
        return JsonResponse({"success": True, "message": f"Skill '{skill.name}' отвязан от агента '{agent.name}'"})

    agent.skills.add(skill)
    return JsonResponse({"success": True, "message": f"Skill '{skill.name}' привязан к агенту '{agent.name}'"})


@csrf_exempt
@login_required
@require_feature("agents")
@require_http_methods(["POST"])
def api_mcp_generator(request):
    """Сгенерировать MCP-сервер с помощью ИИ."""
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    message = (data.get("message") or "").strip()
    documentation = (data.get("documentation") or "").strip()
    history = data.get("history") if isinstance(data.get("history"), list) else []

    if not message:
        return JsonResponse({"success": False, "error": "message is required"}, status=400)

    try:
        from skills.mcp_generator import generate_mcp_server
        result = generate_mcp_server(
            user_message=message,
            conversation_history=history,
            documentation=documentation,
        )
    except Exception as exc:
        return JsonResponse({"success": False, "error": str(exc)}, status=500)

    return JsonResponse({"success": True, **result})


def _get_skill_for_user(user, skill_id: int) -> Skill:
    return get_object_or_404(
        Skill.objects.filter(id=skill_id).filter(SkillService._base_scope_filter(user)).distinct()
    )


def _normalize_references(value):
    if not isinstance(value, list):
        return []
    normalized = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        content = str(item.get("content") or "").strip()
        if not title and not content:
            continue
        normalized.append({"title": title, "content": content})
    return normalized


def _normalize_server_ids(user, raw_ids):
    if not raw_ids or not user_can_feature(user, "servers"):
        return []
    try:
        from servers.models import Server
    except Exception:
        return []
    ids = []
    for raw in raw_ids:
        try:
            sid = int(raw)
        except (TypeError, ValueError):
            continue
        if sid > 0 and sid not in ids:
            ids.append(sid)
    if not ids:
        return []
    valid = set(Server.objects.filter(user=user, id__in=ids).values_list("id", flat=True))
    return [sid for sid in ids if sid in valid]
