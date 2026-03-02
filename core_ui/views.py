"""
WEU AI Agent - Views
Full-featured web interface for AI Agent system
"""
import asyncio
import json
import os
import shutil
import uuid
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator
from django.shortcuts import render, redirect
from django.http import StreamingHttpResponse, JsonResponse, HttpResponseForbidden, FileResponse, Http404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods, require_GET
from django.conf import settings
from django.db import transaction
from django.db.models import OuterRef, Subquery, Count, Q
from django.urls import reverse
from asgiref.sync import sync_to_async
from dotenv import load_dotenv
from loguru import logger

# Load environment variables
load_dotenv()

# Import core logic
from app.core.unified_orchestrator import UnifiedOrchestrator
from app.core.model_config import model_manager
from app.rag.engine import RAGEngine
from app.utils.file_processor import FileProcessor
from app.utils.disk_usage import get_disk_usage_report
from app.agents.manager import get_agent_manager
from core_ui.context_processors import user_can_feature, is_server_only_user
from core_ui.decorators import require_feature, async_login_required, async_require_feature
from core_ui.activity import log_user_activity
from core_ui.models import ChatSession, ChatMessage, UserActivityLog
from core_ui.middleware import get_template_name

# Singleton instances
_unified_orchestrator = None
_orchestrator_lock = asyncio.Lock()
_rag_engine = None


def _init_unified_orchestrator_sync():
    """Sync init unified оркестратора"""
    model_manager.load_config()
    return UnifiedOrchestrator()


async def get_unified_orchestrator():
    """Get or create unified orchestrator instance"""
    global _unified_orchestrator
    async with _orchestrator_lock:
        if _unified_orchestrator is None:
            _unified_orchestrator = await asyncio.to_thread(_init_unified_orchestrator_sync)
            await _unified_orchestrator.initialize()
    return _unified_orchestrator


# Backward compatibility alias (deprecated)
async def get_orchestrator():
    """
    DEPRECATED: Use get_unified_orchestrator() instead.
    This function is kept for backward compatibility only.
    """
    import warnings
    warnings.warn(
        "get_orchestrator() is deprecated. Use get_unified_orchestrator() instead.",
        DeprecationWarning,
        stacklevel=2
    )
    return await get_unified_orchestrator()


def get_rag_engine():
    """Get or create RAG engine instance"""
    global _rag_engine
    if _rag_engine is None:
        _rag_engine = RAGEngine()
    return _rag_engine


# ============================================
# Health Check (no auth)
# ============================================

@csrf_exempt
@require_GET
def api_health(request):
    """
    Health check endpoint. No auth, no heavy checks (no LLM, no DB/network for RAG if avoidable).
    Returns: status ('ok'|'degraded'|'error'), timestamp (ISO), services: {django, rag}.
    """
    try:
        services = {'django': 'ok'}
        # RAG: use cached engine if already created (no heavy init), else treat as ok if import works
        try:
            if _rag_engine is not None:
                services['rag'] = 'ok' if _rag_engine.available else 'unavailable'
            else:
                # avoid get_rag_engine() here — it can do heavy init; module already imported
                services['rag'] = 'ok'
        except Exception:
            services['rag'] = 'unavailable'
        status = 'degraded' if services.get('rag') == 'unavailable' else 'ok'
        return JsonResponse({
            'status': status,
            'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z',
            'services': services,
        })
    except Exception:
        return JsonResponse({
            'status': 'error',
            'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z',
            'services': {'django': 'error', 'rag': 'unavailable'},
        }, status=500)


# ============================================
# Authentication Views
# ============================================

class CustomLoginView(LoginView):
    template_name = 'login.html'
    redirect_authenticated_user = True
    
    def get_template_names(self):
        """Return mobile or desktop login template based on device."""
        return [get_template_name(self.request, 'login.html')]

    def get_success_url(self):
        """Server-only accounts should land directly on Servers tab after login."""
        if is_server_only_user(self.request.user):
            return reverse('servers:server_list')
        return super().get_success_url()


# ============================================
# Public / Semi-Public Landing
# ============================================

def welcome_view(request):
    """Public landing page: pitch, gallery, features, trust, CTA. No auth required."""
    return render(request, 'welcome.html')


def docs_ui_guide_view(request):
    """Documentation: UI guide. No auth required."""
    return render(request, 'docs_ui_guide.html')


@login_required
def mobile_app_view(request):
    """Mobile PWA — compact app shell for phones."""
    return render(request, 'mobile_app.html')


_ALLOWED_LANDING_VIDEOS = {'agent.mp4', 'mcp.mp4', 'server.mp4', 'task.mp4', 'agent.mkv', 'mcp.mkv', 'server.mkv', 'task.mkv'}


@require_GET
def serve_landing_video(request, filename):
    """Раздача видео для лендинга (не зависит от staticfiles). Файлы в core_ui/static/landing/videos/."""
    if filename not in _ALLOWED_LANDING_VIDEOS:
        raise Http404
    video_dir = (Path(settings.BASE_DIR) / 'core_ui' / 'static' / 'landing' / 'videos').resolve()
    filepath = (video_dir / filename).resolve()
    try:
        filepath.relative_to(video_dir)
    except ValueError:
        raise Http404
    if not filepath.is_file():
        raise Http404
    content_type = 'video/mp4' if filename.endswith('.mp4') else 'video/x-matroska'
    return FileResponse(open(filepath, 'rb'), content_type=content_type, as_attachment=False)


# ============================================
# Main Page Views
# ============================================

@login_required
@require_feature('orchestrator', redirect_on_forbidden=True)
def chat_view(request):
    """Main chat interface"""
    default_provider = model_manager.config.default_provider
    rag = get_rag_engine()
    context = {
        'default_provider': default_provider,
        'is_auto_default': default_provider == 'auto',
        'is_gemini_default': default_provider == 'gemini',
        'is_grok_default': default_provider == 'grok',
        'rag_available': rag.available,
        'rag_build': getattr(rag, 'rag_build', 'full'),
    }

    # Check for start_task_id
    task_id = request.GET.get('task_id')
    if task_id:
        try:
            # Lazy import to avoid circular dependency
            from tasks.models import Task
            task = Task.objects.get(id=task_id)
            initial_prompt = f"I need you to execute this task: '{task.title}'.\n\nDescription:\n{task.description}\n\nPlease analyze it and start working on it."
            context['initial_prompt'] = initial_prompt.replace('\n', '\\n').replace("'", "\\'")
        except Exception as exc:
            logger.warning(f"Failed to prefill task prompt for task_id={task_id}: {exc}")

    template = get_template_name(request, 'chat.html')
    return render(request, template, context)


# Backward compatibility alias
index = chat_view


@login_required
@require_feature('orchestrator', redirect_on_forbidden=True)
def orchestrator_view(request):
    """Orchestrator dashboard - shows agent workflow"""
    # Use cached orchestrator instance to avoid slow initialization
    # Tools will be loaded asynchronously via API
    context = {
        'tool_count': 0,  # Will be updated via API
    }
    template = get_template_name(request, 'orchestrator.html')
    return render(request, template, context)


@login_required
@require_feature('agents', redirect_on_forbidden=True)
def monitor_view(request):
    """AI Monitor - unified monitoring dashboard for agent and workflow runs."""
    return render(request, 'monitor.html', {})


@login_required
def dashboard_view(request):
    """Dashboard - main page with system overview for DevOps admins."""
    if is_server_only_user(request.user):
        return redirect('servers:server_list')

    if request.user.is_staff:
        return _admin_dashboard_view(request)

    from datetime import date, timedelta
    from django.utils import timezone as tz
    from servers.models import Server
    from tasks.models import Task
    from agent_hub.models import AgentRun, AgentWorkflow

    # Stats (same for all users for global overview)
    servers_total = Server.objects.count()
    servers_active = Server.objects.filter(is_active=True).count()
    tasks_total = Task.objects.count()
    tasks_pending = Task.objects.filter(status='TODO').count()
    tasks_in_progress = Task.objects.filter(status='IN_PROGRESS').count()
    agents_running = AgentRun.objects.filter(status='running').count()
    agents_today = AgentRun.objects.filter(created_at__date=date.today()).count()
    workflows_total = AgentWorkflow.objects.count()

    # Failed runs in last 24h
    last_24h = tz.now() - timedelta(hours=24)
    failed_runs_count = AgentRun.objects.filter(status='failed', created_at__gte=last_24h).count()

    context = {
        'servers': {'total': servers_total, 'active': servers_active},
        'tasks': {
            'total': tasks_total,
            'pending': tasks_pending,
            'in_progress': tasks_in_progress,
        },
        'agents': {'running': agents_running, 'today': agents_today},
        'workflows': {'total': workflows_total},
        'recent_runs': AgentRun.objects.order_by('-created_at')[:5],
        'failed_runs_count': failed_runs_count,
    }

    # User-scoped widgets (tasks, projects)
    overdue_tasks_count = 0
    if user_can_feature(request.user, 'tasks'):
        try:
            from tasks.permissions import get_tasks_for_user, get_projects_for_user
            my_tasks_qs = get_tasks_for_user(request.user).filter(
                assignee=request.user,
                status__in=['TODO', 'IN_PROGRESS']
            ).select_related('project').order_by('due_date', '-updated_at')[:5]
            context['recent_tasks'] = list(my_tasks_qs)
            projects_qs = get_projects_for_user(request.user).order_by('-updated_at')[:3]
            context['recent_projects'] = list(projects_qs)
            # Overdue tasks
            overdue_tasks_count = get_tasks_for_user(request.user).filter(
                assignee=request.user,
                status__in=['TODO', 'IN_PROGRESS'],
                due_date__lt=date.today(),
            ).count()
        except Exception:
            context['recent_tasks'] = []
            context['recent_projects'] = []
    else:
        context['recent_tasks'] = []
        context['recent_projects'] = []

    context['overdue_tasks_count'] = overdue_tasks_count

    # Unread notifications count (tasks)
    if user_can_feature(request.user, 'tasks'):
        try:
            from tasks.models import TaskNotification
            context['unread_notifications_count'] = TaskNotification.objects.filter(
                user=request.user, is_read=False
            ).count()
        except Exception:
            context['unread_notifications_count'] = 0
    else:
        context['unread_notifications_count'] = 0

    # Recent chats (last 5)
    try:
        recent_chats_qs = ChatSession.objects.filter(user=request.user).order_by('-updated_at')[:5]
        context['recent_chats'] = list(recent_chats_qs)
    except Exception:
        context['recent_chats'] = []

    # Attention items count (for hero summary)
    attention_count = (
        context.get('unread_notifications_count', 0)
        + overdue_tasks_count
        + agents_running
        + failed_runs_count
    )
    context['attention_count'] = attention_count

    # App version for System Status card
    context['app_version'] = getattr(settings, 'WEU_VERSION', '2.0.0')

    return render(request, 'dashboard.html', context)


@login_required
def api_dashboard_stats(request):
    """API endpoint for dashboard statistics (for real-time updates)."""
    if is_server_only_user(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)

    from datetime import date, timedelta
    from django.utils import timezone as tz
    from servers.models import Server
    from tasks.models import Task
    from agent_hub.models import AgentRun, AgentWorkflow

    last_24h = tz.now() - timedelta(hours=24)
    failed_runs_count = AgentRun.objects.filter(status='failed', created_at__gte=last_24h).count()
    agents_running = AgentRun.objects.filter(status='running').count()

    data = {
        'servers': {
            'total': Server.objects.count(),
            'active': Server.objects.filter(is_active=True).count(),
        },
        'tasks': {
            'total': Task.objects.count(),
            'pending': Task.objects.filter(status='TODO').count(),
            'in_progress': Task.objects.filter(status='IN_PROGRESS').count(),
        },
        'agents': {
            'running': agents_running,
            'today': AgentRun.objects.filter(created_at__date=date.today()).count(),
        },
        'workflows': {
            'total': AgentWorkflow.objects.count(),
        },
        'failed_runs_count': failed_runs_count,
    }

    overdue_tasks_count = 0
    if user_can_feature(request.user, 'tasks'):
        try:
            from tasks.models import TaskNotification
            data['unread_notifications_count'] = TaskNotification.objects.filter(
                user=request.user, is_read=False
            ).count()
        except Exception:
            data['unread_notifications_count'] = 0
        try:
            from tasks.permissions import get_tasks_for_user
            overdue_tasks_count = get_tasks_for_user(request.user).filter(
                assignee=request.user,
                status__in=['TODO', 'IN_PROGRESS'],
                due_date__lt=date.today(),
            ).count()
        except Exception:
            pass
    else:
        data['unread_notifications_count'] = 0

    data['overdue_tasks_count'] = overdue_tasks_count
    data['attention_count'] = (
        data.get('unread_notifications_count', 0)
        + overdue_tasks_count
        + agents_running
        + failed_runs_count
    )

    return JsonResponse({'success': True, 'data': data})


def _admin_dashboard_view(request):
    """Admin monitoring dashboard — staff only. Called from dashboard_view()."""
    from datetime import date, timedelta
    from django.utils import timezone as tz
    from django.contrib.auth.models import User
    from django.db.models import Count, Sum, Q
    from django.db.models.functions import TruncHour
    from servers.models import Server, ServerConnection
    from tasks.models import Task
    from agent_hub.models import AgentRun, AgentWorkflow
    from core_ui.models import LLMUsageLog

    now = tz.now()
    today = date.today()
    last_24h = now - timedelta(hours=24)
    last_5min = now - timedelta(minutes=5)
    last_7d = now - timedelta(days=7)

    # Online users (active in last 5 min)
    online_user_ids = list(
        UserActivityLog.objects.filter(created_at__gte=last_5min)
        .values_list('user_id', flat=True).distinct()
    )
    online_users_qs = User.objects.filter(id__in=online_user_ids)
    online_users_list = []
    for u in online_users_qs:
        last_log = UserActivityLog.objects.filter(user=u).order_by('-created_at').first()
        online_users_list.append({
            'username': u.username,
            'action': last_log.action if last_log else '',
            'time': last_log.created_at.isoformat() if last_log else '',
        })

    # AI requests today
    ai_requests_today = UserActivityLog.objects.filter(
        action__in=['chat_request', 'terminal_ai_request', 'chat_message'],
        created_at__date=today,
    ).count()

    # Active terminals
    active_connections = ServerConnection.objects.filter(status='connected').select_related('server', 'user')
    terminals_list = []
    for conn in active_connections:
        terminals_list.append({
            'server': conn.server.name,
            'user': conn.user.username if conn.user_id else 'unknown',
            'connected_at': conn.connected_at.isoformat(),
        })

    # Agent stats
    agents_running = AgentRun.objects.filter(status='running').count()
    agents_today = AgentRun.objects.filter(created_at__date=today).count()
    succeeded_24h = AgentRun.objects.filter(status='completed', created_at__gte=last_24h).count()
    failed_24h = AgentRun.objects.filter(status='failed', created_at__gte=last_24h).count()
    total_finished_24h = succeeded_24h + failed_24h
    success_rate = round(succeeded_24h / total_finished_24h * 100) if total_finished_24h > 0 else 100

    # LLM / API usage today
    COST_PER_1K = {'gemini': 0.0005, 'grok': 0.005, 'claude': 0.003, 'openai': 0.002}
    api_usage = {}
    for provider in ('gemini', 'grok', 'claude', 'openai'):
        qs = LLMUsageLog.objects.filter(provider=provider, created_at__date=today)
        calls = qs.count()
        agg = qs.aggregate(
            inp=Sum('input_tokens'),
            out=Sum('output_tokens'),
        )
        inp = agg['inp'] or 0
        out = agg['out'] or 0
        errors = qs.filter(status__in=['error', 'timeout']).count()
        cost = round((inp + out) / 1000 * COST_PER_1K.get(provider, 0.001), 4)
        api_usage[provider] = {
            'calls': calls, 'input_tokens': inp, 'output_tokens': out,
            'errors': errors, 'cost_usd': cost,
        }
    api_calls_today = sum(v['calls'] for v in api_usage.values())

    # Provider status
    providers = {
        'gemini': {
            'enabled': model_manager.config.gemini_enabled,
            'model': model_manager.get_chat_model('gemini') if model_manager.config.gemini_enabled else '',
        },
        'grok': {
            'enabled': model_manager.config.grok_enabled,
            'model': model_manager.get_chat_model('grok') if model_manager.config.grok_enabled else '',
        },
        'claude': {
            'enabled': model_manager.config.claude_enabled,
            'model': model_manager.get_chat_model('claude') if model_manager.config.claude_enabled else '',
        },
        'openai': {
            'enabled': model_manager.config.openai_enabled,
            'model': model_manager.get_chat_model('openai') if model_manager.config.openai_enabled else '',
        },
    }

    # Hourly activity (last 24h)
    hourly_qs = (
        UserActivityLog.objects.filter(created_at__gte=last_24h)
        .annotate(hour=TruncHour('created_at'))
        .values('hour')
        .annotate(count=Count('id'))
        .order_by('hour')
    )
    hourly_activity = [{'hour': h['hour'].isoformat(), 'count': h['count']} for h in hourly_qs]

    # Top users (7 days)
    top_users_qs = (
        UserActivityLog.objects.filter(created_at__gte=last_7d, user__isnull=False)
        .values('user__username')
        .annotate(
            total=Count('id'),
            ai_requests=Count('id', filter=Q(action__in=['chat_request', 'terminal_ai_request', 'chat_message'])),
            terminal_sessions=Count('id', filter=Q(category='terminal')),
        )
        .order_by('-total')[:10]
    )
    top_users = [
        {
            'username': u['user__username'],
            'total': u['total'],
            'ai_requests': u['ai_requests'],
            'terminal_sessions': u['terminal_sessions'],
        }
        for u in top_users_qs
    ]

    # Recent activity
    recent_activity_qs = UserActivityLog.objects.select_related('user').order_by('-created_at')[:20]
    recent_activity = [
        {
            'user': log.username_snapshot or (log.user.username if log.user_id else 'system'),
            'category': log.category,
            'action': log.action,
            'time': log.created_at.isoformat(),
        }
        for log in recent_activity_qs
    ]

    # System
    servers_total = Server.objects.count()
    servers_active = Server.objects.filter(is_active=True).count()
    tasks_total = Task.objects.count()
    tasks_in_progress = Task.objects.filter(status='IN_PROGRESS').count()
    total_registered = User.objects.count()

    context = {
        'online_users': {'count': len(online_user_ids), 'total_registered': total_registered, 'users': online_users_list},
        'ai': {'requests_today': ai_requests_today},
        'terminals': {'active': active_connections.count(), 'connections': terminals_list},
        'agents': {
            'running': agents_running, 'today': agents_today,
            'succeeded_24h': succeeded_24h, 'failed_24h': failed_24h,
            'success_rate': success_rate,
        },
        'api_usage': api_usage,
        'api_calls_today': api_calls_today,
        'providers': providers,
        'servers': {'total': servers_total, 'active': servers_active},
        'tasks': {'total': tasks_total, 'in_progress': tasks_in_progress},
        'hourly_activity': json.dumps(hourly_activity),
        'top_users': top_users,
        'recent_activity': recent_activity,
        'app_version': getattr(settings, 'WEU_VERSION', '2.0.0'),
    }
    return render(request, 'admin_dashboard.html', context)


@login_required
@require_http_methods(["GET"])
def api_admin_dashboard(request):
    """JSON API for admin dashboard auto-refresh. Staff only."""
    if not request.user.is_staff:
        return JsonResponse({'error': 'Forbidden'}, status=403)

    from datetime import date, timedelta
    from django.utils import timezone as tz
    from django.contrib.auth.models import User
    from django.db.models import Count, Sum, Q
    from django.db.models.functions import TruncHour
    from servers.models import Server, ServerConnection
    from tasks.models import Task
    from agent_hub.models import AgentRun
    from core_ui.models import LLMUsageLog

    now = tz.now()
    today = date.today()
    last_24h = now - timedelta(hours=24)
    last_5min = now - timedelta(minutes=5)
    last_7d = now - timedelta(days=7)

    # Online users
    online_user_ids = list(
        UserActivityLog.objects.filter(created_at__gte=last_5min)
        .values_list('user_id', flat=True).distinct()
    )
    online_users = []
    for u in User.objects.filter(id__in=online_user_ids):
        last_log = UserActivityLog.objects.filter(user=u).order_by('-created_at').first()
        online_users.append({
            'username': u.username,
            'action': last_log.action if last_log else '',
            'time': last_log.created_at.isoformat() if last_log else '',
        })

    # AI requests
    ai_requests_today = UserActivityLog.objects.filter(
        action__in=['chat_request', 'terminal_ai_request', 'chat_message'],
        created_at__date=today,
    ).count()

    # Terminals
    active_conns = ServerConnection.objects.filter(status='connected').select_related('server', 'user')
    terminals = [
        {'server': c.server.name, 'user': c.user.username if c.user_id else 'unknown',
         'connected_at': c.connected_at.isoformat()}
        for c in active_conns
    ]

    # Agents
    agents_running = AgentRun.objects.filter(status='running').count()
    agents_today = AgentRun.objects.filter(created_at__date=today).count()
    succeeded_24h = AgentRun.objects.filter(status='completed', created_at__gte=last_24h).count()
    failed_24h = AgentRun.objects.filter(status='failed', created_at__gte=last_24h).count()
    total_fin = succeeded_24h + failed_24h
    success_rate = round(succeeded_24h / total_fin * 100) if total_fin > 0 else 100

    # API usage
    COST_PER_1K = {'gemini': 0.0005, 'grok': 0.005, 'claude': 0.003, 'openai': 0.002}
    api_usage = {}
    for prov in ('gemini', 'grok', 'claude', 'openai'):
        qs = LLMUsageLog.objects.filter(provider=prov, created_at__date=today)
        agg = qs.aggregate(inp=Sum('input_tokens'), out=Sum('output_tokens'))
        inp, out = agg['inp'] or 0, agg['out'] or 0
        api_usage[prov] = {
            'calls': qs.count(), 'input_tokens': inp, 'output_tokens': out,
            'errors': qs.filter(status__in=['error', 'timeout']).count(),
            'cost_usd': round((inp + out) / 1000 * COST_PER_1K.get(prov, 0.001), 4),
        }

    # Providers
    providers = {}
    for prov in ('gemini', 'grok', 'claude', 'openai'):
        enabled = getattr(model_manager.config, f'{prov}_enabled', False)
        providers[prov] = {
            'enabled': enabled,
            'model': model_manager.get_chat_model(prov) if enabled else '',
        }

    # Hourly
    hourly = list(
        UserActivityLog.objects.filter(created_at__gte=last_24h)
        .annotate(hour=TruncHour('created_at'))
        .values('hour').annotate(count=Count('id')).order_by('hour')
    )
    hourly_activity = [{'hour': h['hour'].isoformat(), 'count': h['count']} for h in hourly]

    # Top users
    top_users = list(
        UserActivityLog.objects.filter(created_at__gte=last_7d, user__isnull=False)
        .values('user__username')
        .annotate(
            total=Count('id'),
            ai_requests=Count('id', filter=Q(action__in=['chat_request', 'terminal_ai_request', 'chat_message'])),
            terminal_sessions=Count('id', filter=Q(category='terminal')),
        ).order_by('-total')[:10]
    )
    top_users = [
        {'username': u['user__username'], 'total': u['total'],
         'ai_requests': u['ai_requests'], 'terminal_sessions': u['terminal_sessions']}
        for u in top_users
    ]

    # Recent activity
    recent = UserActivityLog.objects.select_related('user').order_by('-created_at')[:20]
    recent_activity = [
        {'user': l.username_snapshot or (l.user.username if l.user_id else 'system'),
         'category': l.category, 'action': l.action, 'time': l.created_at.isoformat()}
        for l in recent
    ]

    data = {
        'online_users': {'count': len(online_user_ids), 'total_registered': User.objects.count(), 'users': online_users},
        'ai': {'requests_today': ai_requests_today},
        'terminals': {'active': active_conns.count(), 'connections': terminals},
        'agents': {'running': agents_running, 'today': agents_today,
                   'succeeded_24h': succeeded_24h, 'failed_24h': failed_24h, 'success_rate': success_rate},
        'api_usage': api_usage,
        'api_calls_today': sum(v['calls'] for v in api_usage.values()),
        'providers': providers,
        'servers': {'total': Server.objects.count(), 'active': Server.objects.filter(is_active=True).count()},
        'tasks': {'total': Task.objects.count(), 'in_progress': Task.objects.filter(status='IN_PROGRESS').count()},
        'hourly_activity': hourly_activity,
        'top_users': top_users,
        'recent_activity': recent_activity,
    }
    return JsonResponse({'success': True, 'data': data})


@login_required
@require_feature('knowledge_base', redirect_on_forbidden=True)
def knowledge_base_view(request):
    """Knowledge Base (RAG) management - optimized for fast loading"""
    rag = get_rag_engine()
    rag_type = 'Qdrant' if (hasattr(rag, 'use_qdrant') and rag.use_qdrant) else ('InMemory' if rag.available else 'mini')
    context = {
        'documents': [],
        'doc_count': 0,
        'rag_available': rag.available,
        'rag_type': rag_type,
        'rag_build': getattr(rag, 'rag_build', 'full'),
    }
    template = get_template_name(request, 'knowledge_base.html')
    return render(request, template, context)


@login_required
def settings_view(request):
    """Settings page — конфиг подгружается через /api/settings/ и /api/models/. Only for staff or users with settings permission."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    template = get_template_name(request, 'settings.html')
    context = {}
    if user_can_feature(request.user, 'tasks'):
        try:
            from tasks.permissions import get_projects_for_user
            context['settings_projects'] = list(get_projects_for_user(request.user).order_by('-updated_at')[:50])
        except Exception:
            context['settings_projects'] = []
    return render(request, template, context)


# ============================================
# Settings: управление доступом (одна страница с вкладками)
# ============================================


def _access_feature_slugs():
    from core_ui.models import FEATURE_CHOICES
    return [slug for slug, _ in FEATURE_CHOICES]


def _feature_allowed_for_user(user, feature: str, explicit_permissions: dict) -> bool:
    """Effective access (explicit row > defaults), aligned with core_ui.context_processors."""
    from core_ui.models import DEFAULT_ALLOWED_FEATURES

    if user.is_staff:
        explicit = explicit_permissions.get(feature)
        return True if explicit is None else bool(explicit)

    if feature == 'settings':
        return bool(explicit_permissions.get('settings', False))

    explicit = explicit_permissions.get(feature)
    if explicit is not None:
        return bool(explicit)
    return feature in DEFAULT_ALLOWED_FEATURES


def _build_user_access_payload(user, explicit_permissions: dict) -> dict:
    features = _access_feature_slugs()
    effective = {
        feature: _feature_allowed_for_user(user, feature, explicit_permissions)
        for feature in features
    }

    if effective.get('servers') and all(not allowed for f, allowed in effective.items() if f != 'servers'):
        profile = 'server_only'
    elif user.is_staff and all(effective.values()):
        profile = 'admin_full'
    else:
        profile = 'custom'

    return {
        'effective_permissions': effective,
        'explicit_permissions': explicit_permissions,
        'access_profile': profile,
    }


def _apply_access_profile(user, profile: str) -> None:
    """Apply one of predefined access profiles to user permissions."""
    from core_ui.models import UserAppPermission

    features = _access_feature_slugs()
    profile = (profile or '').strip()
    if profile not in {'server_only', 'admin_full', 'reset_defaults', 'custom'}:
        raise ValueError('Invalid access profile')

    if profile == 'custom':
        return

    if profile == 'reset_defaults':
        UserAppPermission.objects.filter(user=user).delete()
        return

    if profile == 'server_only' and user.is_superuser:
        raise ValueError('Cannot apply server-only profile to superuser')

    if profile == 'server_only':
        target = {feature: (feature == 'servers') for feature in features}
        if user.is_staff:
            user.is_staff = False
            user.save(update_fields=['is_staff'])
    else:
        # admin_full
        target = {feature: True for feature in features}
        if not user.is_staff:
            user.is_staff = True
            user.save(update_fields=['is_staff'])

    with transaction.atomic():
        for feature, allowed in target.items():
            UserAppPermission.objects.update_or_create(
                user=user,
                feature=feature,
                defaults={'allowed': allowed},
            )


def _get_access_data():
    """Данные для раздела «Управление доступом»."""
    from django.contrib.auth.models import User, Group
    from core_ui.models import UserAppPermission

    users = list(User.objects.all().prefetch_related('groups').order_by('username'))
    groups = Group.objects.all().prefetch_related('user_set').order_by('name')
    permissions = UserAppPermission.objects.select_related('user').all().order_by('user__username', 'feature')

    explicit_by_user: dict[int, dict[str, bool]] = defaultdict(dict)
    for p in permissions:
        explicit_by_user[p.user_id][p.feature] = bool(p.allowed)

    users_with_access = []
    for user in users:
        access = _build_user_access_payload(user, explicit_by_user.get(user.id, {}))
        users_with_access.append({
            'user': user,
            'access_profile': access['access_profile'],
            'effective_permissions': access['effective_permissions'],
            'explicit_permissions': access['explicit_permissions'],
        })

    return {
        'users': users,
        'users_with_access': users_with_access,
        'groups': groups,
        'permissions': permissions,
        'feature_slugs': _access_feature_slugs(),
    }


@login_required
def settings_access_view(request):
    """Единая страница «Управление доступом» с вкладками: Пользователи, Группы, Права. Доступ: settings."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    tab = request.GET.get('tab', 'users')
    if tab not in ('users', 'groups', 'permissions'):
        tab = 'users'
    ctx = _get_access_data()
    ctx['active_tab'] = tab
    return render(request, 'settings_access.html', ctx)


@login_required
def settings_users_view(request):
    """Редирект на единую страницу управления с вкладкой «Пользователи»."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    from django.urls import reverse
    return redirect(reverse('settings_access') + '?tab=users')


@login_required
def settings_groups_view(request):
    """Редирект на единую страницу управления с вкладкой «Группы»."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    from django.urls import reverse
    return redirect(reverse('settings_access') + '?tab=groups')


@login_required
def settings_permissions_view(request):
    """Редирект на единую страницу управления с вкладкой «Права»."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    from django.urls import reverse
    return redirect(reverse('settings_access') + '?tab=permissions')


# ============================================
# Cursor CLI — Ask (--mode=ask) или Agent (без --mode; флаги -p --force stream-json ...)
# ask: agent --mode=ask -p --output-format text --workspace ... --model auto "..."
# agent: agent -p --force --output-format stream-json --stream-partial-output --workspace ... --model auto "..."
# ============================================

def _resolve_cursor_cli_command() -> str:
    """Путь к бинарнику Cursor CLI (agent). Аналогично agent_hub."""
    path_from_env = (os.getenv("CURSOR_CLI_PATH") or "").strip()
    if path_from_env:
        if Path(path_from_env).exists():
            return path_from_env
        raise FileNotFoundError(
            f"CURSOR_CLI_PATH задан, но файл не найден: {path_from_env}"
        )
    cfg = getattr(settings, "CLI_RUNTIME_CONFIG", None) or {}
    cursor_cfg = cfg.get("cursor") or {}
    cmd = cursor_cfg.get("command", "agent")
    if os.path.isabs(cmd):
        if not Path(cmd).exists():
            raise FileNotFoundError(f"Cursor CLI не найден: {cmd}")
        return cmd
    resolved = shutil.which(cmd)
    if not resolved:
        raise FileNotFoundError(
            "Cursor CLI (agent) не найден. Добавьте agent в PATH или задайте CURSOR_CLI_PATH."
        )
    return resolved


def _get_servers_context_for_prompt(user_id: int) -> str:
    """
    Возвращает контекст серверов пользователя для добавления в промпт Cursor CLI.
    Включает готовые команды SSH подключения с расшифрованными паролями (если MASTER_PASSWORD задан).
    """
    if not user_id:
        return ""
    try:
        from servers.models import Server
        from passwords.encryption import PasswordEncryption
        master_pwd = os.environ.get("MASTER_PASSWORD", "").strip()
        servers = list(Server.objects.filter(user_id=user_id).only(
            "id", "name", "host", "port", "username", "auth_method", "key_path", "encrypted_password", "salt"
        ))
        if not servers:
            return ""
        lines = [
            "\n\n=== СЕРВЕРЫ ПОЛЬЗОВАТЕЛЯ ===",
            "ВАЖНО: Данные серверов ниже. НЕ ищи их в коде!",
            "Для SSH-команд используй готовые команды подключения:",
            "",
        ]
        for s in servers:
            auth = s.auth_method or "password"
            key_path = s.key_path or ""
            pwd_decrypted = ""
            if auth in ("password", "key_password") and s.encrypted_password and master_pwd and s.salt:
                try:
                    pwd_decrypted = PasswordEncryption.decrypt_password(s.encrypted_password, master_pwd, bytes(s.salt))
                except Exception as e:
                    logger.debug(f"Password decryption failed for server {s.name}: {e}")
                    pwd_decrypted = ""
            if auth == "key" and key_path:
                cmd_hint = f"ssh -i {key_path} -o StrictHostKeyChecking=no {s.username}@{s.host} -p {s.port} '<COMMAND>'"
            elif pwd_decrypted:
                safe_pwd = pwd_decrypted.replace("'", "'\\''")
                cmd_hint = f"sshpass -p '{safe_pwd}' ssh -o StrictHostKeyChecking=no {s.username}@{s.host} -p {s.port} '<COMMAND>'"
            else:
                cmd_hint = f"ssh -o StrictHostKeyChecking=no {s.username}@{s.host} -p {s.port} '<COMMAND>'  # пароль недоступен"
            lines.append(f"• {s.name}:")
            lines.append(f"    {cmd_hint}")
        lines.append("")
        lines.append("Замени <COMMAND> на нужную команду (например df -h, hostname, uptime).")
        lines.append("sshpass установлен в системе.")
        lines.append("")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"_get_servers_context_for_prompt error: {e}")
        return ""


async def _stream_cursor_cli(
    message: str,
    workspace: str,
    mode: str = "ask",
    sandbox: str = "",
    approve_mcps: bool = False,
) -> AsyncGenerator[str, None]:
    """
    Запускает Cursor CLI. Модель всегда auto.
    - ask: agent --mode=ask -p --output-format text --workspace ... --model auto "..."
    - agent: agent -p --force --output-format stream-json --stream-partial-output --workspace ... --model auto "..."
    """
    is_agent_mode = (mode or "").strip().lower() == "agent"
    cmd_path = _resolve_cursor_cli_command()
    base_dir = str(Path(workspace).resolve()) if workspace else str(Path(settings.BASE_DIR).resolve())
    env = dict(os.environ)
    extra = getattr(settings, "CURSOR_CLI_EXTRA_ENV", None) or {}
    env.update(extra)

    extra_flags = []
    if sandbox and (sandbox.strip().lower() in ("enabled", "disabled")):
        extra_flags.extend(["--sandbox", sandbox.strip().lower()])
    if approve_mcps:
        extra_flags.append("--approve-mcps")

    if is_agent_mode:
        args = [
            cmd_path,
            "-p",
            "--force",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            "--workspace",
            base_dir,
            "--model",
            "auto",
            *extra_flags,
            message,
        ]
    else:
        args = [
            cmd_path,
            "--mode=ask",
            "-p",
            "--output-format",
            "text",
            "--workspace",
            base_dir,
            "--model",
            "auto",
            *extra_flags,
            message,
        ]

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=base_dir,
        env=env,
    )
    try:
        if proc.stdout:
            while True:
                chunk = await asyncio.wait_for(proc.stdout.read(8192), timeout=120.0)
                if not chunk:
                    break
                part = chunk.decode("utf-8", errors="replace")
                if part:
                    yield part
    except asyncio.TimeoutError:
        proc.kill()
        yield "\n\n⚠️ Cursor CLI превысил время ожидания (120 с)."
    finally:
        try:
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except (asyncio.TimeoutError, ProcessLookupError):
            try:
                proc.kill()
            except (ProcessLookupError, OSError) as e:
                logger.debug(f"Process already terminated: {e}")
        if proc.returncode and proc.returncode != 0 and proc.stderr:
            err = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()
            if err:
                yield f"\n\n⚠️ Cursor CLI exit {proc.returncode}: {err[:500]}"


# ============================================
# API Endpoints
# ============================================

def _chat_history_from_session(session):
    """Build list of {role, content} from ChatMessage for orchestrator initial_history."""
    return [
        {"role": m.role, "content": m.content}
        for m in session.messages.order_by('created_at').only('role', 'content')
    ]


def _load_session(user_id, chat_id):
    """Sync helper: load ChatSession by user_id and chat_id. For use in asyncio.to_thread."""
    return ChatSession.objects.filter(user_id=user_id, id=chat_id).select_related().first()


def _load_task_context_for_user(user_id: int, task_id) -> dict:
    """Sync helper: safe task context for chat prompts."""
    try:
        task_id = int(task_id)
    except (TypeError, ValueError):
        return {}

    if not user_id or not task_id:
        return {}

    from django.contrib.auth.models import User
    from tasks.models import Task
    from app.services.permissions import PermissionService

    user = User.objects.filter(id=user_id).first()
    if not user:
        return {}
    task = Task.objects.filter(id=task_id).select_related("assignee", "created_by").first()
    if not task or not PermissionService.can_view_task(user, task):
        return {}

    return {
        "id": task.id,
        "title": task.title,
        "description": (task.description or "")[:1000],
        "status": task.status,
        "priority": getattr(task, "priority", "MEDIUM"),
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "assignee": task.assignee.username if task.assignee else None,
    }


@sync_to_async
def _get_server_names_for_user(user_id: int):
    """Синхронный запрос к ORM — вызывать только через sync_to_async из async-контекста."""
    from servers.models import Server
    return list(Server.objects.filter(user_id=user_id).values_list("name", flat=True))


async def _try_server_command_by_name(user_id: int, message: str):
    """
    Если в сообщении упомянут сервер из вкладки Servers по имени — выполнить команду по его данным и вернуть вывод.
    Возвращает строку результата или None, если «сервер по имени» не распознан.
    """
    import re
    try:
        from app.tools.server_tools import ServerExecuteTool
    except ImportError as e:
        logger.debug(f"ServerExecuteTool not available: {e}")
        return None
    if not user_id or not (message or "").strip():
        return None
    try:
        msg = (message or "").strip().lower()
        # Список имён серверов пользователя (длинные первыми, чтобы «WEU SERVER» матчился раньше «WEU»)
        raw = await _get_server_names_for_user(user_id)
        names = sorted([n for n in raw if (n or "").strip()], key=lambda x: len((x or "").strip()), reverse=True)
        if not names:
            return None
        # Ищем упоминание имени сервера в тексте (регистронезависимо, как отдельное слово/фраза)
        chosen = None
        for name in names:
            n = (name or "").strip()
            if not n:
                continue
            pat = re.escape(n)
            if re.search(r"(^|[^\w])" + pat + r"([^\w]|$)", message, re.IGNORECASE):
                chosen = name
                break
        if not chosen:
            return None
        # Команда: по умолчанию df -h при «место»/«диск»; при «подключись» — проверка hostname; иначе из текста
        command = "df -h"
        if "место" in msg or "диск" in msg or "свободн" in msg:
            command = "df -h"
        elif "подключись" in msg or "подключиться" in msg:
            command = "hostname && echo OK"
        else:
            m = re.search(r"(?:выполни|запусти|команду)\s+([^\n.!?\]]+)", message, re.IGNORECASE)
            if m:
                cmd = m.group(1).strip().strip('"\'')
                if cmd and len(cmd) < 200:
                    command = cmd
            if "df" in msg and "df -h" not in command and "df " not in command:
                command = "df -h"
        tool = ServerExecuteTool()
        out = await tool.execute(
            server_name_or_id=chosen,
            command=command,
            _context={"user_id": user_id},
        )
        return (
            f"Результат на сервере «{chosen}» (данные из вкладки Servers):\n\n{out}"
            if isinstance(out, str)
            else str(out)
        )
    except Exception as e:
        logger.warning(f"server_command_by_name failed: {e}")
        return None


@csrf_exempt
@login_required
@require_feature('orchestrator')
@require_http_methods(["GET"])
def api_chats_list(request):
    """Список чатов текущего пользователя."""
    try:
        last_msg_qs = ChatMessage.objects.filter(session=OuterRef('pk')).order_by('-created_at')
        sessions = (
            ChatSession.objects.filter(user=request.user)
            .annotate(
                last_message=Subquery(last_msg_qs.values('content')[:1]),
                last_message_role=Subquery(last_msg_qs.values('role')[:1]),
                last_message_at=Subquery(last_msg_qs.values('created_at')[:1]),
                message_count=Count('messages'),
            )
            .order_by('-updated_at')[:50]
        )

        def _preview(text):
            if not text:
                return ""
            cleaned = " ".join(str(text).split())
            return (cleaned[:140] + "...") if len(cleaned) > 140 else cleaned

        items = []
        for s in sessions:
            items.append({
                "id": s.id,
                "title": s.title,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat(),
                "preview": _preview(getattr(s, "last_message", "")),
                "last_message_role": getattr(s, "last_message_role", None),
                "last_message_at": s.last_message_at.isoformat() if getattr(s, "last_message_at", None) else None,
                "message_count": s.message_count or 0,
            })
        return JsonResponse({"chats": items})
    except Exception as e:
        logger.error(f"api_chats_list: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('orchestrator')
@require_http_methods(["POST"])
def api_chats_create(request):
    """Создать новый чат. Body: {} или {"title": "..."}. Возвращает { "id", "title" }."""
    try:
        data = json.loads(request.body) if request.body else {}
        title = (data.get("title") or "").strip() or "Новый чат"
        session = ChatSession.objects.create(user=request.user, title=title)
        return JsonResponse({"id": session.id, "title": session.title})
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        logger.error(f"api_chats_create: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('orchestrator')
@require_http_methods(["GET"])
def api_chat_detail(request, chat_id):
    """Получить чат по id с сообщениями. Доступ только к своим чатам."""
    try:
        session = ChatSession.objects.filter(user=request.user, id=chat_id).first()
        if not session:
            return JsonResponse({"error": "Not found"}, status=404)
        messages = [
            {"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in session.messages.order_by('created_at')
        ]
        return JsonResponse({
            "id": session.id,
            "title": session.title,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "messages": messages,
        })
    except Exception as e:
        logger.error(f"api_chat_detail: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@async_login_required
@async_require_feature('orchestrator')
async def chat_api(request):
    """
    Async API endpoint for chat streaming.
    Expects JSON: { "message": "user input", "model": "auto|gemini|grok|openai|claude", "chat_id": null|int }
    model=auto → Cursor CLI; chat_id — сессия для истории и сохранения сообщений.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        data = json.loads(request.body)
        user_message = data.get('message', '')
        model = data.get('model', model_manager.config.default_provider)
        specific_model = data.get('specific_model')
        use_rag = data.get('use_rag', True)
        chat_id = data.get('chat_id')
        task_context_id = data.get('task_context_id')
        workspace_param = data.get('workspace', '').strip()  # Для IDE: имя проекта или относительный путь

        if not user_message:
            return JsonResponse({'error': 'Empty message'}, status=400)

        # request.user доступен только в sync-контексте — получаем user_id через sync_to_async
        user_id = await sync_to_async(
            lambda r: r.user.id if getattr(r.user, 'is_authenticated', False) else None
        )(request)
        if user_id:
            await sync_to_async(log_user_activity, thread_sensitive=True)(
                user_id=user_id,
                request=request,
                category='assistant',
                action='chat_request',
                status=UserActivityLog.STATUS_SUCCESS,
                description=user_message[:400],
                entity_type='chat_session',
                entity_id=str(chat_id or ''),
                metadata={
                    'model': model,
                    'specific_model': specific_model or '',
                    'use_rag': bool(use_rag),
                    'workspace': workspace_param or '',
                },
            )

        # Загрузить сессию или подготовить создание новой (id отдадим в первом чанке)
        session = None
        initial_history = None
        if chat_id and user_id:
            session = await asyncio.to_thread(_load_session, user_id, chat_id)
            if session:
                initial_history = await asyncio.to_thread(_chat_history_from_session, session)
        task_context = {}
        if task_context_id and user_id:
            task_context = await asyncio.to_thread(_load_task_context_for_user, user_id, task_context_id)

        async def event_stream():
            nonlocal session
            accumulated = []
            created_session_id = None  # новый id, если создали сессию в этом запросе
            try:
                # Заменяем "auto" на default_provider из настроек
                effective_model = model
                if model == "auto":
                    effective_model = model_manager.config.default_provider or "cursor"
                
                if effective_model == "cursor" or effective_model == "auto":  # fallback
                    if not session and user_id:
                        session = await asyncio.to_thread(
                            lambda: ChatSession.objects.create(
                                user_id=user_id,
                                title=(user_message[:80] or "Чат").strip() or "Чат",
                            )
                        )
                        created_session_id = session.id
                    # Попытка «по имени сервера» из вкладки Servers — без логина/пароля в чате
                    server_result = await _try_server_command_by_name(user_id, user_message)
                    if server_result is not None:
                        if created_session_id is not None:
                            yield f"CHAT_ID:{created_session_id}\n"
                        yield server_result
                        if user_id and session:
                            def _save_auto():
                                ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_USER, content=user_message)
                                ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_ASSISTANT, content=server_result)
                                session.title = (user_message[:80] or session.title).strip() or session.title
                                session.save(update_fields=["title", "updated_at"])
                            await asyncio.to_thread(_save_auto)
                        return
                    workspace = getattr(settings, "BASE_DIR", "")
                    cursor_mode = getattr(model_manager.config, "cursor_chat_mode", "ask") or "ask"
                    cursor_sandbox = getattr(model_manager.config, "cursor_sandbox", "") or ""
                    cursor_approve_mcps = getattr(model_manager.config, "cursor_approve_mcps", False)
                    # Добавляем контекст серверов пользователя в промпт для Cursor CLI
                    servers_ctx = await asyncio.to_thread(_get_servers_context_for_prompt, user_id) if user_id else ""
                    task_ctx_prompt = ""
                    if task_context:
                        task_ctx_prompt = (
                            "TASK CONTEXT:\n"
                            f"- id: {task_context.get('id')}\n"
                            f"- title: {task_context.get('title')}\n"
                            f"- status: {task_context.get('status')}\n"
                            f"- priority: {task_context.get('priority')}\n"
                            f"- due_date: {task_context.get('due_date')}\n"
                            f"- description: {task_context.get('description')}\n"
                            "If user asks about 'this task', refer to this context instead of listing all tasks.\n\n"
                        )
                    prompt_with_servers = (servers_ctx + "\n\n" + task_ctx_prompt + user_message) if (servers_ctx or task_ctx_prompt) else user_message
                    if created_session_id is not None:
                        yield f"CHAT_ID:{created_session_id}\n"
                    async for chunk in _stream_cursor_cli(
                        prompt_with_servers,
                        workspace,
                        mode=cursor_mode,
                        sandbox=cursor_sandbox,
                        approve_mcps=cursor_approve_mcps,
                    ):
                        accumulated.append(chunk)
                        yield chunk
                    full_text = "".join(accumulated)
                    if user_id and session:
                        def _save_auto():
                            ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_USER, content=user_message)
                            ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_ASSISTANT, content=full_text)
                            session.title = (user_message[:80] or session.title).strip() or session.title
                            session.save(update_fields=["title", "updated_at"])
                        await asyncio.to_thread(_save_auto)
                    return
                if not session and user_id:
                    session = await asyncio.to_thread(
                        lambda: ChatSession.objects.create(
                            user_id=user_id,
                            title=(user_message[:80] or "Новый чат").strip() or "Новый чат",
                        )
                    )
                    created_session_id = session.id
                if created_session_id is not None:
                    yield f"CHAT_ID:{created_session_id}\n"
                
                # Разрешаем workspace если передан
                workspace_path = None
                if workspace_param:
                    try:
                        workspace_root = await asyncio.to_thread(_resolve_ide_workspace, workspace_param)
                        workspace_path = str(workspace_root)
                    except ValueError as e:
                        yield f"\n\n❌ Ошибка workspace: {e}\n"
                        return
                
                # Формируем execution_context (IDE: без RAG и без лишнего контекста серверов)
                execution_context = {}
                if user_id:
                    execution_context["user_id"] = user_id
                if task_context:
                    execution_context["task_context"] = task_context
                if workspace_path:
                    execution_context["workspace_path"] = workspace_path
                    execution_context["from_ide"] = True
                
                # В режиме IDE не подмешиваем RAG (чтобы не тянуть чек-листы и посторонние данные)
                use_rag_effective = use_rag if not workspace_path else False
                execution_context["rag_enabled"] = bool(use_rag_effective)
                
                # Используем UnifiedOrchestrator с auto mode selection
                orchestrator = await get_unified_orchestrator()
                orchestrator_mode = data.get('mode')  # Опциональный параметр mode
                # Для чата по умолчанию используем простой chat mode (без ReAct loop)
                if not orchestrator_mode and not workspace_path:
                    orchestrator_mode = "chat"
                
                # Передаем effective_model (уже заменен auto -> default_provider)
                async for chunk in orchestrator.process_user_message(
                    user_message,
                    model_preference=effective_model,
                    use_rag=use_rag_effective,
                    specific_model=specific_model,
                    user_id=user_id,
                    initial_history=initial_history,
                    execution_context=execution_context if execution_context else None,
                    mode=orchestrator_mode,
                ):
                    accumulated.append(chunk)
                    yield chunk
                full_text = "".join(accumulated)
                if user_id and session:
                    def _save():
                        ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_USER, content=user_message)
                        ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_ASSISTANT, content=full_text)
                        session.title = (user_message[:80] or session.title).strip() or session.title
                        session.save(update_fields=["title", "updated_at"])
                    await asyncio.to_thread(_save)
            except FileNotFoundError as e:
                yield f"\n\n❌ {e}"
            except Exception as e:
                yield f"\n\n❌ Error: {str(e)}"

        return StreamingHttpResponse(event_stream(), content_type='text/plain; charset=utf-8')

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_add_api(request):
    """Add text to RAG knowledge base"""
    try:
        data = json.loads(request.body)
        text = data.get('text', '')
        source = data.get('source', 'manual')
        
        if not text:
            return JsonResponse({'success': False, 'error': 'Empty text'}, status=400)
        
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        
        doc_id = rag.add_text(text, source, user_id=request.user.id)
        
        if doc_id is None:
            return JsonResponse({
                'success': False,
                'error': 'Failed to add document to RAG'
            }, status=500)
        
        return JsonResponse({
            'success': True,
            'doc_id': doc_id,
            'message': 'Document added successfully'
        })
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"Error in rag_add_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_query_api(request):
    """Query RAG knowledge base"""
    try:
        data = json.loads(request.body)
        query = data.get('query', '')
        n_results = data.get('n_results', 5)
        
        if not query:
            return JsonResponse({'success': False, 'error': 'Empty query'}, status=400)
        
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({
                'success': False,
                'error': 'RAG not available',
                'documents': [[]],
                'metadatas': [[]]
            }, status=503)
        
        try:
            results = rag.query(query, n_results, user_id=request.user.id)
            
            return JsonResponse({
                'success': True,
                'documents': results.get('documents', [[]]),
                'metadatas': results.get('metadatas', [[]])
            })
        except Exception as query_error:
            logger.error(f"Error querying RAG: {query_error}")
            return JsonResponse({
                'success': False,
                'error': f'Query failed: {str(query_error)}',
                'documents': [[]],
                'metadatas': [[]]
            }, status=500)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON',
            'documents': [[]],
            'metadatas': [[]]
        }, status=400)
    except Exception as e:
        logger.error(f"Error in rag_query_api: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e),
            'documents': [[]],
            'metadatas': [[]]
        }, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_reset_api(request):
    """Reset RAG database"""
    try:
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        
        try:
            rag.reset_db(user_id=request.user.id)
            return JsonResponse({
                'success': True,
                'message': 'Database reset successfully'
            })
        except Exception as reset_error:
            logger.error(f"Error resetting RAG: {reset_error}")
            return JsonResponse({
                'success': False,
                'error': f'Reset failed: {str(reset_error)}'
            }, status=500)
    except Exception as e:
        logger.error(f"Error in rag_reset_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_delete_api(request):
    """Delete a single document by id"""
    try:
        data = json.loads(request.body) if request.body else {}
        doc_id = data.get('doc_id') or data.get('id')
        if not doc_id:
            return JsonResponse({'success': False, 'error': 'doc_id required'}, status=400)
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        removed = rag.delete_document(str(doc_id), user_id=request.user.id)
        if removed:
            return JsonResponse({'success': True, 'message': 'Document deleted'})
        return JsonResponse({'success': False, 'error': 'Document not found'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"Error in rag_delete_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_feature('knowledge_base')
def rag_documents_api(request):
    """Get documents from RAG with pagination - optimized for performance"""
    try:
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({
                'success': False,
                'error': 'RAG not available',
                'documents': [],
                'doc_count': 0
            })
        
        # Get pagination parameters
        limit = int(request.GET.get('limit', 50))  # Default 50 documents
        offset = int(request.GET.get('offset', 0))
        
        # Get documents (limited for performance)
        all_documents = rag.get_documents(limit=limit + offset, user_id=request.user.id)
        
        # Apply pagination
        documents = all_documents[offset:offset + limit]
        total_count = len(all_documents) if offset == 0 else len(all_documents)
        
        return JsonResponse({
            'success': True,
            'documents': documents,
            'doc_count': total_count,
            'has_more': len(all_documents) > offset + limit
        })
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e),
            'documents': [],
            'doc_count': 0
        })


@login_required
@require_feature('orchestrator')
def api_tools_list(request):
    """Get list of available tools via UnifiedOrchestrator"""
    try:
        orchestrator = asyncio.run(get_unified_orchestrator())
        tools = orchestrator.get_available_tools()
        return JsonResponse({'tools': tools, 'count': len(tools)})
    except Exception as e:
        logger.error(f"Error loading tools: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_models_list(request):
    """Get list of available models for dropdowns"""
    if is_server_only_user(request.user):
        return JsonResponse({'error': 'Forbidden'}, status=403)

    try:
        gemini_models = model_manager.get_available_models('gemini')
        grok_models = model_manager.get_available_models('grok')
        openai_models = model_manager.get_available_models('openai')
        c = model_manager.config
        return JsonResponse({
            'gemini': gemini_models,
            'grok': grok_models,
            'openai': openai_models,
            'rag_defaults': [
                'models/text-embedding-004',
                'models/text-embedding-005',
                'models/embedding-001',
            ],
            'current': {
                'chat_gemini': c.chat_model_gemini,
                'chat_grok': c.chat_model_grok,
                'chat_openai': getattr(c, 'chat_model_openai', 'gpt-5-mini'),
                'rag_model': c.rag_model,
                'agent_model_gemini': c.agent_model_gemini,
                'agent_model_grok': c.agent_model_grok,
                'agent_model_openai': getattr(c, 'agent_model_openai', 'gpt-5-mini'),
                'default_provider': c.default_provider,
            }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["POST"])
def api_models_refresh(request):
    """
    POST /api/models/refresh/
    Body: { "provider": "gemini|grok|openai" }
    Fetch models from provider API and return refreshed list.
    """
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    provider = (data.get('provider') or '').strip().lower()
    if provider not in {'gemini', 'grok', 'openai'}:
        return JsonResponse({'error': 'provider must be one of: gemini, grok, openai'}, status=400)

    if provider == 'gemini' and not (os.getenv('GEMINI_API_KEY') or '').strip():
        return JsonResponse({'error': 'GEMINI_API_KEY is not configured'}, status=400)
    if provider == 'grok' and not (os.getenv('GROK_API_KEY') or '').strip():
        return JsonResponse({'error': 'GROK_API_KEY is not configured'}, status=400)
    if provider == 'openai' and not ((os.getenv('OPENAI_API_KEY') or '').strip() or (os.getenv('CODEX_API_KEY') or '').strip()):
        return JsonResponse({'error': 'OPENAI_API_KEY or CODEX_API_KEY is not configured'}, status=400)

    try:
        if provider == 'gemini':
            models = asyncio.run(model_manager.fetch_available_gemini_models())
        elif provider == 'grok':
            models = asyncio.run(model_manager.fetch_available_grok_models())
        else:
            models = asyncio.run(model_manager.fetch_available_openai_models())

        return JsonResponse({
            'success': True,
            'provider': provider,
            'models': models,
            'count': len(models),
        })
    except Exception as e:
        logger.exception('api_models_refresh error: %s', e)
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('orchestrator')
@require_http_methods(["POST"])
def api_clear_history(request):
    """Clear conversation history via UnifiedOrchestrator"""
    try:
        ChatSession.objects.filter(user=request.user).delete()
        orchestrator = asyncio.run(get_unified_orchestrator())
        orchestrator.clear_history()
        log_user_activity(
            user=request.user,
            request=request,
            category='assistant',
            action='chat_history_clear',
            status=UserActivityLog.STATUS_SUCCESS,
            description='Cleared chat history',
            entity_type='chat',
        )
        return JsonResponse({'success': True, 'message': 'History cleared'})
    except Exception as e:
        log_user_activity(
            user=request.user,
            request=request,
            category='assistant',
            action='chat_history_clear',
            status=UserActivityLog.STATUS_ERROR,
            description=f'Failed to clear chat history: {e}',
            entity_type='chat',
        )
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["GET", "POST"])
def api_settings(request):
    """GET: return full settings config. POST: update settings. Only for staff or users with settings permission."""
    if not user_can_feature(request.user, 'settings'):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    if request.method == 'GET':
        try:
            model_manager.load_config()
            c = model_manager.config
            delegate_ui = 'chat'
            try:
                from tasks.models import UserDelegatePreference
                pref = UserDelegatePreference.objects.filter(user=request.user).first()
                if pref:
                    delegate_ui = pref.delegate_ui
            except Exception as e:
                logger.debug(f"Failed to load delegate preference: {e}")
            
            # Provider Registry для статусов
            from app.core.provider_registry import get_provider_registry
            registry = get_provider_registry()
            
            return JsonResponse({
                'success': True,
                'config': {
                    'default_provider': c.default_provider,
                    'internal_llm_provider': getattr(c, 'internal_llm_provider', 'grok') or 'grok',
                    'default_orchestrator_mode': getattr(c, 'default_orchestrator_mode', 'ralph_internal') or 'ralph_internal',
                    'ralph_max_iterations': getattr(c, 'ralph_max_iterations', 20) or 20,
                    'ralph_completion_promise': getattr(c, 'ralph_completion_promise', 'COMPLETE') or 'COMPLETE',
                    'gemini_enabled': getattr(c, 'gemini_enabled', False),
                    'grok_enabled': getattr(c, 'grok_enabled', True),
                    'openai_enabled': getattr(c, 'openai_enabled', False),
                    'claude_enabled': getattr(c, 'claude_enabled', False),
                    'chat_model_gemini': c.chat_model_gemini,
                    'chat_model_grok': c.chat_model_grok,
                    'chat_model_openai': getattr(c, 'chat_model_openai', 'gpt-5-mini'),
                    'chat_model_claude': getattr(c, 'chat_model_claude', 'claude-sonnet-4-6'),
                    'rag_model': c.rag_model,
                    'agent_model_gemini': c.agent_model_gemini,
                    'agent_model_grok': c.agent_model_grok,
                    'agent_model_openai': getattr(c, 'agent_model_openai', 'gpt-5-mini'),
                    'default_agent_output_path': getattr(c, 'default_agent_output_path', '') or '',
                    'cursor_chat_mode': getattr(c, 'cursor_chat_mode', 'ask') or 'ask',
                    'cursor_sandbox': getattr(c, 'cursor_sandbox', '') or '',
                    'cursor_approve_mcps': getattr(c, 'cursor_approve_mcps', False),
                    'allow_model_selection': getattr(c, 'allow_model_selection', False),
                    'delegate_ui': delegate_ui,
                    'domain_auth_enabled': (
                        getattr(c, 'domain_auth_enabled', None)
                        if getattr(c, 'domain_auth_enabled', None) is not None
                        else bool(getattr(settings, 'DOMAIN_AUTH_ENABLED', False))
                    ),
                    'domain_auth_header': (
                        getattr(c, 'domain_auth_header', None)
                        if getattr(c, 'domain_auth_header', None)
                        else str(getattr(settings, 'DOMAIN_AUTH_HEADER', 'REMOTE_USER') or 'REMOTE_USER')
                    ),
                    'domain_auth_auto_create': (
                        getattr(c, 'domain_auth_auto_create', None)
                        if getattr(c, 'domain_auth_auto_create', None) is not None
                        else bool(getattr(settings, 'DOMAIN_AUTH_AUTO_CREATE', True))
                    ),
                    'domain_auth_lowercase_usernames': (
                        getattr(c, 'domain_auth_lowercase_usernames', None)
                        if getattr(c, 'domain_auth_lowercase_usernames', None) is not None
                        else bool(getattr(settings, 'DOMAIN_AUTH_LOWERCASE_USERNAMES', True))
                    ),
                    'domain_auth_default_profile': (
                        getattr(c, 'domain_auth_default_profile', None)
                        if getattr(c, 'domain_auth_default_profile', None)
                        else str(getattr(settings, 'DOMAIN_AUTH_DEFAULT_PROFILE', 'server_only') or 'server_only')
                    ),
                },
                'api_keys': {
                    'gemini_set': bool(os.getenv('GEMINI_API_KEY')),
                    'grok_set': bool(os.getenv('GROK_API_KEY')),
                    'openai_set': bool(os.getenv('OPENAI_API_KEY') or os.getenv('CODEX_API_KEY')),
                    'anthropic_set': bool(os.getenv('ANTHROPIC_API_KEY')),
                    'claude_set': bool(os.getenv('ANTHROPIC_API_KEY')),
                    'cursor_set': bool(os.getenv('CURSOR_API_KEY')),
                    'codex_set': bool(os.getenv('CODEX_API_KEY') or os.getenv('OPENAI_API_KEY')),
                },
                'providers': registry.get_all_providers(),
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            allowed = {
                'default_provider', 'chat_model_gemini', 'chat_model_grok',
                'chat_model_openai',
                'rag_model', 'agent_model_gemini', 'agent_model_grok',
                'agent_model_openai',
                'default_agent_output_path', 'cursor_chat_mode',
                'cursor_sandbox', 'cursor_approve_mcps',
                'internal_llm_provider',  # Провайдер для внутренних вызовов (workflow, анализ)
                'allow_model_selection',  # Разрешить выбор моделей в workflow
                'gemini_enabled',  # Включение/отключение Gemini API
                'grok_enabled',    # Включение/отключение Grok API
                'openai_enabled',  # Включение/отключение OpenAI API
                'claude_enabled',  # Включение/отключение Claude API
                'chat_model_claude',   # Выбранная модель Claude
                'default_orchestrator_mode',  # react | ralph_internal | ralph_cli
                'ralph_max_iterations',
                'ralph_completion_promise',
                'domain_auth_enabled',
                'domain_auth_header',
                'domain_auth_auto_create',
                'domain_auth_lowercase_usernames',
                'domain_auth_default_profile',
            }
            if 'domain_auth_header' in data and data['domain_auth_header'] is not None:
                data['domain_auth_header'] = str(data['domain_auth_header']).strip() or 'REMOTE_USER'
            if 'domain_auth_default_profile' in data and data['domain_auth_default_profile'] is not None:
                profile = str(data['domain_auth_default_profile']).strip().lower()
                if profile not in {'server_only', 'admin_full', 'reset_defaults', 'custom'}:
                    return JsonResponse({'success': False, 'error': 'Invalid domain_auth_default_profile'}, status=400)
                data['domain_auth_default_profile'] = profile
            for key, value in data.items():
                if key in allowed and value is not None:
                    model_manager.update_config(**{key: value})
            model_manager.save_config()
            # Per-user delegate_ui preference
            if 'delegate_ui' in data and data['delegate_ui'] in ('chat', 'task_form'):
                from tasks.models import UserDelegatePreference
                UserDelegatePreference.objects.update_or_create(
                    user=request.user,
                    defaults={'delegate_ui': data['delegate_ui']},
                )
            changed_keys = sorted([k for k, v in data.items() if k in allowed and v is not None])
            if 'delegate_ui' in data and data.get('delegate_ui') in ('chat', 'task_form'):
                changed_keys.append('delegate_ui')
            log_user_activity(
                user=request.user,
                request=request,
                category='settings',
                action='settings_update',
                status=UserActivityLog.STATUS_SUCCESS,
                description='Updated settings',
                entity_type='settings',
                metadata={'changed_keys': changed_keys},
            )
            return JsonResponse({'success': True, 'message': 'Settings updated'})
        except Exception as e:
            log_user_activity(
                user=request.user,
                request=request,
                category='settings',
                action='settings_update',
                status=UserActivityLog.STATUS_ERROR,
                description=f'Settings update failed: {e}',
                entity_type='settings',
            )
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
@require_GET
def api_settings_check(request):
    """
    GET /api/settings/check/
    Returns: { configured: true|false, missing: ['gemini_key','grok_key'] }
    Checks that API keys in settings are non-empty. Only for users with settings permission.
    """
    if not user_can_feature(request.user, 'settings'):
        return JsonResponse({'configured': False, 'missing': ['gemini_key', 'grok_key']}, status=403)
    try:
        gemini_ok = bool((os.getenv('GEMINI_API_KEY') or '').strip())
        grok_ok = bool((os.getenv('GROK_API_KEY') or '').strip())
        missing = []
        if not gemini_ok:
            missing.append('gemini_key')
        if not grok_ok:
            missing.append('grok_key')
        return JsonResponse({
            'configured': len(missing) == 0,
            'missing': missing,
        })
    except Exception as e:
        logger.exception('api_settings_check error: %s', e)
        return JsonResponse({'configured': False, 'missing': ['gemini_key', 'grok_key']}, status=500)


@login_required
@require_feature('settings')
@require_GET
def api_settings_activity_logs(request):
    """Activity log stream + aggregated stats for settings page."""
    try:
        try:
            limit = int(request.GET.get('limit', 50))
        except (TypeError, ValueError):
            limit = 50
        try:
            offset = int(request.GET.get('offset', 0))
        except (TypeError, ValueError):
            offset = 0
        try:
            days = int(request.GET.get('days', 14))
        except (TypeError, ValueError):
            days = 14

        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        days = max(1, min(days, 365))

        user_id_raw = (request.GET.get('user_id') or '').strip()
        category = (request.GET.get('category') or '').strip().lower()
        action = (request.GET.get('action') or '').strip().lower()
        status = (request.GET.get('status') or '').strip().lower()
        search = (request.GET.get('search') or '').strip()

        base_qs = UserActivityLog.objects.select_related('user')
        since = datetime.now(timezone.utc) - timedelta(days=days)
        filtered = base_qs.filter(created_at__gte=since)

        if user_id_raw:
            try:
                filtered = filtered.filter(user_id=int(user_id_raw))
            except (TypeError, ValueError):
                return JsonResponse({'success': False, 'error': 'Invalid user_id'}, status=400)
        if category and category != 'all':
            filtered = filtered.filter(category=category)
        if action and action != 'all':
            filtered = filtered.filter(action=action)
        if status and status != 'all':
            filtered = filtered.filter(status=status)
        if search:
            filtered = filtered.filter(
                Q(username_snapshot__icontains=search)
                | Q(action__icontains=search)
                | Q(category__icontains=search)
                | Q(description__icontains=search)
                | Q(entity_name__icontains=search)
            )

        total = filtered.count()
        rows = list(filtered.order_by('-created_at')[offset: offset + limit])
        events = []
        for row in rows:
            username = ''
            if row.user_id and row.user:
                username = row.user.username
            elif row.username_snapshot:
                username = row.username_snapshot
            events.append(
                {
                    'id': row.id,
                    'created_at': row.created_at.isoformat(),
                    'user_id': row.user_id,
                    'username': username or 'unknown',
                    'category': row.category,
                    'action': row.action,
                    'status': row.status,
                    'description': row.description,
                    'entity_type': row.entity_type,
                    'entity_id': row.entity_id,
                    'entity_name': row.entity_name,
                    'ip_address': row.ip_address or '',
                    'user_agent': row.user_agent or '',
                    'metadata': row.metadata or {},
                }
            )

        summary = {
            'total_events': total,
            'total_users': filtered.exclude(user_id__isnull=True).values('user_id').distinct().count(),
            'login_count': filtered.filter(action='login').count(),
            'assistant_requests': filtered.filter(action__in=['chat_request', 'terminal_ai_request']).count(),
            'server_connections': filtered.filter(action__in=['terminal_connect', 'rdp_connect']).count(),
            'server_changes': filtered.filter(action__in=['server_create', 'server_update', 'server_delete', 'servers_bulk_update']).count(),
        }

        user_stats_rows = (
            filtered.values('user_id', 'user__username', 'username_snapshot')
            .annotate(
                events_total=Count('id'),
                logins=Count('id', filter=Q(action='login')),
                ai_requests=Count('id', filter=Q(action__in=['chat_request', 'terminal_ai_request'])),
                server_connections=Count('id', filter=Q(action__in=['terminal_connect', 'rdp_connect'])),
                server_changes=Count('id', filter=Q(action__in=['server_create', 'server_update', 'server_delete', 'servers_bulk_update'])),
            )
            .order_by('-events_total')[:50]
        )

        user_stats = []
        for row in user_stats_rows:
            username = row.get('user__username') or row.get('username_snapshot') or 'unknown'
            user_stats.append(
                {
                    'user_id': row.get('user_id'),
                    'username': username,
                    'events_total': row.get('events_total', 0),
                    'logins': row.get('logins', 0),
                    'ai_requests': row.get('ai_requests', 0),
                    'server_connections': row.get('server_connections', 0),
                    'server_changes': row.get('server_changes', 0),
                }
            )

        users = list(
            UserActivityLog.objects.exclude(user_id__isnull=True)
            .values('user_id', 'user__username')
            .distinct()
            .order_by('user__username')[:500]
        )
        user_options = [
            {
                'id': u.get('user_id'),
                'username': u.get('user__username') or 'unknown',
            }
            for u in users
        ]

        return JsonResponse(
            {
                'success': True,
                'events': events,
                'summary': summary,
                'user_stats': user_stats,
                'users': user_options,
                'paging': {
                    'limit': limit,
                    'offset': offset,
                    'total': total,
                    'has_more': (offset + limit) < total,
                },
            }
        )
    except Exception as e:
        logger.exception('api_settings_activity_logs error: %s', e)
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_feature('settings')
@require_GET
def api_disk_usage(request):
    """
    GET /api/disk/
    Возвращает проверку свободного/занятого места по путям: корень ФС, MEDIA_ROOT, при необходимости каталоги приложения.
    Результат: { paths: [ { path, total, used, free, percent_used, label?, error? } ] }.
    """
    try:
        report = get_disk_usage_report(
            include_root=True,
            media_root=getattr(settings, 'MEDIA_ROOT', None),
            uploaded_files_dir=getattr(settings, 'UPLOADED_FILES_DIR', None),
            agent_projects_dir=getattr(settings, 'AGENT_PROJECTS_DIR', None),
            base_dir=getattr(settings, 'BASE_DIR', None),
        )
        # Добавляем человекочитаемые размеры для удобства
        for entry in report:
            if 'error' in entry:
                continue
            total = entry.get('total')
            used = entry.get('used')
            free = entry.get('free')
            if total is not None:
                entry['total_human'] = _format_bytes(total)
            if used is not None:
                entry['used_human'] = _format_bytes(used)
            if free is not None:
                entry['free_human'] = _format_bytes(free)
        return JsonResponse({'paths': report})
    except Exception as e:
        logger.exception('api_disk_usage error: %s', e)
        return JsonResponse({'paths': [], 'error': str(e)}, status=500)


def _format_bytes(n: int) -> str:
    """Форматирует байты в человекочитаемый вид (KB, MB, GB, TB)."""
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if abs(n) < 1024:
            return f'{n:.1f} {unit}'
        n /= 1024
    return f'{n:.1f} PB'


@login_required
@require_feature('agents')
def api_agents_list(request):
    """Get list of available agents"""
    try:
        agent_manager = get_agent_manager()
        agents = agent_manager.list_agents()
        return JsonResponse({'agents': agents})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@async_login_required
@async_require_feature('agents')
@require_http_methods(["POST"])
async def api_agent_execute(request):
    """Execute an agent with a task"""
    try:
        data = json.loads(request.body)
        agent_name = data.get('agent_name')
        task = data.get('task')
        context = data.get('context', {})
        
        if not agent_name or not task:
            return JsonResponse({'error': 'agent_name and task are required'}, status=400)
        
        agent_manager = get_agent_manager()
        result = await agent_manager.execute_agent(agent_name, task, context)
        
        return JsonResponse(result)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def api_upload_file(request):
    """Upload file and add to RAG"""
    try:
        if 'file' not in request.FILES:
            return JsonResponse({'error': 'No file provided'}, status=400)
        
        uploaded_file = request.FILES['file']
        filename = uploaded_file.name
        
        # Check if file type is supported
        if not FileProcessor.is_supported(filename):
            return JsonResponse({
                'error': f'Unsupported file type. Supported: {", ".join(FileProcessor.SUPPORTED_EXTENSIONS.keys())}'
            }, status=400)
        
        # Generate unique filename
        file_ext = Path(filename).suffix
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        file_path = settings.UPLOADED_FILES_DIR / unique_filename
        
        # Save file
        with open(file_path, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)
        
        # Process file and extract text
        result = FileProcessor.process_file(str(file_path), filename)
        
        if result['error']:
            # Delete file if processing failed
            try:
                os.remove(file_path)
            except Exception as exc:
                logger.warning(f"Failed to remove uploaded file {file_path}: {exc}")
            return JsonResponse({'error': result['error']}, status=400)
        
        # Add to RAG
        rag = get_rag_engine()
        if rag.available and result['text']:
            doc_id = rag.add_text(
                result['text'],
                source=f"upload:{filename}",
                user_id=request.user.id
            )
            result['metadata']['rag_doc_id'] = doc_id
        
        return JsonResponse({
            'success': True,
            'filename': filename,
            'text_preview': result['text'][:500] + '...' if len(result['text']) > 500 else result['text'],
            'text_length': len(result['text']),
            'metadata': result['metadata']
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


# ============================================
# IDE API (Web IDE with file tree and editor)
# ============================================

def _resolve_ide_workspace(workspace_param: str) -> Path:
    """
    Разрешает workspace параметр в безопасный Path внутри AGENT_PROJECTS_DIR.
    
    Args:
        workspace_param: имя проекта (папка в AGENT_PROJECTS_DIR) или относительный путь
        
    Returns:
        Path к workspace директории
        
    Raises:
        ValueError: если путь выходит за пределы AGENT_PROJECTS_DIR
    """
    if not workspace_param or not workspace_param.strip():
        raise ValueError("workspace parameter is required")
    
    # Нормализуем: убираем начальные/конечные слеши и точки
    normalized = workspace_param.strip().strip('/').strip('\\')
    
    # Защита от путей с ..
    if '..' in normalized or normalized.startswith('/'):
        raise ValueError("Invalid workspace path")
    
    # Собираем полный путь
    projects_dir = Path(settings.AGENT_PROJECTS_DIR)
    workspace_path = projects_dir / normalized
    
    # Проверяем, что итоговый путь находится внутри AGENT_PROJECTS_DIR
    try:
        resolved = workspace_path.resolve()
        projects_resolved = projects_dir.resolve()
        
        # Проверка через is_relative_to (Python 3.9+)
        if not str(resolved).startswith(str(projects_resolved)):
            raise ValueError(f"Workspace path must be within AGENT_PROJECTS_DIR")
    except Exception as e:
        if isinstance(e, ValueError):
            raise
        raise ValueError(f"Invalid workspace path: {e}")
    
    return workspace_path


@login_required
@require_feature('orchestrator')
@require_http_methods(["GET"])
def api_ide_list_files(request):
    """
    GET /api/ide/files/
    Параметры: workspace (имя проекта), path (относительный путь внутри проекта, по умолчанию "")
    Возвращает список файлов и папок в указанной директории.
    """
    try:
        workspace_param = request.GET.get('workspace', '').strip()
        path_param = request.GET.get('path', '').strip()
        
        if not workspace_param:
            return JsonResponse({'error': 'workspace parameter is required'}, status=400)
        
        # Разрешаем workspace
        try:
            workspace_root = _resolve_ide_workspace(workspace_param)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=403)
        
        # Нормализуем path внутри workspace
        if path_param:
            # Убираем начальные слеши
            path_param = path_param.strip('/').strip('\\')
            # Защита от ..
            if '..' in path_param:
                return JsonResponse({'error': 'Invalid path'}, status=400)
            target_path = workspace_root / path_param
        else:
            target_path = workspace_root
        
        # Проверяем, что target_path всё ещё внутри workspace_root
        try:
            target_resolved = target_path.resolve()
            workspace_resolved = workspace_root.resolve()
            if not str(target_resolved).startswith(str(workspace_resolved)):
                return JsonResponse({'error': 'Path outside workspace'}, status=403)
        except (OSError, ValueError) as e:
            logger.debug(f"Invalid path resolution: {e}")
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        # Проверяем существование
        if not target_path.exists():
            return JsonResponse({'error': 'Path not found'}, status=404)
        
        if not target_path.is_dir():
            return JsonResponse({'error': 'Path is not a directory'}, status=400)
        
        # Собираем список файлов и папок
        files = []
        try:
            for item in sorted(target_path.iterdir()):
                # Пропускаем скрытые файлы/папки (начинающиеся с .)
                if item.name.startswith('.'):
                    continue
                
                item_type = 'dir' if item.is_dir() else 'file'
                # Относительный путь от workspace_root
                rel_path = item.relative_to(workspace_root)
                files.append({
                    'name': item.name,
                    'path': str(rel_path).replace('\\', '/'),  # Нормализуем слеши
                    'type': item_type,
                })
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error listing directory {target_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        return JsonResponse({'files': files})
        
    except Exception as e:
        logger.error(f"api_ide_list_files error: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_feature('orchestrator')
@require_http_methods(["GET"])
def api_ide_read_file(request):
    """
    GET /api/ide/file/
    Параметры: workspace (имя проекта), path (относительный путь к файлу)
    Возвращает содержимое файла.
    """
    try:
        workspace_param = request.GET.get('workspace', '').strip()
        path_param = request.GET.get('path', '').strip()
        
        if not workspace_param or not path_param:
            return JsonResponse({'error': 'workspace and path parameters are required'}, status=400)
        
        # Разрешаем workspace
        try:
            workspace_root = _resolve_ide_workspace(workspace_param)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=403)
        
        # Нормализуем path
        path_param = path_param.strip('/').strip('\\')
        if '..' in path_param:
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        file_path = workspace_root / path_param

        # Проверяем безопасность пути
        try:
            file_resolved = file_path.resolve()
            workspace_resolved = workspace_root.resolve()
            if not str(file_resolved).startswith(str(workspace_resolved)):
                return JsonResponse({'error': 'Path outside workspace'}, status=403)
        except (OSError, ValueError) as e:
            logger.debug(f"Invalid path resolution: {e}")
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        # Проверяем существование и что это файл
        if not file_path.exists():
            return JsonResponse({'error': 'File not found'}, status=404)
        
        if not file_path.is_file():
            return JsonResponse({'error': 'Path is not a file'}, status=400)
        
        # Читаем файл
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except UnicodeDecodeError:
            # Пробуем как бинарный файл
            return JsonResponse({'error': 'File is not a text file'}, status=400)
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error reading file {file_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        from django.http import HttpResponse
        response = HttpResponse(content, content_type='text/plain; charset=utf-8')
        return response
        
    except Exception as e:
        logger.error(f"api_ide_read_file error: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('orchestrator')
@require_http_methods(["PUT", "POST"])
def api_ide_write_file(request):
    """
    PUT/POST /api/ide/file/
    Тело: JSON { "workspace": "...", "path": "...", "content": "..." }
    Или query: workspace, path; тело: content (text/plain)
    Создаёт или обновляет файл в workspace.
    """
    try:
        # Парсим данные из JSON или form
        if request.content_type and 'application/json' in request.content_type:
            data = json.loads(request.body)
            workspace_param = data.get('workspace', '').strip()
            path_param = data.get('path', '').strip()
            content = data.get('content', '')
        else:
            workspace_param = request.GET.get('workspace', '').strip()
            path_param = request.GET.get('path', '').strip()
            content = request.body.decode('utf-8') if request.body else ''
        
        if not workspace_param or not path_param:
            return JsonResponse({'error': 'workspace and path parameters are required'}, status=400)
        
        # Разрешаем workspace
        try:
            workspace_root = _resolve_ide_workspace(workspace_param)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=403)
        
        # Нормализуем path
        path_param = path_param.strip('/').strip('\\')
        if '..' in path_param:
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        file_path = workspace_root / path_param

        # Проверяем безопасность пути
        try:
            file_resolved = file_path.resolve()
            workspace_resolved = workspace_root.resolve()
            if not str(file_resolved).startswith(str(workspace_resolved)):
                return JsonResponse({'error': 'Path outside workspace'}, status=403)
        except (OSError, ValueError) as e:
            logger.debug(f"Invalid path resolution: {e}")
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        # Создаём родительские директории если нужно
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error creating parent directories for {file_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        # Записываем файл
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error writing file {file_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        return JsonResponse({
            'success': True,
            'path': str(file_path.relative_to(workspace_root)).replace('\\', '/'),
            'message': 'File saved successfully'
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"api_ide_write_file error: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_feature('orchestrator')
def ide_view(request):
    """
    Страница веб-IDE с редактором кода, деревом файлов и чатом.
    """
    # Получаем проект из query параметра если есть
    project = request.GET.get('project', '').strip()

    context = {
        'project': project,
    }

    return render(request, 'ide.html', context)


# ============================================
# Access Management API (Users, Groups, Permissions)
# ============================================

@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["GET", "POST"])
def api_access_users(request):
    """
    GET /api/access/users/ - список пользователей
    POST /api/access/users/ - создание нового пользователя
    """
    from django.contrib.auth.models import User, Group
    from core_ui.models import UserAppPermission

    if request.method == 'GET':
        users = User.objects.all().prefetch_related('groups').order_by('username')
        features = _access_feature_slugs()

        permissions_by_user: dict[int, dict[str, bool]] = defaultdict(dict)
        for row in UserAppPermission.objects.all().values('user_id', 'feature', 'allowed'):
            permissions_by_user[row['user_id']][row['feature']] = bool(row['allowed'])

        data = []
        for u in users:
            explicit = permissions_by_user.get(u.id, {})
            access = _build_user_access_payload(u, explicit)
            data.append({
                'id': u.id,
                'username': u.username,
                'email': u.email or '',
                'is_staff': u.is_staff,
                'is_active': u.is_active,
                'is_superuser': u.is_superuser,
                'date_joined': u.date_joined.isoformat(),
                'groups': [{'id': g.id, 'name': g.name} for g in u.groups.all()],
                'access_profile': access['access_profile'],
                'effective_permissions': access['effective_permissions'],
                'explicit_permissions': access['explicit_permissions'],
            })
        return JsonResponse({'users': data, 'features': features})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            username = data.get('username', '').strip()
            email = data.get('email', '').strip()
            password = data.get('password', '')
            is_staff = data.get('is_staff', False)
            is_active = data.get('is_active', True)
            access_profile = (data.get('access_profile') or '').strip()

            if not username:
                return JsonResponse({'error': 'Username is required'}, status=400)
            if not password:
                return JsonResponse({'error': 'Password is required'}, status=400)
            if User.objects.filter(username=username).exists():
                return JsonResponse({'error': 'Username already exists'}, status=400)

            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
            )
            user.is_staff = is_staff
            user.is_active = is_active
            user.save()

            # Добавляем в группы если указаны
            group_ids = data.get('groups', [])
            if group_ids:
                groups = Group.objects.filter(id__in=group_ids)
                user.groups.set(groups)

            # New regular users should default to server-only profile.
            if access_profile:
                _apply_access_profile(user, access_profile)
            elif not user.is_staff:
                _apply_access_profile(user, 'server_only')

            explicit = {
                p.feature: bool(p.allowed)
                for p in UserAppPermission.objects.filter(user=user).only('feature', 'allowed')
            }
            access = _build_user_access_payload(user, explicit)

            return JsonResponse({
                'success': True,
                'user': {
                    'id': user.id,
                    'username': user.username,
                    'email': user.email,
                    'is_staff': user.is_staff,
                    'is_active': user.is_active,
                    'access_profile': access['access_profile'],
                }
            })
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            logger.exception('api_access_users POST error: %s', e)
            return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["GET", "PUT", "DELETE"])
def api_access_user_detail(request, user_id):
    """
    GET /api/access/users/<id>/ - получить пользователя
    PUT /api/access/users/<id>/ - обновить пользователя
    DELETE /api/access/users/<id>/ - удалить пользователя
    """
    from django.contrib.auth.models import User, Group
    from core_ui.models import UserAppPermission

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)

    if request.method == 'GET':
        explicit = {
            p.feature: bool(p.allowed)
            for p in UserAppPermission.objects.filter(user=user).only('feature', 'allowed')
        }
        access = _build_user_access_payload(user, explicit)
        return JsonResponse({
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email or '',
                'is_staff': user.is_staff,
                'is_active': user.is_active,
                'is_superuser': user.is_superuser,
                'date_joined': user.date_joined.isoformat(),
                'groups': [{'id': g.id, 'name': g.name} for g in user.groups.all()],
                'access_profile': access['access_profile'],
                'effective_permissions': access['effective_permissions'],
                'explicit_permissions': access['explicit_permissions'],
            }
        })

    if request.method == 'PUT':
        try:
            data = json.loads(request.body)

            # Нельзя редактировать суперпользователя (кроме себя если тоже superuser)
            if user.is_superuser and user.id != request.user.id:
                return JsonResponse({'error': 'Cannot edit superuser'}, status=403)

            # Обновляем поля
            if 'email' in data:
                user.email = data['email'].strip()
            if 'is_staff' in data:
                user.is_staff = bool(data['is_staff'])
            if 'is_active' in data:
                user.is_active = bool(data['is_active'])
            if 'username' in data and data['username'].strip():
                new_username = data['username'].strip()
                if new_username != user.username:
                    if User.objects.filter(username=new_username).exists():
                        return JsonResponse({'error': 'Username already exists'}, status=400)
                    user.username = new_username

            user.save()

            # Обновляем группы если указаны
            if 'groups' in data:
                group_ids = data['groups']
                groups = Group.objects.filter(id__in=group_ids)
                user.groups.set(groups)

            if 'access_profile' in data:
                _apply_access_profile(user, data.get('access_profile'))

            explicit = {
                p.feature: bool(p.allowed)
                for p in UserAppPermission.objects.filter(user=user).only('feature', 'allowed')
            }
            access = _build_user_access_payload(user, explicit)

            return JsonResponse({
                'success': True,
                'user': {
                    'id': user.id,
                    'username': user.username,
                    'email': user.email,
                    'is_staff': user.is_staff,
                    'is_active': user.is_active,
                    'access_profile': access['access_profile'],
                }
            })
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=400)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            logger.exception('api_access_user_detail PUT error: %s', e)
            return JsonResponse({'error': str(e)}, status=500)

    if request.method == 'DELETE':
        # Нельзя удалить себя
        if user.id == request.user.id:
            return JsonResponse({'error': 'Cannot delete yourself'}, status=400)
        # Нельзя удалить суперпользователя
        if user.is_superuser:
            return JsonResponse({'error': 'Cannot delete superuser'}, status=403)

        user.delete()
        return JsonResponse({'success': True, 'message': 'User deleted'})


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["POST"])
def api_access_user_password(request, user_id):
    """
    POST /api/access/users/<id>/password/ - изменить пароль пользователя
    """
    from django.contrib.auth.models import User

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)

    # Нельзя менять пароль суперпользователя (кроме себя)
    if user.is_superuser and user.id != request.user.id:
        return JsonResponse({'error': 'Cannot change superuser password'}, status=403)

    try:
        data = json.loads(request.body)
        new_password = data.get('password', '')

        if not new_password or len(new_password) < 4:
            return JsonResponse({'error': 'Password must be at least 4 characters'}, status=400)

        user.set_password(new_password)
        user.save()

        return JsonResponse({'success': True, 'message': 'Password changed'})
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.exception('api_access_user_password error: %s', e)
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["POST"])
def api_access_user_profile(request, user_id):
    """
    POST /api/access/users/<id>/profile/ - применить профиль доступа
    profile: server_only | admin_full | reset_defaults | custom
    """
    from django.contrib.auth.models import User
    from core_ui.models import UserAppPermission

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)

    if user.is_superuser and user.id != request.user.id:
        return JsonResponse({'error': 'Cannot edit superuser'}, status=403)

    try:
        data = json.loads(request.body)
        profile = (data.get('profile') or '').strip()
        if not profile:
            return JsonResponse({'error': 'profile is required'}, status=400)

        _apply_access_profile(user, profile)

        explicit = {
            p.feature: bool(p.allowed)
            for p in UserAppPermission.objects.filter(user=user).only('feature', 'allowed')
        }
        access = _build_user_access_payload(user, explicit)

        return JsonResponse({
            'success': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'is_staff': user.is_staff,
                'is_active': user.is_active,
            },
            'access_profile': access['access_profile'],
            'effective_permissions': access['effective_permissions'],
            'explicit_permissions': access['explicit_permissions'],
        })
    except ValueError as e:
        return JsonResponse({'error': str(e)}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.exception('api_access_user_profile error: %s', e)
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["GET", "POST"])
def api_access_groups(request):
    """
    GET /api/access/groups/ - список групп
    POST /api/access/groups/ - создание новой группы
    """
    from django.contrib.auth.models import Group

    if request.method == 'GET':
        groups = Group.objects.all().prefetch_related('user_set').order_by('name')
        data = [{
            'id': g.id,
            'name': g.name,
            'members': [{'id': u.id, 'username': u.username} for u in g.user_set.all()],
            'member_count': g.user_set.count(),
        } for g in groups]
        return JsonResponse({'groups': data})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            name = data.get('name', '').strip()

            if not name:
                return JsonResponse({'error': 'Group name is required'}, status=400)
            if Group.objects.filter(name=name).exists():
                return JsonResponse({'error': 'Group already exists'}, status=400)

            group = Group.objects.create(name=name)

            # Добавляем членов если указаны
            member_ids = data.get('members', [])
            if member_ids:
                from django.contrib.auth.models import User
                members = User.objects.filter(id__in=member_ids)
                group.user_set.set(members)

            return JsonResponse({
                'success': True,
                'group': {
                    'id': group.id,
                    'name': group.name,
                    'member_count': group.user_set.count(),
                }
            })
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            logger.exception('api_access_groups POST error: %s', e)
            return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["GET", "PUT", "DELETE"])
def api_access_group_detail(request, group_id):
    """
    GET /api/access/groups/<id>/ - получить группу
    PUT /api/access/groups/<id>/ - обновить группу
    DELETE /api/access/groups/<id>/ - удалить группу
    """
    from django.contrib.auth.models import Group, User

    try:
        group = Group.objects.prefetch_related('user_set').get(id=group_id)
    except Group.DoesNotExist:
        return JsonResponse({'error': 'Group not found'}, status=404)

    if request.method == 'GET':
        return JsonResponse({
            'group': {
                'id': group.id,
                'name': group.name,
                'members': [{'id': u.id, 'username': u.username} for u in group.user_set.all()],
            }
        })

    if request.method == 'PUT':
        try:
            data = json.loads(request.body)

            if 'name' in data and data['name'].strip():
                new_name = data['name'].strip()
                if new_name != group.name:
                    if Group.objects.filter(name=new_name).exists():
                        return JsonResponse({'error': 'Group name already exists'}, status=400)
                    group.name = new_name
                    group.save()

            # Обновляем членов если указаны
            if 'members' in data:
                member_ids = data['members']
                members = User.objects.filter(id__in=member_ids)
                group.user_set.set(members)

            return JsonResponse({
                'success': True,
                'group': {
                    'id': group.id,
                    'name': group.name,
                    'member_count': group.user_set.count(),
                }
            })
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            logger.exception('api_access_group_detail PUT error: %s', e)
            return JsonResponse({'error': str(e)}, status=500)

    if request.method == 'DELETE':
        group.delete()
        return JsonResponse({'success': True, 'message': 'Group deleted'})


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["POST", "DELETE"])
def api_access_group_members(request, group_id):
    """
    POST /api/access/groups/<id>/members/ - добавить пользователя в группу
    DELETE /api/access/groups/<id>/members/ - удалить пользователя из группы
    """
    from django.contrib.auth.models import Group, User

    try:
        group = Group.objects.get(id=group_id)
    except Group.DoesNotExist:
        return JsonResponse({'error': 'Group not found'}, status=404)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')

        if not user_id:
            return JsonResponse({'error': 'user_id is required'}, status=400)

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return JsonResponse({'error': 'User not found'}, status=404)

        if request.method == 'POST':
            group.user_set.add(user)
            return JsonResponse({'success': True, 'message': f'{user.username} added to {group.name}'})

        if request.method == 'DELETE':
            group.user_set.remove(user)
            return JsonResponse({'success': True, 'message': f'{user.username} removed from {group.name}'})

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.exception('api_access_group_members error: %s', e)
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["GET", "POST"])
def api_access_permissions(request):
    """
    GET /api/access/permissions/ - список прав
    POST /api/access/permissions/ - создание/обновление права
    """
    from django.contrib.auth.models import User
    from core_ui.models import UserAppPermission, FEATURE_CHOICES

    if request.method == 'GET':
        permissions = UserAppPermission.objects.select_related('user').all().order_by('user__username', 'feature')
        data = [{
            'id': p.id,
            'user_id': p.user.id,
            'username': p.user.username,
            'feature': p.feature,
            'feature_display': p.get_feature_display(),
            'allowed': p.allowed,
        } for p in permissions]

        # Также возвращаем список доступных фич
        features = [{'value': f[0], 'label': f[1]} for f in FEATURE_CHOICES]

        return JsonResponse({'permissions': data, 'features': features})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            user_id = data.get('user_id')
            feature = data.get('feature', '').strip()
            allowed = data.get('allowed', True)

            if not user_id:
                return JsonResponse({'error': 'user_id is required'}, status=400)
            if not feature:
                return JsonResponse({'error': 'feature is required'}, status=400)

            # Проверяем что feature валидный
            valid_features = [f[0] for f in FEATURE_CHOICES]
            if feature not in valid_features:
                return JsonResponse({'error': f'Invalid feature. Valid: {valid_features}'}, status=400)

            try:
                user = User.objects.get(id=user_id)
            except User.DoesNotExist:
                return JsonResponse({'error': 'User not found'}, status=404)

            if user.is_superuser and user.id != request.user.id:
                return JsonResponse({'error': 'Cannot edit superuser'}, status=403)

            # Создаем или обновляем
            perm, created = UserAppPermission.objects.update_or_create(
                user=user,
                feature=feature,
                defaults={'allowed': bool(allowed)}
            )

            return JsonResponse({
                'success': True,
                'created': created,
                'permission': {
                    'id': perm.id,
                    'user_id': perm.user.id,
                    'username': perm.user.username,
                    'feature': perm.feature,
                    'allowed': perm.allowed,
                }
            })
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            logger.exception('api_access_permissions POST error: %s', e)
            return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('settings')
@require_http_methods(["PUT", "DELETE"])
def api_access_permission_detail(request, perm_id):
    """
    PUT /api/access/permissions/<id>/ - обновить право
    DELETE /api/access/permissions/<id>/ - удалить право
    """
    from core_ui.models import UserAppPermission

    try:
        perm = UserAppPermission.objects.select_related('user').get(id=perm_id)
    except UserAppPermission.DoesNotExist:
        return JsonResponse({'error': 'Permission not found'}, status=404)

    if perm.user.is_superuser and perm.user.id != request.user.id:
        return JsonResponse({'error': 'Cannot edit superuser'}, status=403)

    if request.method == 'PUT':
        try:
            data = json.loads(request.body)
            if 'allowed' in data:
                perm.allowed = bool(data['allowed'])
                perm.save()

            return JsonResponse({
                'success': True,
                'permission': {
                    'id': perm.id,
                    'user_id': perm.user.id,
                    'username': perm.user.username,
                    'feature': perm.feature,
                    'allowed': perm.allowed,
                }
            })
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        except Exception as e:
            logger.exception('api_access_permission_detail PUT error: %s', e)
            return JsonResponse({'error': str(e)}, status=500)

    if request.method == 'DELETE':
        perm.delete()
        return JsonResponse({'success': True, 'message': 'Permission deleted'})
