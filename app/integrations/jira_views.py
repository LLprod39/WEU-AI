"""
API views для Jira интеграции
"""
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from loguru import logger
from asgiref.sync import async_to_sync

from app.integrations.jira_connector import get_jira_connector


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def api_jira_sync(request):
    """
    Синхронизация задач из Jira
    
    POST /api/jira/sync/
    {
        "jql_filter": "project = DEVOPS AND status = 'To Do'",
        "auto_analyze": true
    }
    """
    try:
        data = json.loads(request.body) if request.body else {}
        jql_filter = data.get('jql_filter', '')
        auto_analyze = data.get('auto_analyze', True)
        
        if not jql_filter:
            return JsonResponse({
                'success': False,
                'error': 'JQL filter required'
            }, status=400)
        
        connector = get_jira_connector()
        
        if not connector.available:
            return JsonResponse({
                'success': False,
                'error': 'Jira not configured. Set JIRA_URL, JIRA_API_TOKEN, JIRA_EMAIL'
            }, status=503)
        
        # Синхронизация (async)
        result = async_to_sync(connector.sync_tasks)(
            jql_filter=jql_filter,
            user_id=request.user.id,
            auto_analyze=auto_analyze
        )
        
        return JsonResponse({
            'success': True,
            'imported_count': len(result),
            'tasks': result
        })
    
    except Exception as e:
        logger.error(f"Jira sync error: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def api_jira_update_status(request):
    """
    Обновление статуса задачи в Jira
    
    POST /api/jira/update-status/
    {
        "task_id": 123
    }
    """
    try:
        data = json.loads(request.body) if request.body else {}
        task_id = data.get('task_id')
        
        if not task_id:
            return JsonResponse({
                'success': False,
                'error': 'task_id required'
            }, status=400)
        
        from tasks.models import Task
        task = Task.objects.get(id=task_id, created_by=request.user)
        
        connector = get_jira_connector()
        
        if not connector.available:
            return JsonResponse({
                'success': False,
                'error': 'Jira not configured'
            }, status=503)
        
        # Синхронизация статуса
        success = async_to_sync(connector.sync_status_to_jira)(task)
        
        if success:
            return JsonResponse({
                'success': True,
                'message': f'Status synced to Jira for {task.external_id}'
            })
        else:
            return JsonResponse({
                'success': False,
                'error': 'Failed to sync status'
            }, status=500)
    
    except Task.DoesNotExist:
        return JsonResponse({
            'success': False,
            'error': 'Task not found'
        }, status=404)
    except Exception as e:
        logger.error(f"Jira update status error: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@csrf_exempt
@login_required
@require_http_methods(["GET"])
def api_jira_test(request):
    """
    Тест подключения к Jira
    
    GET /api/jira/test/
    """
    try:
        connector = get_jira_connector()
        result = connector.test_connection()
        
        return JsonResponse(result)
    
    except Exception as e:
        logger.error(f"Jira test error: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@csrf_exempt
@login_required
@require_http_methods(["GET"])
def api_jira_projects(request):
    """
    Получить список проектов Jira
    
    GET /api/jira/projects/
    """
    try:
        connector = get_jira_connector()
        
        if not connector.available:
            return JsonResponse({
                'success': False,
                'error': 'Jira not configured'
            }, status=503)
        
        projects = connector.jira.projects()
        
        projects_data = []
        for project in projects:
            projects_data.append({
                'key': project.key,
                'name': project.name,
                'id': project.id,
            })
        
        return JsonResponse({
            'success': True,
            'projects': projects_data
        })
    
    except Exception as e:
        logger.error(f"Jira projects error: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)
