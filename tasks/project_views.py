"""
Views для управления проектами
"""
import json
import logging
from django.shortcuts import render, get_object_or_404, redirect
from django.urls import reverse
from django.http import JsonResponse, HttpResponseForbidden
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.http import require_http_methods, require_POST, require_GET
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q, Count
from django.utils import timezone
from django.core.paginator import Paginator

from .models import (
    Project, ProjectMember, ProjectMemberRole, ProjectInvitation,
    ProjectMaterial, ProjectMaterialType, Sprint, SprintStatus,
    SavedFilter, Task, TaskRelation, TaskRelationType,
    Team,
)
from .permissions import (
    ProjectPermissions, TaskPermissions,
    get_projects_for_user, get_tasks_for_user,
    require_project_view, require_project_edit, require_project_manage_members
)
from .email_service import TaskEmailService
from .notification_triggers import (
    notify_project_invitation,
    notify_project_role_changed,
    notify_project_member_left,
    notify_project_member_left_to_admins,
    notify_project_member_joined,
    notify_task_moved,
    notify_task_assigned,
    notify_sprint_started,
    notify_sprint_completed,
)

logger = logging.getLogger(__name__)


# =============================================================================
# PROJECT CRUD
# =============================================================================

@login_required
def project_list(request):
    """Список проектов пользователя"""
    projects = get_projects_for_user(request.user).annotate(
        task_count=Count('tasks'),
        member_count=Count('members')
    )

    # Фильтрация
    search = request.GET.get('search', '')
    if search:
        projects = projects.filter(
            Q(name__icontains=search) | Q(key__icontains=search)
        )

    # Показать архивные?
    show_archived = request.GET.get('archived') == '1'
    if not show_archived:
        projects = projects.filter(archived_at__isnull=True)

    context = {
        'projects': projects,
        'search': search,
        'show_archived': show_archived,
    }
    return render(request, 'tasks/projects/project_list.html', context)


@login_required
def project_list_api(request):
    """API: Список проектов"""
    projects = get_projects_for_user(request.user).annotate(
        task_count=Count('tasks'),
        open_task_count=Count('tasks', filter=~Q(tasks__status__in=['DONE', 'CANCELLED'])),
        member_count=Count('members')
    )

    data = [{
        'id': p.id,
        'name': p.name,
        'key': p.key,
        'description': p.description[:100] if p.description else '',
        'color': p.color,
        'icon': p.icon,
        'is_public': p.is_public,
        'task_count': p.task_count,
        'open_task_count': p.open_task_count,
        'member_count': p.member_count,
        'is_archived': p.archived_at is not None,
        'owner': {
            'id': p.owner.id,
            'username': p.owner.username,
        },
        'my_role': ProjectPermissions.get_user_role(request.user, p),
    } for p in projects]

    return JsonResponse({'projects': data})


@login_required
@require_http_methods(['GET', 'POST'])
def project_create(request):
    """Создание проекта. GET — редирект на список проектов (создание через модалку там)."""
    if request.method == 'GET':
        return redirect('tasks:project_list')

    # POST - создание
    try:
        data = json.loads(request.body) if request.content_type == 'application/json' else request.POST

        name = data.get('name', '').strip()
        key = data.get('key', '').strip().upper()
        description = data.get('description', '').strip()
        color = data.get('color', '#3B82F6')
        icon = data.get('icon', 'folder')
        is_public = data.get('is_public', False)
        if isinstance(is_public, str):
            is_public = is_public.lower() in ('true', '1', 'yes')

        if not name:
            return JsonResponse({'error': 'Название обязательно'}, status=400)
        if not key:
            return JsonResponse({'error': 'Ключ проекта обязателен'}, status=400)
        if len(key) > 10:
            return JsonResponse({'error': 'Ключ должен быть не более 10 символов'}, status=400)
        if not key.isalnum():
            return JsonResponse({'error': 'Ключ должен содержать только буквы и цифры'}, status=400)

        # Проверка уникальности ключа
        if Project.objects.filter(key=key).exists():
            return JsonResponse({'error': f'Проект с ключом {key} уже существует'}, status=400)

        project = Project.objects.create(
            name=name,
            key=key,
            description=description,
            color=color,
            icon=icon,
            is_public=is_public,
            owner=request.user,
        )

        # Добавляем создателя как владельца
        ProjectMember.objects.create(
            project=project,
            user=request.user,
            role=ProjectMemberRole.OWNER,
        )

        logger.info(f"Проект создан: {project.key} пользователем {request.user.username}")

        return JsonResponse({
            'success': True,
            'project': {
                'id': project.id,
                'name': project.name,
                'key': project.key,
            }
        })

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Неверный формат данных'}, status=400)
    except Exception as e:
        logger.error(f"Ошибка создания проекта: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_project_view
def project_detail(request, pk):
    """Детали проекта (доска)"""
    project = request.project

    # Получаем задачи проекта
    tasks = Task.objects.filter(project=project).select_related(
        'assignee', 'target_server', 'sprint'
    ).prefetch_related('label_relations__label', 'subtasks')

    # Фильтрация
    status_filter = request.GET.getlist('status')
    priority_filter = request.GET.getlist('priority')
    assignee_filter = request.GET.getlist('assignee')
    sprint_filter = request.GET.get('sprint')

    if status_filter:
        tasks = tasks.filter(status__in=status_filter)
    if priority_filter:
        tasks = tasks.filter(priority__in=priority_filter)
    if assignee_filter:
        if 'unassigned' in assignee_filter:
            tasks = tasks.filter(Q(assignee__isnull=True) | Q(assignee__in=assignee_filter))
        else:
            tasks = tasks.filter(assignee__in=assignee_filter)
    if sprint_filter:
        if sprint_filter == 'backlog':
            tasks = tasks.filter(sprint__isnull=True)
        else:
            tasks = tasks.filter(sprint_id=sprint_filter)

    # Группировка по статусам для Kanban
    tasks_by_status = {
        'TODO': tasks.filter(status='TODO'),
        'IN_PROGRESS': tasks.filter(status='IN_PROGRESS'),
        'BLOCKED': tasks.filter(status='BLOCKED'),
        'DONE': tasks.filter(status='DONE'),
    }

    # Участники для фильтра
    members = ProjectMember.objects.filter(project=project).select_related('user')

    # Активный спринт
    active_sprint = Sprint.objects.filter(
        project=project,
        status=SprintStatus.ACTIVE
    ).first()

    # Спринты для фильтра
    sprints = Sprint.objects.filter(project=project).order_by('-start_date')

    context = {
        'project': project,
        'tasks_by_status': tasks_by_status,
        'members': members,
        'active_sprint': active_sprint,
        'sprints': sprints,
        'sprint_filter': sprint_filter,
        'can_edit': ProjectPermissions.can_edit(request.user, project),
        'can_manage_members': ProjectPermissions.can_manage_members(request.user, project),
        'can_create_task': ProjectPermissions.can_create_task(request.user, project),
        'my_role': ProjectPermissions.get_user_role(request.user, project),
    }
    return render(request, 'tasks/projects/project_detail.html', context)


@login_required
@require_project_view
def project_backlog(request, pk):
    """Бэклог проекта — редирект на доску с фильтром «Бэклог» (задачи без спринта)."""
    return redirect(
        reverse('tasks:project_detail', args=[pk]) + '?sprint=backlog'
    )


@login_required
def project_settings_redirect(request, pk):
    """Редирект: настройки проекта теперь в разделе Settings (/settings/projects/<id>/)."""
    return redirect(reverse('settings_project', args=[pk]))


@login_required
@require_project_edit
@require_http_methods(['GET', 'POST'])
def project_settings(request, pk):
    """Настройки проекта (вызывается из /settings/projects/<pk>/)."""
    project = request.project

    if request.method == 'GET':
        members = ProjectMember.objects.filter(project=project).select_related('user')
        user_teams = Team.objects.filter(members__user=request.user).distinct().order_by('name')
        context = {
            'project': project,
            'members': members,
            'user_teams': user_teams,
            'can_delete': ProjectPermissions.can_delete_project(request.user, project),
        }
        return render(request, 'tasks/projects/project_settings.html', context)

    # POST - обновление
    try:
        data = json.loads(request.body) if request.content_type == 'application/json' else request.POST

        project.name = data.get('name', project.name).strip()
        project.description = data.get('description', project.description).strip()
        project.color = data.get('color', project.color)
        project.icon = data.get('icon', project.icon)

        is_public = data.get('is_public', project.is_public)
        if isinstance(is_public, str):
            is_public = is_public.lower() in ('true', '1', 'yes')
        project.is_public = is_public

        # Default assignee
        default_assignee_id = data.get('default_assignee_id')
        if default_assignee_id:
            project.default_assignee_id = default_assignee_id
        elif 'default_assignee_id' in data:
            project.default_assignee = None

        project.save()

        return JsonResponse({'success': True})

    except Exception as e:
        logger.error(f"Ошибка обновления проекта: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def project_delete(request, pk):
    """Удаление проекта"""
    project = get_object_or_404(Project, pk=pk)

    if not ProjectPermissions.can_delete_project(request.user, project):
        return JsonResponse({'error': 'Только владелец может удалить проект'}, status=403)

    project_name = project.name
    project.delete()

    logger.info(f"Проект удалён: {project_name} пользователем {request.user.username}")
    return JsonResponse({'success': True})


@login_required
@require_POST
def project_archive(request, pk):
    """Архивирование/разархивирование проекта"""
    project = get_object_or_404(Project, pk=pk)

    if not ProjectPermissions.can_archive_project(request.user, project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    if project.archived_at:
        project.archived_at = None
        action = 'разархивирован'
    else:
        project.archived_at = timezone.now()
        action = 'архивирован'

    project.save()

    logger.info(f"Проект {action}: {project.key} пользователем {request.user.username}")
    return JsonResponse({'success': True, 'archived': project.archived_at is not None})


# =============================================================================
# PROJECT MEMBERS
# =============================================================================

@login_required
@require_project_view
def project_members(request, pk):
    """Список участников проекта"""
    project = request.project
    members = ProjectMember.objects.filter(project=project).select_related('user', 'invited_by')

    data = [{
        'id': m.id,
        'user': {
            'id': m.user.id,
            'username': m.user.username,
            'email': m.user.email,
        },
        'role': m.role,
        'role_display': m.get_role_display(),
        'joined_at': m.joined_at.isoformat(),
        'invited_by': m.invited_by.username if m.invited_by else None,
        'can_edit': ProjectPermissions.can_manage_members(request.user, project),
    } for m in members]

    return JsonResponse({'members': data})


@login_required
@require_project_manage_members
@require_POST
def project_member_add(request, pk):
    """Добавить участника в проект"""
    project = request.project

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
        role = data.get('role', ProjectMemberRole.MEMBER)

        if not user_id:
            return JsonResponse({'error': 'user_id обязателен'}, status=400)

        user = get_object_or_404(User, pk=user_id)

        # Проверяем, не является ли уже участником
        if ProjectMember.objects.filter(project=project, user=user).exists():
            return JsonResponse({'error': 'Пользователь уже является участником'}, status=400)

        # Нельзя назначить владельцем
        if role == ProjectMemberRole.OWNER:
            return JsonResponse({'error': 'Нельзя назначить второго владельца'}, status=400)

        membership = ProjectMember.objects.create(
            project=project,
            user=user,
            role=role,
            invited_by=request.user,
        )

        # Отправляем email
        TaskEmailService.send_project_member_added(membership)

        return JsonResponse({
            'success': True,
            'member': {
                'id': membership.id,
                'user': {'id': user.id, 'username': user.username},
                'role': membership.role,
            }
        })

    except Exception as e:
        logger.error(f"Ошибка добавления участника: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_project_manage_members
@require_POST
def project_member_remove(request, pk, user_id):
    """Удалить участника из проекта"""
    project = request.project

    membership = get_object_or_404(ProjectMember, project=project, user_id=user_id)

    # Нельзя удалить владельца
    if membership.role == ProjectMemberRole.OWNER:
        return JsonResponse({'error': 'Нельзя удалить владельца проекта'}, status=400)

    # Нельзя удалить себя (если не владелец)
    if membership.user == request.user:
        my_role = ProjectPermissions.get_user_role(request.user, project)
        if my_role != ProjectMemberRole.OWNER:
            return JsonResponse({'error': 'Используйте функцию "Покинуть проект"'}, status=400)

    username = membership.user.username
    removed_user = membership.user
    membership.delete()

    notify_project_member_left(project, removed_user, removed_by=request.user)
    logger.info(f"Участник удалён: {username} из {project.key}")
    return JsonResponse({'success': True})


@login_required
@require_project_manage_members
@require_POST
def project_member_role(request, pk, user_id):
    """Изменить роль участника"""
    project = request.project

    try:
        data = json.loads(request.body)
        new_role = data.get('role')

        if new_role not in [r[0] for r in ProjectMemberRole.choices]:
            return JsonResponse({'error': 'Неверная роль'}, status=400)

        membership = get_object_or_404(ProjectMember, project=project, user_id=user_id)

        # Нельзя менять роль владельца
        if membership.role == ProjectMemberRole.OWNER:
            return JsonResponse({'error': 'Нельзя изменить роль владельца'}, status=400)

        # Нельзя сделать владельцем
        if new_role == ProjectMemberRole.OWNER:
            return JsonResponse({'error': 'Нельзя назначить владельцем'}, status=400)

        membership.role = new_role
        membership.save()

        notify_project_role_changed(project, membership.user, new_role)
        return JsonResponse({'success': True, 'role': new_role})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def project_leave(request, pk):
    """Покинуть проект"""
    project = get_object_or_404(Project, pk=pk)
    membership = ProjectMember.objects.filter(project=project, user=request.user).first()

    if not membership:
        return JsonResponse({'error': 'Вы не являетесь участником проекта'}, status=400)

    if membership.role == ProjectMemberRole.OWNER:
        return JsonResponse({'error': 'Владелец не может покинуть проект. Передайте права или удалите проект.'}, status=400)

    notify_project_member_left_to_admins(project, request.user)
    membership.delete()
    return JsonResponse({'success': True})


# =============================================================================
# INVITATIONS
# =============================================================================

@login_required
@require_project_manage_members
@require_POST
def project_invite(request, pk):
    """Отправить приглашение в проект"""
    project = request.project

    try:
        data = json.loads(request.body)
        email = data.get('email', '').strip().lower()
        role = data.get('role', ProjectMemberRole.MEMBER)
        message = data.get('message', '').strip()

        if not email:
            return JsonResponse({'error': 'Email обязателен'}, status=400)

        # Проверяем, есть ли пользователь с таким email
        user = User.objects.filter(email=email).first()

        # Если пользователь уже участник
        if user and ProjectMember.objects.filter(project=project, user=user).exists():
            return JsonResponse({'error': 'Пользователь уже является участником'}, status=400)

        # Проверяем, нет ли активного приглашения
        existing = ProjectInvitation.objects.filter(
            project=project,
            email=email,
            status='pending'
        ).first()
        if existing:
            return JsonResponse({'error': 'Приглашение уже отправлено'}, status=400)

        invitation = ProjectInvitation.objects.create(
            project=project,
            email=email,
            user=user,
            role=role,
            message=message,
            invited_by=request.user,
        )

        # Отправляем email
        TaskEmailService.send_project_invitation(invitation)
        # Push-уведомление зарегистрированному пользователю
        notify_project_invitation(invitation)

        return JsonResponse({
            'success': True,
            'invitation_id': invitation.id,
        })

    except Exception as e:
        logger.error(f"Ошибка отправки приглашения: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def invitation_respond(request, token):
    """Принять/отклонить приглашение"""
    invitation = get_object_or_404(ProjectInvitation, token=token)

    if request.method == 'GET':
        # Показываем страницу приглашения
        context = {
            'invitation': invitation,
            'is_expired': invitation.is_expired(),
            'is_pending': invitation.status == 'pending',
        }
        return render(request, 'tasks/projects/invitation_respond.html', context)

    # POST - принять/отклонить
    try:
        data = json.loads(request.body) if request.content_type == 'application/json' else request.POST
        action = data.get('action')

        if action == 'accept':
            invitation.accept(request.user)
            member = ProjectMember.objects.filter(
                project=invitation.project, user=request.user
            ).first()
            if member:
                notify_project_member_joined(
                    invitation.project, member, invited_by=invitation.invited_by
                )
                TaskEmailService.send_project_member_added(member)
            return JsonResponse({'success': True, 'project_id': invitation.project.id})
        elif action == 'decline':
            invitation.decline()
            return JsonResponse({'success': True})
        else:
            return JsonResponse({'error': 'Неверное действие'}, status=400)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


# =============================================================================
# MATERIALS
# =============================================================================

@login_required
@require_project_view
def project_materials(request, pk):
    """Материалы проекта"""
    project = request.project
    materials = ProjectMaterial.objects.filter(project=project).select_related('created_by')

    # Фильтр по типу
    material_type = request.GET.get('type')
    if material_type:
        materials = materials.filter(material_type=material_type)

    # Фильтр по папке
    folder = request.GET.get('folder')
    if folder:
        materials = materials.filter(folder=folder)

    # Получаем список папок
    folders = ProjectMaterial.objects.filter(
        project=project
    ).exclude(folder='').values_list('folder', flat=True).distinct()

    if request.headers.get('Accept') == 'application/json':
        data = [{
            'id': m.id,
            'title': m.title,
            'description': m.description,
            'material_type': m.material_type,
            'url': m.url,
            'file_url': m.file.url if m.file else None,
            'file_size': m.file_size,
            'folder': m.folder,
            'pinned': m.pinned,
            'created_by': m.created_by.username,
            'created_at': m.created_at.isoformat(),
        } for m in materials]
        return JsonResponse({'materials': data, 'folders': list(folders)})

    context = {
        'project': project,
        'materials': materials,
        'folders': folders,
        'can_add': ProjectPermissions.can_create_task(request.user, project),
    }
    return render(request, 'tasks/projects/project_materials.html', context)


@login_required
@require_POST
def material_add(request, pk):
    """Добавить материал"""
    project = get_object_or_404(Project, pk=pk)

    if not ProjectPermissions.can_create_task(request.user, project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        # Поддержка multipart/form-data для файлов
        title = request.POST.get('title', '').strip()
        description = request.POST.get('description', '').strip()
        material_type = request.POST.get('material_type', ProjectMaterialType.LINK)
        url = request.POST.get('url', '').strip()
        content = request.POST.get('content', '').strip()
        folder = request.POST.get('folder', '').strip()
        pinned = request.POST.get('pinned', 'false').lower() in ('true', '1', 'yes')

        if not title:
            return JsonResponse({'error': 'Название обязательно'}, status=400)

        material = ProjectMaterial(
            project=project,
            title=title,
            description=description,
            material_type=material_type,
            url=url,
            content=content,
            folder=folder,
            pinned=pinned,
            created_by=request.user,
        )

        # Обработка файла
        if 'file' in request.FILES:
            file = request.FILES['file']
            material.file = file
            material.file_size = file.size
            material.material_type = ProjectMaterialType.FILE

        material.save()

        return JsonResponse({
            'success': True,
            'material': {
                'id': material.id,
                'title': material.title,
            }
        })

    except Exception as e:
        logger.error(f"Ошибка добавления материала: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def material_detail(request, pk):
    """Детали материала"""
    material = get_object_or_404(ProjectMaterial, pk=pk)

    if not ProjectPermissions.can_view(request.user, material.project):
        return HttpResponseForbidden('Недостаточно прав')

    if request.method == 'GET':
        data = {
            'id': material.id,
            'title': material.title,
            'description': material.description,
            'material_type': material.material_type,
            'url': material.url,
            'content': material.content,
            'file_url': material.file.url if material.file else None,
            'file_size': material.file_size,
            'folder': material.folder,
            'pinned': material.pinned,
            'created_by': material.created_by.username,
            'created_at': material.created_at.isoformat(),
            'updated_at': material.updated_at.isoformat(),
        }
        return JsonResponse(data)

    # POST - обновление
    if not ProjectPermissions.can_create_task(request.user, material.project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        data = json.loads(request.body)
        material.title = data.get('title', material.title).strip()
        material.description = data.get('description', material.description).strip()
        material.url = data.get('url', material.url).strip()
        material.content = data.get('content', material.content)
        material.folder = data.get('folder', material.folder).strip()
        material.pinned = data.get('pinned', material.pinned)
        material.save()

        return JsonResponse({'success': True})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def material_delete(request, pk):
    """Удалить материал"""
    material = get_object_or_404(ProjectMaterial, pk=pk)

    if not ProjectPermissions.can_edit(request.user, material.project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    material.delete()
    return JsonResponse({'success': True})


# =============================================================================
# SPRINTS
# =============================================================================

@login_required
@require_project_view
def sprint_list(request, pk):
    """Список спринтов проекта"""
    project = request.project
    sprints = Sprint.objects.filter(project=project).annotate(
        task_count=Count('tasks'),
        completed_task_count=Count('tasks', filter=Q(tasks__status='DONE'))
    )

    if request.headers.get('Accept') == 'application/json':
        data = [{
            'id': s.id,
            'name': s.name,
            'goal': s.goal,
            'status': s.status,
            'status_display': s.get_status_display(),
            'start_date': s.start_date.isoformat() if s.start_date else None,
            'end_date': s.end_date.isoformat() if s.end_date else None,
            'task_count': s.task_count,
            'completed_task_count': s.completed_task_count,
            'progress': int((s.completed_task_count / s.task_count * 100) if s.task_count > 0 else 0),
        } for s in sprints]
        return JsonResponse({'sprints': data})

    context = {
        'project': project,
        'sprints': sprints,
        'can_edit': ProjectPermissions.can_edit(request.user, project),
    }
    return render(request, 'tasks/projects/sprint_list.html', context)


@login_required
@require_POST
def sprint_create(request, pk):
    """Создать спринт"""
    project = get_object_or_404(Project, pk=pk)

    if not ProjectPermissions.can_edit(request.user, project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        data = json.loads(request.body)
        name = data.get('name', '').strip()
        goal = data.get('goal', '').strip()
        start_date = data.get('start_date')
        end_date = data.get('end_date')

        if not name:
            return JsonResponse({'error': 'Название обязательно'}, status=400)

        sprint = Sprint.objects.create(
            project=project,
            name=name,
            goal=goal,
            start_date=start_date,
            end_date=end_date,
            created_by=request.user,
        )

        return JsonResponse({
            'success': True,
            'sprint': {
                'id': sprint.id,
                'name': sprint.name,
            }
        })

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def sprint_detail(request, pk):
    """Детали спринта"""
    sprint = get_object_or_404(Sprint, pk=pk)

    if not ProjectPermissions.can_view(request.user, sprint.project):
        return HttpResponseForbidden('Недостаточно прав')

    tasks = Task.objects.filter(sprint=sprint).select_related('assignee')

    if request.headers.get('Accept') == 'application/json':
        data = {
            'id': sprint.id,
            'name': sprint.name,
            'goal': sprint.goal,
            'status': sprint.status,
            'start_date': sprint.start_date.isoformat() if sprint.start_date else None,
            'end_date': sprint.end_date.isoformat() if sprint.end_date else None,
            'tasks': [{
                'id': t.id,
                'task_key': t.task_key,
                'title': t.title,
                'status': t.status,
                'assignee': t.assignee.username if t.assignee else None,
            } for t in tasks],
            'progress': sprint.get_progress_percentage(),
        }
        return JsonResponse(data)

    context = {
        'sprint': sprint,
        'project': sprint.project,
        'tasks': tasks,
        'can_edit': ProjectPermissions.can_edit(request.user, sprint.project),
    }
    return render(request, 'tasks/projects/sprint_detail.html', context)


@login_required
@require_POST
def sprint_start(request, pk):
    """Начать спринт"""
    sprint = get_object_or_404(Sprint, pk=pk)

    if not ProjectPermissions.can_edit(request.user, sprint.project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        sprint.start()
        TaskEmailService.send_sprint_started(sprint)
        notify_sprint_started(sprint)
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@login_required
@require_POST
def sprint_complete(request, pk):
    """Завершить спринт"""
    sprint = get_object_or_404(Sprint, pk=pk)

    if not ProjectPermissions.can_edit(request.user, sprint.project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        sprint.complete()
        notify_sprint_completed(sprint)
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@login_required
@require_POST
def sprint_add_tasks(request, pk):
    """Добавить задачи в спринт"""
    sprint = get_object_or_404(Sprint, pk=pk)

    if not ProjectPermissions.can_edit(request.user, sprint.project):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        data = json.loads(request.body)
        task_ids = data.get('task_ids', [])

        Task.objects.filter(
            id__in=task_ids,
            project=sprint.project
        ).update(sprint=sprint)

        return JsonResponse({'success': True})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


# =============================================================================
# SAVED FILTERS
# =============================================================================

@login_required
def filter_list(request):
    """Список сохранённых фильтров"""
    filters = SavedFilter.objects.filter(user=request.user)

    project_id = request.GET.get('project')
    if project_id:
        filters = filters.filter(Q(project_id=project_id) | Q(project__isnull=True))

    data = [{
        'id': f.id,
        'name': f.name,
        'filter_config': f.filter_config,
        'is_default': f.is_default,
        'project_id': f.project_id,
    } for f in filters]

    return JsonResponse({'filters': data})


@login_required
@require_POST
def filter_save(request):
    """Сохранить фильтр"""
    try:
        data = json.loads(request.body)
        name = data.get('name', '').strip()
        filter_config = data.get('filter_config', {})
        project_id = data.get('project_id')
        is_default = data.get('is_default', False)

        if not name:
            return JsonResponse({'error': 'Название обязательно'}, status=400)

        # Если ставим по умолчанию, сбрасываем предыдущий
        if is_default:
            SavedFilter.objects.filter(
                user=request.user,
                project_id=project_id,
                is_default=True
            ).update(is_default=False)

        saved_filter = SavedFilter.objects.create(
            user=request.user,
            project_id=project_id,
            name=name,
            filter_config=filter_config,
            is_default=is_default,
        )

        return JsonResponse({
            'success': True,
            'filter_id': saved_filter.id,
        })

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def filter_delete(request, pk):
    """Удалить фильтр"""
    saved_filter = get_object_or_404(SavedFilter, pk=pk, user=request.user)
    saved_filter.delete()
    return JsonResponse({'success': True})


# =============================================================================
# TASK RELATIONS
# =============================================================================

@login_required
@require_POST
def task_link(request, pk):
    """Связать задачи"""
    task = get_object_or_404(Task, pk=pk)

    if not TaskPermissions.can_edit(request.user, task):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        data = json.loads(request.body)
        to_task_id = data.get('to_task_id')
        relation_type = data.get('relation_type', TaskRelationType.RELATES_TO)

        to_task = get_object_or_404(Task, pk=to_task_id)

        # Проверяем права на целевую задачу
        if not TaskPermissions.can_view(request.user, to_task):
            return JsonResponse({'error': 'Нет доступа к целевой задаче'}, status=403)

        # Создаём связь
        relation, created = TaskRelation.objects.get_or_create(
            from_task=task,
            to_task=to_task,
            relation_type=relation_type,
            defaults={'created_by': request.user}
        )

        if not created:
            return JsonResponse({'error': 'Связь уже существует'}, status=400)

        return JsonResponse({
            'success': True,
            'relation_id': relation.id,
        })

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def task_unlink(request, pk, relation_id):
    """Удалить связь между задачами"""
    task = get_object_or_404(Task, pk=pk)

    if not TaskPermissions.can_edit(request.user, task):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    relation = get_object_or_404(TaskRelation, pk=relation_id, from_task=task)
    relation.delete()

    return JsonResponse({'success': True})


# =============================================================================
# TASK WATCHERS
# =============================================================================

@login_required
def task_watchers(request, pk):
    """Управление наблюдателями задачи"""
    task = get_object_or_404(Task, pk=pk)

    if not TaskPermissions.can_view(request.user, task):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    if request.method == 'GET':
        watchers = task.watchers.all()
        data = [{
            'id': w.id,
            'username': w.username,
        } for w in watchers]
        return JsonResponse({
            'watchers': data,
            'is_watching': task.is_watching(request.user),
        })

    # POST - добавить/удалить наблюдателя
    try:
        data = json.loads(request.body)
        action = data.get('action')  # 'add' or 'remove'
        user_id = data.get('user_id', request.user.id)

        if action == 'add':
            task.watchers.add(user_id)
        elif action == 'remove':
            task.watchers.remove(user_id)
        else:
            return JsonResponse({'error': 'Неверное действие'}, status=400)

        return JsonResponse({'success': True})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def task_move(request, pk):
    """Переместить задачу в другой проект"""
    task = get_object_or_404(Task, pk=pk)

    if not TaskPermissions.can_edit(request.user, task):
        return JsonResponse({'error': 'Недостаточно прав'}, status=403)

    try:
        data = json.loads(request.body)
        new_project_id = data.get('project_id')
        old_project = task.project

        if new_project_id:
            new_project = get_object_or_404(Project, pk=new_project_id)
            if not ProjectPermissions.can_create_task(request.user, new_project):
                return JsonResponse({'error': 'Нет прав на создание задач в целевом проекте'}, status=403)

            task.project = new_project
            task.task_key = new_project.get_next_task_key()
            task.sprint = None
        else:
            new_project = None
            task.project = None
            task.task_key = ''
            task.sprint = None

        task.save()

        if old_project != task.project:
            notify_task_moved(task, old_project, task.project, request.user)

        return JsonResponse({
            'success': True,
            'task_key': task.task_key,
        })

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


# =============================================================================
# BULK OPERATIONS
# =============================================================================

@login_required
@require_POST
def tasks_bulk_action(request):
    """Массовые операции с задачами"""
    try:
        data = json.loads(request.body)
        task_ids = data.get('task_ids', [])
        action = data.get('action')

        if not task_ids:
            return JsonResponse({'error': 'Не выбраны задачи'}, status=400)

        tasks = Task.objects.filter(id__in=task_ids)

        # Проверяем права на все задачи
        for task in tasks:
            if not TaskPermissions.can_edit(request.user, task):
                return JsonResponse({'error': f'Нет прав на задачу {task.get_display_id()}'}, status=403)

        if action == 'change_status':
            new_status = data.get('status')
            tasks.update(status=new_status)

        elif action == 'change_priority':
            new_priority = data.get('priority')
            tasks.update(priority=new_priority)

        elif action == 'assign':
            assignee_id = data.get('assignee_id')
            tasks.update(assignee_id=assignee_id)
            if assignee_id and assignee_id != request.user.id:
                assignee = User.objects.filter(id=assignee_id).first()
                if assignee:
                    for t in Task.objects.filter(id__in=task_ids):
                        notify_task_assigned(t, assignee, request.user)

        elif action == 'move_to_sprint':
            sprint_id = data.get('sprint_id')
            tasks.update(sprint_id=sprint_id)

        elif action == 'delete':
            count = tasks.count()
            tasks.delete()
            return JsonResponse({'success': True, 'deleted': count})

        else:
            return JsonResponse({'error': 'Неизвестное действие'}, status=400)

        return JsonResponse({'success': True, 'updated': tasks.count()})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
