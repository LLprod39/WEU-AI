"""
Context processors for core_ui: inject user_can_* flags for menu and guards.
Also provides user_can_feature(user, feature) for use in views/decorators.
"""
from core_ui.models import UserAppPermission, DEFAULT_ALLOWED_FEATURES

FEATURE_SLUGS = ['agents', 'orchestrator', 'servers', 'tasks', 'knowledge_base', 'settings']


def user_can_feature(user, feature):
    """Return True if user is allowed to access `feature`. Anonymous => False. Use in views/decorators."""
    return _user_can_feature(user, feature)


def _user_can_feature(user, feature):
    """Return True if user is allowed to access `feature`. Anonymous => False."""
    if not user or not user.is_authenticated:
        return False
    if feature == 'settings':
        if user.is_staff:
            return True
        perm = UserAppPermission.objects.filter(user=user, feature='settings', allowed=True).exists()
        return perm
    # For other features: default True if no row, else use permission
    perm = UserAppPermission.objects.filter(user=user, feature=feature).first()
    if perm is None:
        return feature in DEFAULT_ALLOWED_FEATURES
    return perm.allowed


def app_permissions(request):
    """Add user_can_agents, user_can_orchestrator, ... user_can_settings to template context."""
    user = getattr(request, 'user', None)
    out = {}
    for f in FEATURE_SLUGS:
        out[f'user_can_{f}'] = _user_can_feature(user, f)
    out['is_app_admin'] = bool(user and user.is_authenticated and user.is_staff)
    return out
