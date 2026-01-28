"""
Decorators for feature-based access: require_feature('orchestrator') etc.
"""
from functools import wraps
from django.shortcuts import redirect
from django.http import JsonResponse, HttpResponseForbidden

from core_ui.context_processors import user_can_feature


def require_feature(feature, redirect_on_forbidden=False):
    """
    Restrict view to users who have permission for `feature`.
    - redirect_on_forbidden=True: redirect to index (for page views).
    - redirect_on_forbidden=False: return 403 / JsonResponse (for API views).
    Must be used after @login_required so request.user is set.
    """
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                if redirect_on_forbidden:
                    return redirect('login')
                return HttpResponseForbidden()
            if not user_can_feature(request.user, feature):
                if redirect_on_forbidden:
                    return redirect('index')
                return JsonResponse({'error': 'Forbidden'}, status=403)
            return view_func(request, *args, **kwargs)
        return _wrapped
    return decorator
