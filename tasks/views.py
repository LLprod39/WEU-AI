from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods, require_GET
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from django.db.models import Q
from asgiref.sync import async_to_sync
import json

from .models import Task, SubTask, TaskNotification, TaskExecution, TaskShare
from .ai import improve_task_description, breakdown_task
from .ai_assistant import analyze_task_sync, improve_description_sync, breakdown_task_sync
from .smart_analyzer import SmartTaskAnalyzer
from core_ui.decorators import require_feature


def _tasks_queryset_for_user(user):
    """Tasks visible to user: created by, assigned to, or shared with."""
    return Task.objects.filter(
        Q(created_by=user) | Q(assignee=user) | Q(shares__user=user)
    ).distinct()


def _user_can_see_task(user, task):
    """Whether task is in user's visible set."""
    return _tasks_queryset_for_user(user).filter(pk=task.pk).exists()


def _user_can_edit_task(user, task):
    """User may edit if owner, assignee, or has TaskShare with can_edit=True."""
    if task.created_by_id == user.id or task.assignee_id == user.id:
        return True
    return task.shares.filter(user=user, can_edit=True).exists()


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
    base_qs = _tasks_queryset_for_user(request.user).prefetch_related('label_relations__label', 'subtasks')
    limit = 100
    tasks_todo = base_qs.filter(status='TODO').order_by('-created_at')[:limit]
    tasks_in_progress = base_qs.filter(status='IN_PROGRESS').order_by('-created_at')[:limit]
    tasks_done = base_qs.filter(status='DONE').order_by('-created_at')[:limit]

    return render(request, 'tasks/task_list.html', {
        'tasks_todo': tasks_todo,
        'tasks_in_progress': tasks_in_progress,
        'tasks_done': tasks_done,
    })


@login_required
@require_feature('tasks')
@require_GET
def task_detail_api(request, task_id):
    """API: получить задачу по id (JSON)."""
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    subtasks = [{'id': s.id, 'title': s.title, 'is_completed': s.is_completed} for s in task.subtasks.all()]
    return JsonResponse({
        'id': task.id,
        'title': task.title,
        'description': task.description or '',
        'status': task.status,
        'priority': getattr(task, 'priority', 'MEDIUM'),
        'subtasks': subtasks,
        'created_at': task.created_at.isoformat() if task.created_at else None,
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
    if request.method == 'POST':
        title = (request.POST.get('title') or '').strip()
        description = (request.POST.get('description') or '').strip()
        if not title:
            return redirect(reverse('tasks:task_list') + '?error=empty_title')
        task = Task.objects.create(
            title=title,
            description=description,
            created_by=request.user
        )
        
        # Запускаем анализ в фоновом потоке — страница отдаётся сразу
        import threading
        thread = threading.Thread(
            target=_background_analyze_task,
            args=(task.id, request.user.id),
            daemon=True
        )
        thread.start()
        
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
    if status in ['TODO', 'IN_PROGRESS', 'DONE']:
        task.status = status
        task.save()
    return JsonResponse({'status': 'success'})


@login_required
@require_feature('tasks')
def task_delete(request, task_id):
    task = get_object_or_404(Task, id=task_id)
    if not _user_can_see_task(request.user, task):
        return JsonResponse({'error': 'Not found'}, status=404)
    if not _user_can_edit_task(request.user, task):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    task.delete()
    return redirect('tasks:task_list')

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

                if redirect_to == 'task_form':
                    message = 'Открываю форму задачи агента. Будет создан воркфлоу в Agents и запущен.'
                else:
                    # Запускаем выполнение через TaskExecutor (чат с контекстом задачи)
                    from .task_executor import TaskExecutor
                    executor = TaskExecutor()
                    import threading
                    thread = threading.Thread(
                        target=lambda: async_to_sync(executor.execute_task)(task.id, request.user.id)
                    )
                    thread.daemon = True
                    thread.start()
                    message = 'Выполнение запущено'

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
                
                if redirect_to == 'task_form':
                    message = 'Сервер изменён. Открываю форму задачи агента.'
                else:
                    # Запускаем выполнение
                    from .task_executor import TaskExecutor
                    executor = TaskExecutor()
                    import threading
                    thread = threading.Thread(
                        target=lambda: async_to_sync(executor.execute_task)(task.id, request.user.id)
                    )
                    thread.daemon = True
                    thread.start()
                    message = f'Сервер изменён. Выполнение запущено на {task.target_server.name}'
                
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
                task.save()
                
                notification.is_actioned = True
                notification.actioned_at = timezone.now()
                notification.is_read = True
                notification.save()
                
                # Повторный анализ задачи с установленным сервером
                analyzer = SmartTaskAnalyzer()
                result = analyzer.analyze_task(task, request.user)
                
                return JsonResponse({
                    'success': True,
                    'message': f'Сервер {server.name} установлен. Задача переанализирована.',
                    'can_auto_execute': result.get('can_auto_execute', False),
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
    """Страница настроек выполнения задач"""
    from .models import TaskExecutionSettings
    from servers.models import Server
    
    settings = TaskExecutionSettings.get_for_user(request.user)
    servers = Server.objects.filter(user=request.user, is_active=True)
    
    return render(request, 'tasks/execution_settings.html', {
        'settings': settings,
        'servers': servers,
    })
