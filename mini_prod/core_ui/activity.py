"""
Activity logging helpers.
"""

from __future__ import annotations

from typing import Any

from asgiref.sync import sync_to_async
from loguru import logger

from core_ui.models import UserActivityLog


def _extract_client_ip(request) -> str:
    if not request:
        return ""
    xff = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if xff:
        # Keep first hop from X-Forwarded-For chain.
        return xff.split(",")[0].strip()
    return (request.META.get("REMOTE_ADDR") or "").strip()


def _normalize_text(value: Any, max_len: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_len:
        return text
    if max_len <= 3:
        return text[:max_len]
    return text[: max_len - 3] + "..."


def log_user_activity(
    *,
    user=None,
    user_id: int | None = None,
    request=None,
    category: str,
    action: str,
    status: str = UserActivityLog.STATUS_INFO,
    description: str = "",
    entity_type: str = "",
    entity_id: str | int = "",
    entity_name: str = "",
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Persist user activity event.
    Never raises: logging failures must not break business logic.
    """
    try:
        resolved_user = user or getattr(request, "user", None)
        resolved_user_id = user_id or (resolved_user.id if resolved_user and getattr(resolved_user, "id", None) else None)
        username_snapshot = ""
        if resolved_user and getattr(resolved_user, "username", None):
            username_snapshot = str(resolved_user.username)
        elif getattr(request, "user", None) and getattr(request.user, "username", None):
            username_snapshot = str(request.user.username)

        user_agent = ""
        if request:
            user_agent = _normalize_text(request.META.get("HTTP_USER_AGENT") or "", 512)

        UserActivityLog.objects.create(
            user_id=resolved_user_id,
            username_snapshot=_normalize_text(username_snapshot, 150),
            category=_normalize_text(category, 40) or "other",
            action=_normalize_text(action, 80) or "unknown_action",
            status=status if status in {UserActivityLog.STATUS_INFO, UserActivityLog.STATUS_SUCCESS, UserActivityLog.STATUS_ERROR} else UserActivityLog.STATUS_INFO,
            description=_normalize_text(description, 5000),
            entity_type=_normalize_text(entity_type, 40),
            entity_id=_normalize_text(entity_id, 64),
            entity_name=_normalize_text(entity_name, 255),
            ip_address=_extract_client_ip(request) or None,
            user_agent=user_agent,
            metadata=metadata or {},
        )
    except Exception as exc:
        logger.debug("log_user_activity failed: {}", exc)


async def log_user_activity_async(**kwargs) -> None:
    """Async wrapper for activity logging."""
    await sync_to_async(log_user_activity, thread_sensitive=True)(**kwargs)
