from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods, require_GET
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from django.db.models import Q, Max
from asgiref.sync import async_to_sync
import json
from loguru import logger

from .models import Task, SubTask, TaskNotification, TaskExecution, TaskShare
from .notification_triggers import (
    notify_task_assigned,
    notify_task_watching,
    notify_mentioned_in_comment,
)
from .ai import improve_task_description, breakdown_task
from .ai_assistant import analyze_task_sync, improve_description_sync, breakdown_task_sync
from .smart_analyzer import SmartTaskAnalyzer
from core_ui.decorators import require_feature
from core_ui.middleware import get_template_name
from app.services.permissions import (
    PermissionService,
    _tasks_queryset_for_user,  # backward compatibility alias
    _user_can_see_task,        # backward compatibility alias
    _user_can_edit_task,       # backward compatibility alias
)


def _delegate_redirect_url(user, task_id):
    """Return (redirect_to, url) for post-delegate UI. Uses delegate_ui preference when available."""
    try:
        from .models import UserDelegatePreference
        pref = UserDelegatePreference.objects.filter(user=user).first()
        if pref and pref.delegate_ui == 'task_form':
            return ('task_form', f'/tasks/{task_id}/delegate-form/')
    except (ImportError, AttributeError):
        pass
    return ('chat', f'/chat/?task_id={task_id}')


@login_required
@require_feature('tasks', redirect_on_forbidden=True)
@require_GET
def delegate_form(request, task_id):
    """Форма «Задача для ИИ»: показать задачу и кнопку «Запустить выполнение»."""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return redirect('tasks:task_list')
    if not _user_can_edit_task(request.user, task):
        return redirect('tasks:task_list')
    return render(request, 'tasks/delegate_form.html', {'task': task})


@login_required
@require_feature('tasks', redirect_on_forbidden=True)
def task_list(request):
    from servers.models import Server
    from .models import Project, ProjectMember, Sprint, ProjectMaterial

    # Get selected project from query params
    project_id = request.GET.get('project')
    sprint_id = request.GET.get('sprint')
    view_mode = request.GET.get('view', 'board')  # board, sprints, materials

    # Get user's projects (owned or member of)
    user_projects = Project.objects.filter(
        Q(owner=request.user) | Q(members__user=request.user)
    ).distinct().order_by('-updated_at')

    current_project = None
    current_sprint = None
    sprints = []
    materials = []

    if project_id:
        current_project = user_projects.filter(id=project_id).first()

    project_members = []

    if current_project:
        # Tasks for selected project
        base_qs = Task.objects.filter(
            project=current_project
        ).prefetch_related('label_relations__label', 'subtasks', 'assignee')

        # Sprints for the project
        sprints = Sprint.objects.filter(project=current_project).order_by('-start_date', '-created_at')

        # If sprint filter is applied
        if sprint_id:
            current_sprint = sprints.filter(id=sprint_id).first()
            if current_sprint:
                base_qs = base_qs.filter(sprint=current_sprint)

        # Materials for the project
        materials = ProjectMaterial.objects.filter(project=current_project).order_by('-pinned', '-updated_at')[:20]

        # Project members for assignee selection
        project_members = ProjectMember.objects.filter(
            project=current_project
        ).select_related('user').order_by('user__username')
    else:
        # All user's tasks (no project filter)
        base_qs = _tasks_queryset_for_user(request.user).prefetch_related('label_relations__label', 'subtasks')

    limit = 100
    tasks_todo = base_qs.filter(status='TODO').order_by('-created_at')[:limit]
    tasks_in_progress = base_qs.filter(status='IN_PROGRESS').order_by('-created_at')[:limit]
    tasks_blocked = base_qs.filter(status='BLOCKED').order_by('-created_at')[:limit]
    tasks_done = base_qs.filter(status='DONE').order_by('-created_at')[:limit]

    # Servers for task assignment
    servers = Server.objects.filter(user=request.user, is_active=True)

    # Calculate sprint stats
    for sprint in sprints:
        sprint.task_count = sprint.tasks.count()
        sprint.completed_task_count = sprint.tasks.filter(status='DONE').count()
        sprint.progress = int((sprint.completed_task_count / sprint.task_count * 100) if sprint.task_count else 0)

    # Mobile or desktop template
    if getattr(request, 'is_mobile', False):
        template = 'tasks/mobile/task_list.html'
    else:
        template = 'tasks/task_list.html'

    return render(request, template, {
        'tasks_todo': tasks_todo,
        'tasks_in_progress': tasks_in_progress,
        'tasks_blocked': tasks_blocked,
        'tasks_done': tasks_done,
        'servers': servers,
        'projects': user_projects,
        'current_project': current_project,
        'current_sprint': current_sprint,
        'sprints': sprints,
        'materials': materials,
        'view_mode': view_mode,
        'project_members': project_members,
    })


@login_required
@require_feature('tasks')
@require_GET
def task_detail_api(request, task_id):
    """API: получить задачу по id (JSON)."""
    from .models import TaskComment

    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)

    # Subtasks with timing info
    subtasks = [
        {
            'id': s.id,
            'title': s.title,
            'is_completed': s.is_completed,
            'order': s.order,
            'estimated_duration_minutes': s.estimated_duration_minutes
        }
        for s in task.subtasks.all().order_by('order', 'created_at')
    ]

    # Executions timeline
    executions = [
        {
            'id': ex.id,
            'agent_type': ex.agent_type,
            'status': ex.status,
            'result_summary': ex.result_summary,
            'error_message': ex.error_message,
            'created_at': ex.created_at.isoformat() if ex.created_at else None,
            'completed_at': ex.completed_at.isoformat() if ex.completed_at else None,
        }
        for ex in task.executions.all().order_by('-created_at')[:10]
    ]

    # Comments
    comments = [
        {
            'id': c.id,
            'content': c.content,
            'author': c.author.username if c.author else 'Anonymous',
            'created_at': c.created_at.isoformat() if c.created_at else None,
        }
        for c in TaskComment.objects.filter(task=task).select_related('author')
    ]

    # Labels
    labels = [
        {
            'id': rel.label.id,
            'name': rel.label.name,
            'color': rel.label.color
        }
        for rel in task.label_relations.select_related('label')
    ]

    return JsonResponse({
        'id': task.id,
        'title': task.title,
        'description': task.description or '',
        'status': task.status,
        'priority': getattr(task, 'priority', 'MEDIUM'),
        'task_key': task.task_key,
        'subtasks': subtasks,
        'executions': executions,
        'comments': comments,
        'labels': labels,
        'target_server_id': task.target_server.id if task.target_server else None,
        'target_server_name': task.target_server.name if task.target_server else None,
        'estimated_duration_hours': task.estimated_duration_hours,
        'actual_duration_hours': task.actual_duration_hours,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'assigned_to_ai': task.assigned_to_ai,
        'ai_execution_status': task.ai_execution_status,
        'created_at': task.created_at.isoformat() if task.created_at else None,
        'progress': task.get_progress_percentage(),
        # New fields
        'assignee_id': task.assignee_id,
        'assignee_username': task.assignee.username if task.assignee else None,
        'project_id': task.project_id,
        'project_name': task.project.name if task.project else None,
        'project_key': task.project.key if task.project else None,
        'sprint_id': task.sprint_id,
        'sprint_name': task.sprint.name if task.sprint else None,
        'can_delete': PermissionService.can_delete_task(request.user, task),
    })

def _background_analyze_task(task_id: int, user_id: int):
    """Фоновый анализ задачи ИИ с созданием уведомления о результате."""
    from django.contrib.auth import get_user_model
    from loguru import logger
    
    try:
        User = get_user_model()
        task = Task.objects.get(pk=task_id)
        user = User.objects.get(pk=user_id)
        
        analyzer = SmartTaskAnalyzer()
        result = analyzer.analyze_task(task, user)
        
        # Уведомления создаются внутри analyze_task:
        # - AUTO_EXECUTION_SUGGESTION если может выполнить
        # - INFO/WARNING с детальным объяснением если не может
        if result.get('can_auto_execute'):
            logger.info(f"Task {task_id} analyzed: can auto-execute on server {result.get('servers_matched', [{}])[0].get('server', {})}")
        else:
            reason = result.get('ai_reason', 'unknown')
            logger.info(f"Task {task_id} analyzed: cannot auto-execute. Reason: {reason[:100]}")
    except Exception as e:
        from loguru import logger
        logger.error(f"Background analysis failed for task {task_id}: {e}")
        # Создаём уведомление об ошибке
        try:
            TaskNotification.objects.create(
                task_id=task_id,
                user_id=user_id,
                notification_type='WARNING',
                title='⚠️ Ошибка анализа задачи',
                message=f'Не удалось проанализировать задачу. Ошибка: {str(e)[:200]}',
            )
        except Exception:
            pass


@login_required
@require_feature('tasks', redirect_on_forbidden=True)
def task_create(request):
    from servers.models import Server
    from datetime import datetime
    from .models import Project, Sprint
    from .permissions import ProjectPermissions
    import json

    if request.method == 'POST':
        # Support both JSON and form-data
        if request.content_type == 'application/json':
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({'error': 'Invalid JSON'}, status=400)
        else:
            data = request.POST

        title = (data.get('title') or '').strip()
        description = (data.get('description') or '').strip()
        if not title:
            if request.content_type == 'application/json':
                return JsonResponse({'error': 'Title is required'}, status=400)
            return redirect(reverse('tasks:task_list') + '?error=empty_title')

        # Priority
        priority = data.get('priority', 'MEDIUM')
        if priority not in ['HIGH', 'MEDIUM', 'LOW']:
            priority = 'MEDIUM'

        # Status
        status = data.get('status', 'TODO')
        if status not in ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']:
            status = 'TODO'

        # Due date
        due_date = None
        due_date_str = data.get('due_date')
        if due_date_str:
            try:
                due_date = datetime.fromisoformat(due_date_str)
                if timezone.is_naive(due_date):
                    due_date = timezone.make_aware(due_date)
            except (ValueError, TypeError):
                pass

        # Target server
        target_server = None
        server_id = data.get('target_server') or data.get('server_id')
        if server_id:
            try:
                target_server = Server.objects.get(id=server_id, user=request.user, is_active=True)
            except Server.DoesNotExist:
                pass

        # Project
        project = None
        project_id = data.get('project_id')
        if project_id:
            try:
                project = Project.objects.get(id=project_id)
                if not ProjectPermissions.can_create_task(request.user, project):
                    if request.content_type == 'application/json':
                        return JsonResponse({'error': 'No permission to create task in this project'}, status=403)
                    return redirect(reverse('tasks:task_list') + '?error=permission_denied')
            except Project.DoesNotExist:
                pass

        # Sprint
        sprint = None
        sprint_id = data.get('sprint_id')
        if sprint_id and project:
            try:
                sprint = Sprint.objects.get(id=sprint_id, project=project)
            except Sprint.DoesNotExist:
                pass

        # Assignee
        assignee = None
        assignee_id = data.get('assignee_id')
        if assignee_id:
            from django.contrib.auth.models import User
            try:
                assignee = User.objects.get(id=assignee_id)
            except User.DoesNotExist:
                pass

        task = Task.objects.create(
            title=title,
            description=description,
            status=status,
            priority=priority,
            due_date=due_date,
            target_server=target_server,
            project=project,
            sprint=sprint,
            assignee=assignee,
            created_by=request.user
        )

        if assignee:
            notify_task_assigned(task, assignee, request.user)

        # Auto breakdown with AI if requested
        auto_breakdown = data.get('auto_breakdown') == 'on' or data.get('auto_breakdown') is True

        # Запускаем анализ в фоновом потоке — страница отдаётся сразу
        import threading

        def background_work(task_id, user_id, do_breakdown):
            # Analyze
            _background_analyze_task(task_id, user_id)
            # Breakdown if requested
            if do_breakdown:
                try:
                    t = Task.objects.get(pk=task_id)
                    subtasks_titles = breakdown_task_sync(t.title, t.description)
                    for i, st_title in enumerate(subtasks_titles):
                        SubTask.objects.create(task=t, title=st_title, order=i)
                except Exception as e:
                    logger.error(f"Auto breakdown failed for task {task_id}: {e}")

        thread = threading.Thread(
            target=background_work,
            args=(task.id, request.user.id, auto_breakdown),
            daemon=True
        )
        thread.start()

        # Return JSON for API requests
        if request.content_type == 'application/json':
            return JsonResponse({
                'success': True,
                'task_id': task.id,
                'task_key': task.task_key,
            })

        return redirect('tasks:task_list')
    return redirect('tasks:task_list')

@login_required
@require_feature('tasks')
@csrf_exempt
@require_http_methods(["POST"])
def task_update_status(request, task_id):
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'status': 'error', 'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'status': 'error', 'error': 'Forbidden'}, status=403)
    data = json.loads(request.body)
    status = data.get('status')
    if status in ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']:
        old_status = task.status
        task.status = status
        if status == 'DONE' and not task.completed_at:
            task.completed_at = timezone.now()
        task.save()
        notify_task_watching(task, request.user, summary=f'Статус изменён на {status}')
        try:
            from .email_service import TaskEmailService
            TaskEmailService.send_task_status_changed(task, old_status, request.user)
        except Exception:
            pass
    return JsonResponse({'status': 'success'})


@login_required
@require_feature('tasks')
@csrf_exempt
@require_http_methods(["POST"])
def task_update_priority(request, task_id):
    """Update task priority"""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    data = json.loads(request.body)
    priority = data.get('priority')
    if priority in ['HIGH', 'MEDIUM', 'LOW']:
        task.priority = priority
        task.save()
        return JsonResponse({'success': True, 'priority': priority})
    return JsonResponse({'error': 'Invalid priority'}, status=400)


@login_required
@require_feature('tasks')
@csrf_exempt
@require_http_methods(["POST"])
def task_update_server(request, task_id):
    """Update task target server"""
    from servers.models import Server
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    data = json.loads(request.body)
    server_id = data.get('server_id')
    if server_id:
        server = get_object_or_404(Server, id=server_id, user=request.user, is_active=True)
        task.target_server = server
    else:
        task.target_server = None
    task.save()
    return JsonResponse({
        'success': True,
        'server_id': task.target_server.id if task.target_server else None,
        'server_name': task.target_server.name if task.target_server else None
    })


@login_required
@require_feature('tasks')
@require_http_methods(["POST", "DELETE"])
def task_delete(request, task_id):
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not PermissionService.can_delete_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    deleted = {
        'id': task.id,
        'title': task.title,
    }
    task.delete()
    accepts_json = 'application/json' in (request.headers.get('Accept') or '').lower()
    is_xhr = (request.headers.get('X-Requested-With') or '').lower() == 'xmlhttprequest'
    if request.method == 'DELETE' or accepts_json or is_xhr:
        return JsonResponse({'success': True, 'deleted_task': deleted})
    return redirect('tasks:task_list')


# ==================== Subtask Management ====================

@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def subtask_toggle(request, subtask_id):
    """Toggle subtask completion status"""
    subtask = get_object_or_404(SubTask, id=subtask_id)
    task = subtask.task
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)

    subtask.is_completed = not subtask.is_completed
    if subtask.is_completed:
        subtask.completed_at = timezone.now()
    else:
        subtask.completed_at = None
    subtask.save()

    return JsonResponse({
        'success': True,
        'is_completed': subtask.is_completed,
        'progress': task.get_progress_percentage()
    })


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def subtask_create(request, task_id):
    """Create a new subtask for a task"""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)

    data = json.loads(request.body)
    title = data.get('title', '').strip()
    if not title:
        return JsonResponse({'error': 'Title required'}, status=400)

    # Get max order
    max_order = task.subtasks.aggregate(Max('order'))['order__max'] or 0

    subtask = SubTask.objects.create(
        task=task,
        title=title,
        order=max_order + 1,
        estimated_duration_minutes=data.get('estimated_duration_minutes')
    )

    return JsonResponse({
        'success': True,
        'subtask': {
            'id': subtask.id,
            'title': subtask.title,
            'is_completed': subtask.is_completed,
            'order': subtask.order,
            'estimated_duration_minutes': subtask.estimated_duration_minutes
        }
    })


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["DELETE"])
def subtask_delete(request, subtask_id):
    """Delete a subtask"""
    subtask = get_object_or_404(SubTask, id=subtask_id)
    task = subtask.task
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)

    subtask.delete()
    return JsonResponse({
        'success': True,
        'progress': task.get_progress_percentage()
    })


# ==================== Comments ====================

@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def comment_create(request, task_id):
    """Add a comment to a task"""
    from .models import TaskComment

    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)

    data = json.loads(request.body)
    content = data.get('content', '').strip()
    if not content:
        return JsonResponse({'error': 'Content required'}, status=400)

    comment = TaskComment.objects.create(
        task=task,
        author=request.user,
        content=content
    )

    notify_mentioned_in_comment(task, content, request.user)

    return JsonResponse({
        'success': True,
        'comment': {
            'id': comment.id,
            'content': comment.content,
            'author': comment.author.username if comment.author else 'Anonymous',
            'created_at': comment.created_at.isoformat() if comment.created_at else None
        }
    })


@login_required
@require_feature('tasks')
@require_GET
def comments_list(request, task_id):
    """Get all comments for a task"""
    from .models import TaskComment

    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)

    comments = TaskComment.objects.filter(task=task).select_related('author')

    return JsonResponse({
        'comments': [
            {
                'id': c.id,
                'content': c.content,
                'author': c.author.username if c.author else 'Anonymous',
                'created_at': c.created_at.isoformat() if c.created_at else None
            }
            for c in comments
        ]
    })


# AI Views

@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def ai_improve_description(request, task_id):
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    improved_desc = async_to_sync(improve_task_description)(task.title, task.description)
    task.description = improved_desc
    task.save()
    return JsonResponse({'description': improved_desc})


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def ai_breakdown(request, task_id):
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    subtasks_titles = breakdown_task_sync(task.title, task.description)
    created_subtasks = []
    for title in subtasks_titles:
        subtask = SubTask.objects.create(task=task, title=title)
        created_subtasks.append({
            'id': subtask.id,
            'title': subtask.title,
            'is_completed': subtask.is_completed
        })
    return JsonResponse({'subtasks': created_subtasks})


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def ai_analyze(request, task_id):
    """Analyze task with AI assistant"""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    analysis = analyze_task_sync(task.title, task.description)
    return JsonResponse(analysis)


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def smart_analyze(request, task_id):
    """Умный анализ задачи с извлечением серверов и предложением автоматического выполнения"""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    analyzer = SmartTaskAnalyzer()
    result = analyzer.analyze_task(task, request.user)
    return JsonResponse({
        'success': True,
        'analysis': result,
        'task': {
            'id': task.id,
            'target_server_id': task.target_server.id if task.target_server else None,
            'target_server_name': task.target_server.name if task.target_server else None,
            'auto_execution_suggested': task.auto_execution_suggested,
        }
    })


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def smart_breakdown(request, task_id):
    """Разбиение задачи на подзадачи с таймингами"""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    analyzer = SmartTaskAnalyzer()
    subtasks_data = analyzer.breakdown_task_with_timings(task)
    created_subtasks = []
    for st_data in subtasks_data:
        subtask = SubTask.objects.create(
            task=task,
            title=st_data['title'],
            order=st_data['order'],
            estimated_duration_minutes=st_data.get('estimated_duration_minutes'),
        )
        created_subtasks.append({
            'id': subtask.id,
            'title': subtask.title,
            'order': subtask.order,
            'estimated_duration_minutes': subtask.estimated_duration_minutes,
            'is_completed': subtask.is_completed
        })
    return JsonResponse({
        'success': True,
        'subtasks': created_subtasks,
        'estimated_duration_hours': task.estimated_duration_hours
    })


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(["POST"])
def approve_auto_execution(request, task_id):
    """Одобрение автоматического выполнения задачи"""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    analyzer = SmartTaskAnalyzer()
    success = analyzer.approve_auto_execution(task, request.user)
    if success:
        from .task_executor import TaskExecutor
        executor = TaskExecutor()
        import threading
        thread = threading.Thread(
            target=lambda: async_to_sync(executor.execute_task)(task.id, request.user.id)
        )
        thread.daemon = True
        thread.start()
        redirect_to, url = _delegate_redirect_url(request.user, task.id)
        return JsonResponse({
            'success': True,
            'message': 'Автоматическое выполнение одобрено и запущено',
            'redirect_to': redirect_to,
            'url': url,
        })
    return JsonResponse({
        'success': False,
        'error': 'Не удалось одобрить выполнение (сервер не найден)'
    }, status=400)


@login_required
@require_feature('tasks')
@require_GET
def notifications_list(request):
    """Список уведомлений пользователя"""
    notifications = TaskNotification.objects.filter(
        user=request.user,
        is_read=False
    ).order_by('-created_at')[:50]
    
    return JsonResponse({
        'notifications': [
            {
                'id': n.id,
                'type': n.notification_type,
                'title': n.title,
                'message': n.message,
                'task_id': n.task.id if n.task else None,
                'task_title': n.task.title if n.task else '',
                'action_data': n.action_data,
                'action_url': n.action_url,
                'created_at': n.created_at.isoformat() if n.created_at else None,
            }
            for n in notifications
        ],
        'count': notifications.count()
    })


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(['POST'])
def notification_mark_read(request, notification_id):
    """Отметить уведомление как прочитанное"""
    if request.method == 'POST':
        notification = get_object_or_404(
            TaskNotification,
            id=notification_id,
            user=request.user
        )
        notification.is_read = True
        notification.read_at = timezone.now()
        notification.save()
        
        return JsonResponse({'success': True})
    return JsonResponse({'error': 'Invalid request'}, status=400)


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(['POST'])
def notification_action(request, notification_id):
    """Выполнить действие из уведомления"""
    if request.method == 'POST':
        notification = get_object_or_404(
            TaskNotification,
            id=notification_id,
            user=request.user
        )
        
        data = json.loads(request.body)
        action = data.get('action')
        
        if action == 'dismiss':
            # Отметить уведомление как прочитанное
            notification.is_read = True
            notification.save()
            return JsonResponse({'success': True, 'message': 'Уведомление скрыто'})

        # Уведомления уровня проекта (приглашение и т.д.) — без задачи
        if notification.task_id is None:
            notification.is_read = True
            notification.save()
            return JsonResponse({
                'success': True,
                'redirect_to': notification.action_url or reverse('tasks:task_list'),
                'url': notification.action_url or reverse('tasks:task_list'),
            })

        if action in ('approve_auto_execution', 'delegate', 'confirm_server'):
            # Одобряем автоматическое выполнение / делегирование ИИ / подтверждение сервера
            task = notification.task
            redirect_to, url = _delegate_redirect_url(request.user, task.id)
            analyzer = SmartTaskAnalyzer()
            success = analyzer.approve_auto_execution(task, request.user)

            if success:
                notification.is_actioned = True
                notification.actioned_at = timezone.now()
                notification.is_read = True
                notification.save()

                # Создаём workflow и запускаем его
                try:
                    from app.services.workflow_service import create_workflow_from_task
                    workflow, run = create_workflow_from_task(task, request.user)
                    if workflow:
                        message = f'Workflow создан и запущен (ID: {workflow.id}, Run: {run.id})'
                        logger.info(f"Workflow {workflow.id} created from notification action for task {task.id}")
                    else:
                        message = 'Workflow не удалось создать, но задача одобрена'
                        logger.warning(f"Failed to create workflow from notification for task {task.id}")
                except Exception as e:
                    logger.error(f"Error creating workflow from notification: {e}")
                    message = f'Задача одобрена, но ошибка создания workflow: {e}'

                return JsonResponse({
                    'success': True,
                    'message': message,
                    'redirect_to': redirect_to,
                    'url': url,
                })
            return JsonResponse({
                'success': False,
                'error': 'Не удалось одобрить выполнение (сервер не найден)'
            }, status=400)
        
        if action == 'change_server':
            # Изменить сервер и запустить выполнение
            task = notification.task
            new_server_id = data.get('server_id')
            
            if not new_server_id:
                return JsonResponse({
                    'success': False,
                    'error': 'Не указан сервер'
                }, status=400)
            
            redirect_to, url = _delegate_redirect_url(request.user, task.id)
            analyzer = SmartTaskAnalyzer()
            success = analyzer.change_server_and_approve(task, request.user, new_server_id)
            
            if success:
                notification.is_actioned = True
                notification.actioned_at = timezone.now()
                notification.is_read = True
                notification.save()
                
                # Создаём workflow и запускаем его
                try:
                    from app.services.workflow_service import create_workflow_from_task
                    workflow, run = create_workflow_from_task(task, request.user)
                    if workflow:
                        message = f'Сервер изменён на {task.target_server.name}. Workflow создан и запущен (ID: {workflow.id})'
                        logger.info(f"Workflow {workflow.id} created after server change for task {task.id}")
                    else:
                        message = f'Сервер изменён на {task.target_server.name}, но workflow не удалось создать'
                        logger.warning(f"Failed to create workflow after server change for task {task.id}")
                except Exception as e:
                    logger.error(f"Error creating workflow after server change: {e}")
                    message = f'Сервер изменён, но ошибка создания workflow: {e}'
                
                return JsonResponse({
                    'success': True,
                    'message': message,
                    'redirect_to': redirect_to,
                    'url': url,
                })
            
            return JsonResponse({
                'success': False,
                'error': 'Не удалось изменить сервер'
            }, status=400)
        
        if action == 'answer_questions':
            # Ответить на вопросы и повторно проанализировать задачу
            task = notification.task
            answers = data.get('answers', [])
            selected_server_id = data.get('server_id')
            
            if not answers:
                return JsonResponse({
                    'success': False,
                    'error': 'Не указаны ответы'
                }, status=400)
            
            # Отмечаем текущее уведомление как обработанное
            notification.is_actioned = True
            notification.actioned_at = timezone.now()
            notification.is_read = True
            notification.save()
            
            # Повторный анализ с ответами
            analyzer = SmartTaskAnalyzer()
            result = analyzer.reanalyze_with_answers(
                task, request.user, answers, selected_server_id
            )
            
            # Если workflow был автоматически создан
            if result.get('workflow_created'):
                return JsonResponse({
                    'success': True,
                    'message': f"Спасибо за ответы! Workflow создан и запущен (ID: {result.get('workflow_id')})",
                    'workflow_created': True,
                    'workflow_id': result.get('workflow_id'),
                    'run_id': result.get('run_id'),
                })
            
            # Если workflow не создан - показываем стандартное сообщение
            return JsonResponse({
                'success': True,
                'message': 'Задача повторно проанализирована с учётом ваших ответов',
                'can_auto_execute': result.get('can_auto_execute', False),
                'servers_matched': len(result.get('servers_matched', [])) > 0,
            })
        
        if action == 'select_server':
            # Выбрать сервер для задачи без сервера
            task = notification.task
            selected_server_id = data.get('server_id')
            
            if not selected_server_id:
                return JsonResponse({
                    'success': False,
                    'error': 'Не указан сервер'
                }, status=400)
            
            from servers.models import Server
            try:
                server = Server.objects.get(id=selected_server_id, user=request.user, is_active=True)
                task.target_server = server
                task.server_name_mentioned = server.name
                task.assigned_to_ai = True
                task.ai_execution_status = 'PENDING'
                task.save()
                
                notification.is_actioned = True
                notification.actioned_at = timezone.now()
                notification.is_read = True
                notification.save()
                
                # Создаём workflow и запускаем его
                try:
                    from app.services.workflow_service import create_workflow_from_task
                    workflow, run = create_workflow_from_task(task, request.user)
                    if workflow:
                        message = f'Сервер {server.name} установлен. Workflow создан и запущен (ID: {workflow.id})'
                        logger.info(f"Workflow {workflow.id} created after server selection for task {task.id}")
                        return JsonResponse({
                            'success': True,
                            'message': message,
                            'can_auto_execute': True,
                            'workflow_id': workflow.id,
                            'run_id': run.id,
                        })
                    else:
                        logger.warning(f"Failed to create workflow after server selection for task {task.id}")
                        return JsonResponse({
                            'success': True,
                            'message': f'Сервер {server.name} установлен, но workflow не удалось создать.',
                            'can_auto_execute': False,
                        })
                except Exception as e:
                    logger.error(f"Error creating workflow after server selection: {e}")
                    return JsonResponse({
                        'success': True,
                        'message': f'Сервер {server.name} установлен, но ошибка создания workflow: {e}',
                        'can_auto_execute': False,
                    })
                
            except Server.DoesNotExist:
                return JsonResponse({
                    'success': False,
                    'error': 'Сервер не найден'
                }, status=400)
        
        return JsonResponse({'error': 'Unknown action'}, status=400)
    return JsonResponse({'error': 'Invalid request'}, status=400)


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(['POST'])
def notifications_mark_all_read(request):
    """Отметить все уведомления как прочитанные"""
    TaskNotification.objects.filter(user=request.user, is_read=False).update(is_read=True)
    return JsonResponse({'success': True, 'message': 'Все уведомления прочитаны'})


# ==================== Task Execution Settings ====================

@login_required
@require_feature('tasks')
@require_GET
def execution_settings_get(request):
    """Получить настройки выполнения задач пользователя"""
    from .models import TaskExecutionSettings
    from servers.models import Server
    
    settings = TaskExecutionSettings.get_for_user(request.user)
    
    # Список доступных серверов для выбора сервера по умолчанию
    servers = Server.objects.filter(user=request.user, is_active=True)
    available_servers = [
        {'id': s.id, 'name': s.name, 'host': s.host}
        for s in servers
    ]
    
    return JsonResponse({
        'success': True,
        'settings': {
            'require_server_confirmation': settings.require_server_confirmation,
            'auto_execute_simple_tasks': settings.auto_execute_simple_tasks,
            'ask_questions_before_execution': settings.ask_questions_before_execution,
            'default_server_id': settings.default_server_id,
            'default_server_name': settings.default_server.name if settings.default_server else None,
        },
        'available_servers': available_servers,
    })


@csrf_exempt
@login_required
@require_feature('tasks')
@require_http_methods(['POST'])
def execution_settings_update(request):
    """Обновить настройки выполнения задач пользователя"""
    from .models import TaskExecutionSettings
    from servers.models import Server
    
    settings = TaskExecutionSettings.get_for_user(request.user)
    
    data = json.loads(request.body)
    
    # Обновляем настройки
    if 'require_server_confirmation' in data:
        settings.require_server_confirmation = bool(data['require_server_confirmation'])
    
    if 'auto_execute_simple_tasks' in data:
        settings.auto_execute_simple_tasks = bool(data['auto_execute_simple_tasks'])
    
    if 'ask_questions_before_execution' in data:
        settings.ask_questions_before_execution = bool(data['ask_questions_before_execution'])
    
    if 'default_server_id' in data:
        server_id = data['default_server_id']
        if server_id:
            try:
                server = Server.objects.get(id=server_id, user=request.user, is_active=True)
                settings.default_server = server
            except Server.DoesNotExist:
                return JsonResponse({
                    'success': False,
                    'error': 'Сервер не найден'
                }, status=400)
        else:
            settings.default_server = None
    
    settings.save()
    
    return JsonResponse({
        'success': True,
        'message': 'Настройки сохранены',
        'settings': {
            'require_server_confirmation': settings.require_server_confirmation,
            'auto_execute_simple_tasks': settings.auto_execute_simple_tasks,
            'ask_questions_before_execution': settings.ask_questions_before_execution,
            'default_server_id': settings.default_server_id,
            'default_server_name': settings.default_server.name if settings.default_server else None,
        }
    })


@login_required
@require_feature('tasks')
def execution_settings_page(request):
    """Редирект в общие Настройки — настройки выполнения задач перенесены туда."""
    return redirect(reverse('settings') + '#tasks-execution')
