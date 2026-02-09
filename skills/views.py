import json

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
from skills.models import Skill, SkillShare
from skills.services import SkillService


@login_required
@require_feature("agents", redirect_on_forbidden=True)
def skills_page(request):
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
