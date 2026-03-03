"""
Context processors for core_ui: inject user_can_* flags for menu and guards.
Also provides user_can_feature(user, feature) for use in views/decorators.
"""
from core_ui.models import (
    UserAppPermission,
    DEFAULT_ALLOWED_FEATURES,
    FEATURE_CHOICES,
)

FEATURE_SLUGS = [slug for slug, _ in FEATURE_CHOICES]


def _load_permissions_map(user):
    """Load per-user feature permissions as {feature: allowed} map."""
    if not user or not user.is_authenticated:
        return {}
    return {
        p.feature: bool(p.allowed)
        for p in UserAppPermission.objects.filter(user=user).only('feature', 'allowed')
    }


def user_can_feature(user, feature):
    """Return True if user is allowed to access `feature`. Anonymous => False. Use in views/decorators."""
    return _user_can_feature(user, feature)


def _user_can_feature(user, feature, permissions_map=None):
    """Return True if user is allowed to access `feature`. Anonymous => False."""
    if not user or not user.is_authenticated:
        return False
    perms = permissions_map if permissions_map is not None else _load_permissions_map(user)

    # Staff users are full-access by default, but explicit per-feature rows can override.
    if user.is_staff:
        explicit = perms.get(feature)
        if explicit is None:
            return True
        return explicit

    # Non-staff: settings requires explicit allow only.
    if feature == 'settings':
        return bool(perms.get('settings', False))

    # Non-staff: explicit row has priority; otherwise use default feature set.
    explicit = perms.get(feature)
    if explicit is not None:
        return explicit
    return feature in DEFAULT_ALLOWED_FEATURES


def _is_server_only_user(user, permissions_map=None):
    """True when user can access only servers section (and nothing else)."""
    if not user or not user.is_authenticated or user.is_staff:
        return False
    perms = permissions_map if permissions_map is not None else _load_permissions_map(user)
    if not _user_can_feature(user, 'servers', perms):
        return False
    for feature in FEATURE_SLUGS:
        if feature == 'servers':
            continue
        if _user_can_feature(user, feature, perms):
            return False
    return True


def is_server_only_user(user):
    """Public helper for views/decorators."""
    return _is_server_only_user(user)


def default_home_url_name(user):
    """Default landing route name for current user."""
    return 'servers:server_list'


def app_permissions(request):
    """Add user_can_* flags and shell mode flags to template context."""
    user = getattr(request, 'user', None)
    perms = _load_permissions_map(user)
    out = {}
    for f in FEATURE_SLUGS:
        out[f'user_can_{f}'] = _user_can_feature(user, f, perms)
    out['is_app_admin'] = bool(user and user.is_authenticated and user.is_staff)
    out['is_server_only_mode'] = _is_server_only_user(user, perms)
    out['default_home_url_name'] = default_home_url_name(user)
    return out
