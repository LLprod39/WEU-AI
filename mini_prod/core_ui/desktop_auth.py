from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core import signing
from django.utils import timezone

from core_ui.models import DesktopRefreshToken

ACCESS_TOKEN_TTL_SECONDS = int(getattr(settings, "DESKTOP_ACCESS_TOKEN_TTL_SECONDS", 900))
REFRESH_TOKEN_TTL_DAYS = int(getattr(settings, "DESKTOP_REFRESH_TOKEN_TTL_DAYS", 30))
ACCESS_TOKEN_SALT = "desktop-access-v1"
WS_TOKEN_SALT = "ws-token"


class DesktopAuthError(RuntimeError):
    code = "desktop_auth_error"

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


def _refresh_hash(raw_token: str) -> str:
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def _access_payload(user: User) -> dict:
    return {
        "typ": "desktop_access",
        "uid": int(user.id),
        "jti": secrets.token_hex(12),
    }


def issue_access_token(user: User) -> str:
    return signing.dumps(_access_payload(user), salt=ACCESS_TOKEN_SALT, compress=True)


def authenticate_access_token(token: str) -> User:
    try:
        payload = signing.loads(token, salt=ACCESS_TOKEN_SALT, max_age=ACCESS_TOKEN_TTL_SECONDS)
    except signing.SignatureExpired as exc:
        raise DesktopAuthError("Access token expired", code="access_token_expired") from exc
    except signing.BadSignature as exc:
        raise DesktopAuthError("Access token is invalid", code="access_token_invalid") from exc

    if not isinstance(payload, dict) or payload.get("typ") != "desktop_access":
        raise DesktopAuthError("Access token payload is invalid", code="access_token_invalid")

    user = User.objects.filter(id=payload.get("uid"), is_active=True).first()
    if not user:
        raise DesktopAuthError("User not found for access token", code="access_token_invalid")
    return user


def create_refresh_token(user: User, *, label: str = "", user_agent: str = "") -> tuple[str, DesktopRefreshToken]:
    raw_token = secrets.token_urlsafe(48)
    record = DesktopRefreshToken.objects.create(
        user=user,
        token_hash=_refresh_hash(raw_token),
        label=(label or "").strip(),
        user_agent=(user_agent or "")[:512],
        expires_at=timezone.now() + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
    )
    return raw_token, record


def _active_refresh_record(raw_token: str) -> DesktopRefreshToken:
    token_hash = _refresh_hash(raw_token)
    record = (
        DesktopRefreshToken.objects.select_related("user")
        .filter(token_hash=token_hash, revoked_at__isnull=True, expires_at__gt=timezone.now())
        .first()
    )
    if not record:
        raise DesktopAuthError("Refresh token is invalid", code="refresh_token_invalid")
    if not record.user.is_active:
        raise DesktopAuthError("Refresh token user is inactive", code="refresh_token_invalid")
    return record


def rotate_refresh_token(raw_token: str, *, user_agent: str = "") -> tuple[User, str, DesktopRefreshToken]:
    record = _active_refresh_record(raw_token)
    new_raw, new_record = create_refresh_token(
        record.user,
        label=record.label,
        user_agent=user_agent or record.user_agent,
    )
    record.revoked_at = timezone.now()
    record.last_used_at = timezone.now()
    record.replaced_by = new_record
    record.save(update_fields=["revoked_at", "last_used_at", "replaced_by"])
    return record.user, new_raw, new_record


def revoke_refresh_token(raw_token: str) -> None:
    if not raw_token:
        return
    token_hash = _refresh_hash(raw_token)
    DesktopRefreshToken.objects.filter(token_hash=token_hash, revoked_at__isnull=True).update(revoked_at=timezone.now())


def authenticate_credentials(username: str, password: str) -> User:
    user = authenticate(username=username, password=password)
    if not user or not user.is_active:
        raise DesktopAuthError("Invalid username or password", code="invalid_credentials")
    return user


def issue_ws_token(user: User) -> str:
    signer = signing.TimestampSigner(salt=WS_TOKEN_SALT)
    return signer.sign(str(user.id))
