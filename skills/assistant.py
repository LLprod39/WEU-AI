import json
import os
from typing import Any, Dict, Tuple

import httpx
from django.conf import settings
from django.db.models import Q
from django.utils.text import slugify
from loguru import logger


DEFAULT_MODEL = "gpt-5.2"
DEFAULT_BASE_URL = "https://api.openai.com/v1"


class SkillAssistantError(Exception):
    pass


def _sanitize_text(value: Any, max_len: int) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) > max_len:
        return text[:max_len]
    return text


def _normalize_list(value: Any, max_items: int = 50) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if len(out) >= max_items:
            break
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def _extract_output_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str) and payload.get("output_text").strip():
        return payload["output_text"].strip()

    output = payload.get("output") or []
    chunks: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            if content.get("type") == "output_text":
                text = content.get("text")
                if isinstance(text, str) and text:
                    chunks.append(text)
    return "".join(chunks).strip()


def _build_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "questions": {"type": "array", "items": {"type": "string"}},
            "draft": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "slug": {"type": "string"},
                    "description": {"type": "string"},
                    "system_prompt": {"type": "string"},
                    "rules": {"type": "string"},
                    "instructions": {"type": "string"},
                    "allowed_runtimes": {"type": "array", "items": {"type": "string"}},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
                "required": [
                    "name",
                    "slug",
                    "description",
                    "system_prompt",
                    "rules",
                    "instructions",
                    "allowed_runtimes",
                    "tags",
                ],
            },
            "notes": {"type": "string"},
        },
        "required": ["questions", "draft", "notes"],
    }


def _build_instructions(mode: str, global_policy: str, allowed_runtimes: list[str]) -> str:
    runtime_hint = ", ".join(allowed_runtimes) if allowed_runtimes else "любые"
    policy_block = f"\n\nGlobal policy:\n{global_policy}" if global_policy else ""
    return (
        "Ты помощник по созданию SKILLS для корпоративных CLI-агентов и workflow. "
        "Нужно собрать качественный draft на русском языке. "
        "Если данных недостаточно — задавай вопросы и не выдумывай факты. "
        "Не включай секреты, пароли, приватные ключи. "
        "Слаг — в kebab-case (ASCII), без пробелов. "
        f"Допустимые runtime (если нужно ограничить): {runtime_hint}. "
        f"Режим: {mode}. "
        "В режиме questions — сфокусируйся на списке вопросов, draft можно оставить пустым. "
        "В режиме draft — заполни draft максимально полно, но без выдумок."
        + policy_block
    )


def _build_user_input(goal: str, data: str, answers: str, existing: dict, platform_context: str) -> str:
    parts = []
    if goal:
        parts.append("Цель/описание:\n" + goal)
    if data:
        parts.append("Данные/контекст (серверы, политики, требования):\n" + data)
    if answers:
        parts.append("Ответы на вопросы:\n" + answers)
    if existing:
        parts.append("Текущий черновик (если есть):\n" + json.dumps(existing, ensure_ascii=False, indent=2))
    if platform_context:
        parts.append("Контекст платформы:\n" + platform_context)
    if not parts:
        parts.append("Данных пока нет. Сформируй список вопросов, какие данные нужны.")
    return "\n\n".join(parts)


def _safe_join(lines: list[str], max_chars: int) -> str:
    out = []
    spent = 0
    for line in lines:
        if not line:
            continue
        if spent + len(line) + 1 > max_chars:
            break
        out.append(line)
        spent += len(line) + 1
    return "\n".join(out)


def _collect_servers_context(user, server_ids: list[int], server_names: list[str]) -> str:
    try:
        from servers.models import GlobalServerRules, Server, ServerGroup
    except Exception:
        return ""

    qs = Server.objects.filter(user=user, is_active=True)
    if server_ids:
        qs = qs.filter(id__in=server_ids)
    if server_names:
        name_filter = Q()
        for name in server_names:
            if not name:
                continue
            name_filter |= Q(name__iexact=name) | Q(name__icontains=name) | Q(host__iexact=name)
        if name_filter:
            qs = qs.filter(name_filter)

    servers = list(qs.select_related("group").order_by("name")[:50])
    if not servers:
        return "Серверы: нет данных."

    lines = ["Серверы пользователя (id · name · host · group · tags · network):"]
    for s in servers:
        group_name = s.group.name if s.group else "-"
        tags = s.tags.strip() if s.tags else "-"
        network = s.get_network_context_summary()
        lines.append(
            f"- [{s.id}] {s.name} ({s.host}:{s.port}) group={group_name} tags={tags} network={network}"
        )

    # Global rules (if any)
    rules_obj = GlobalServerRules.objects.filter(user=user).first()
    if rules_obj:
        rules_text = rules_obj.get_context_for_ai()
        if rules_text:
            lines.append("\nГлобальные правила серверов:")
            lines.append(rules_text)

    # Group-level rules for selected servers
    group_ids = {s.group_id for s in servers if s.group_id}
    if group_ids:
        groups = ServerGroup.objects.filter(id__in=group_ids, user=user)
        for g in groups:
            ctx = g.get_context_for_ai()
            if ctx:
                lines.append(f"\nКонтекст группы {g.name}:")
                lines.append(ctx)

    return _safe_join(lines, max_chars=6000)


def _collect_projects_context(user) -> str:
    try:
        from tasks.models import Project
    except Exception:
        return ""

    qs = Project.objects.filter(Q(owner=user) | Q(members__user=user)).distinct().order_by("-updated_at")[:20]
    projects = list(qs)
    if not projects:
        return "Проекты: нет данных."

    lines = ["Проекты пользователя (key · name · archived):"]
    for p in projects:
        archived = "yes" if p.archived_at else "no"
        desc = (p.description or "").strip()
        if desc and len(desc) > 180:
            desc = desc[:180] + "..."
        lines.append(f"- {p.key}: {p.name} (archived={archived}) {desc}")
    return _safe_join(lines, max_chars=2000)


def _collect_mcp_context() -> str:
    try:
        from app.mcp.config import load_mcp_config
        from core_ui.management.commands.mcp_servers import MCP_TOOLS
    except Exception:
        return ""

    config, sources = load_mcp_config(getattr(settings, "BASE_DIR", "."))
    servers = config.get("mcpServers") or {}
    if not servers:
        return "MCP: нет конфигурации."

    lines = ["MCP сервера (из конфигурации):"]
    for name, cfg in servers.items():
        if not isinstance(cfg, dict):
            continue
        desc = str(cfg.get("description") or "").strip()
        kind = cfg.get("type") or "unknown"
        cmd = ""
        if cfg.get("command"):
            cmd = f"command={cfg.get('command')} args={cfg.get('args') or []}"
        if cfg.get("url"):
            cmd = f"url={cfg.get('url')}"
        line = f"- {name} ({kind})"
        if desc:
            line += f": {desc}"
        if cmd:
            line += f" [{cmd}]"
        lines.append(line)
        if name == "weu-servers":
            tool_names = ", ".join(t.get("name") for t in MCP_TOOLS)
            lines.append(f"  tools: {tool_names}")

    if sources:
        lines.append("MCP config sources: " + ", ".join(sources))

    return _safe_join(lines, max_chars=2000)


def _build_platform_context(user, server_ids: list[int], server_names: list[str]) -> str:
    blocks = []
    servers_ctx = _collect_servers_context(user, server_ids, server_names)
    if servers_ctx:
        blocks.append(servers_ctx)
    projects_ctx = _collect_projects_context(user)
    if projects_ctx:
        blocks.append(projects_ctx)
    mcp_ctx = _collect_mcp_context()
    if mcp_ctx:
        blocks.append(mcp_ctx)
    return "\n\n".join(b for b in blocks if b.strip())


def _normalize_draft(draft: dict) -> dict:
    if not isinstance(draft, dict):
        draft = {}
    name = _sanitize_text(draft.get("name"), 200)
    slug = _sanitize_text(draft.get("slug"), 200)
    if not slug and name:
        slug = slugify(name)
    description = _sanitize_text(draft.get("description"), 1000)
    system_prompt = _sanitize_text(draft.get("system_prompt"), 6000)
    rules = _sanitize_text(draft.get("rules"), 8000)
    instructions = _sanitize_text(draft.get("instructions"), 15000)
    allowed_runtimes = _normalize_list(draft.get("allowed_runtimes"), max_items=20)
    tags = _normalize_list(draft.get("tags"), max_items=20)
    return {
        "name": name,
        "slug": slug,
        "description": description,
        "system_prompt": system_prompt,
        "rules": rules,
        "instructions": instructions,
        "allowed_runtimes": allowed_runtimes,
        "tags": tags,
    }


def _normalize_response(payload: dict) -> dict:
    questions = _normalize_list(payload.get("questions"), max_items=12)
    draft = _normalize_draft(payload.get("draft"))
    notes = _sanitize_text(payload.get("notes"), 2000)
    return {"questions": questions, "draft": draft, "notes": notes}


def run_skill_assistant(
    *,
    user,
    mode: str,
    goal: str,
    data: str,
    answers: str,
    existing_skill: dict | None,
    server_ids: list[int] | None = None,
    server_names: list[str] | None = None,
) -> dict:
    api_key = (getattr(settings, "OPENAI_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")).strip()
    if not api_key:
        raise SkillAssistantError("OpenAI API key is not configured")

    model = (getattr(settings, "SKILLS_ASSISTANT_MODEL", "") or os.getenv("SKILLS_ASSISTANT_MODEL", "")).strip()
    if not model:
        model = DEFAULT_MODEL

    base_url = (
        getattr(settings, "OPENAI_API_BASE", "")
        or os.getenv("OPENAI_API_BASE", "")
        or DEFAULT_BASE_URL
    ).strip()
    if base_url.endswith("/"):
        base_url = base_url[:-1]

    max_chars = int(getattr(settings, "SKILLS_ASSISTANT_MAX_INPUT_CHARS", 20000) or 20000)

    goal = _sanitize_text(goal, max_chars)
    data = _sanitize_text(data, max_chars)
    answers = _sanitize_text(answers, max_chars)

    existing = existing_skill if isinstance(existing_skill, dict) else {}

    allowed_runtimes = list((getattr(settings, "CLI_RUNTIME_CONFIG", {}) or {}).keys())
    instructions = _build_instructions(mode=mode, global_policy=getattr(settings, "SKILLS_GLOBAL_RULES", ""), allowed_runtimes=allowed_runtimes)
    platform_context = _build_platform_context(user, server_ids or [], server_names or [])
    user_input = _build_user_input(goal=goal, data=data, answers=answers, existing=existing, platform_context=platform_context)

    payload = {
        "model": model,
        "instructions": instructions,
        "input": user_input,
        "temperature": 0.2,
        "max_output_tokens": 1400,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "skill_assistant",
                "schema": _build_schema(),
                "strict": True,
            }
        },
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    url = f"{base_url}/responses"

    try:
        with httpx.Client(timeout=40.0) as client:
            response = client.post(url, headers=headers, json=payload)
    except Exception as exc:
        logger.warning(f"OpenAI skill assistant request failed: {exc}")
        raise SkillAssistantError("Failed to reach OpenAI API") from exc

    if response.status_code >= 400:
        detail = response.text[:1500]
        logger.warning(f"OpenAI skill assistant error {response.status_code}: {detail}")
        raise SkillAssistantError(f"OpenAI API error {response.status_code}")

    try:
        raw = response.json()
    except Exception as exc:
        logger.warning(f"OpenAI skill assistant invalid JSON: {exc}")
        raise SkillAssistantError("Invalid response from OpenAI API") from exc

    text = _extract_output_text(raw)
    if not text:
        logger.warning("OpenAI skill assistant empty output_text")
        raise SkillAssistantError("Empty response from OpenAI API")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        logger.warning(f"OpenAI skill assistant non-JSON output: {text[:200]}")
        raise SkillAssistantError("Malformed JSON from OpenAI API")

    normalized = _normalize_response(parsed)
    normalized["model"] = model
    return normalized
