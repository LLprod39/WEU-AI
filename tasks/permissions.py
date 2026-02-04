"""
Система прав доступа для проектов и задач
"""
from django.db.models import Q
from functools import wraps
from django.http import JsonResponse, HttpResponseForbidden


class ProjectPermissions:
    """Проверка прав доступа к проекту"""

    @staticmethod
    def can_view(user, project):
        """Может просматривать проект"""
        if not user.is_authenticated:
            return False
        if project.is_public:
            return True
        from .models import ProjectMember
        return ProjectMember.objects.filter(project=project, user=user).exists()

    @staticmethod
    def can_edit(user, project):
        """Может редактировать настройки проекта"""
        if not user.is_authenticated:
            return False
        from .models import ProjectMember, ProjectMemberRole
        return ProjectMember.objects.filter(
            project=project,
            user=user,
            role__in=[ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]
        ).exists()

    @staticmethod
    def can_manage_members(user, project):
        """Может управлять участниками"""
        if not user.is_authenticated:
            return False
        from .models import ProjectMember, ProjectMemberRole
        return ProjectMember.objects.filter(
            project=project,
            user=user,
            role__in=[ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]
        ).exists()

    @staticmethod
    def can_create_task(user, project):
        """Может создавать задачи"""
        if not user.is_authenticated:
            return False
        from .models import ProjectMember, ProjectMemberRole
        return ProjectMember.objects.filter(
            project=project,
            user=user,
            role__in=[ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN, ProjectMemberRole.MEMBER]
        ).exists()

    @staticmethod
    def can_delete_project(user, project):
        """Может удалить проект"""
        if not user.is_authenticated:
            return False
        return project.owner == user

    @staticmethod
    def can_archive_project(user, project):
        """Может архивировать проект"""
        return ProjectPermissions.can_edit(user, project)

    @staticmethod
    def get_user_role(user, project):
        """Получить роль пользователя в проекте"""
        if not user.is_authenticated:
            return None
        from .models import ProjectMember
        membership = ProjectMember.objects.filter(project=project, user=user).first()
        return membership.role if membership else None


class TaskPermissions:
    """Проверка прав на задачу"""

    @staticmethod
    def can_view(user, task):
        """Может просматривать задачу"""
        if not user.is_authenticated:
            return False

        # Задача без проекта — личная
        if not task.project:
            return (
                task.created_by == user or
                task.assignee == user or
                task.watchers.filter(pk=user.pk).exists()
            )

        # Задача в проекте — по правам проекта
        return ProjectPermissions.can_view(user, task.project)

    @staticmethod
    def can_edit(user, task):
        """Может редактировать задачу"""
        if not user.is_authenticated:
            return False

        # Задача без проекта
        if not task.project:
            return task.created_by == user or task.assignee == user

        # В проекте — админы/владельцы могут всё, остальные — свои задачи
        from .models import ProjectMember, ProjectMemberRole
        membership = ProjectMember.objects.filter(
            project=task.project,
            user=user
        ).first()

        if not membership:
            return False

        if membership.role in [ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]:
            return True

        return task.created_by == user or task.assignee == user

    @staticmethod
    def can_delete(user, task):
        """Может удалить задачу"""
        if not user.is_authenticated:
            return False

        # Задача без проекта
        if not task.project:
            return task.created_by == user

        # В проекте
        from .models import ProjectMember, ProjectMemberRole
        membership = ProjectMember.objects.filter(
            project=task.project,
            user=user
        ).first()

        if not membership:
            return False

        if membership.role in [ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]:
            return True

        return task.created_by == user

    @staticmethod
    def can_assign(user, task):
        """Может назначать задачу"""
        if not user.is_authenticated:
            return False

        if not task.project:
            return task.created_by == user

        from .models import ProjectMember, ProjectMemberRole
        return ProjectMember.objects.filter(
            project=task.project,
            user=user,
            role__in=[ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN, ProjectMemberRole.MEMBER]
        ).exists()

    @staticmethod
    def can_change_status(user, task):
        """Может менять статус задачи"""
        return TaskPermissions.can_edit(user, task)


def get_projects_for_user(user):
    """Получить проекты, доступные пользователю"""
    if not user.is_authenticated:
        from .models import Project
        return Project.objects.none()

    from .models import Project
    return Project.objects.filter(
        Q(is_public=True) |
        Q(members__user=user)
    ).distinct()


def get_tasks_for_user(user, project=None, include_personal=True):
    """Получить задачи с учётом прав"""
    if not user.is_authenticated:
        from .models import Task
        return Task.objects.none()

    from .models import Task

    projects = get_projects_for_user(user)

    if include_personal:
        qs = Task.objects.filter(
            Q(project__in=projects) |
            Q(project__isnull=True, created_by=user) |
            Q(project__isnull=True, assignee=user) |
            Q(project__isnull=True, watchers=user)
        )
    else:
        qs = Task.objects.filter(project__in=projects)

    if project:
        qs = qs.filter(project=project)

    return qs.distinct()


def get_project_members_as_choices(project):
    """Получить участников проекта для dropdown"""
    from .models import ProjectMember
    members = ProjectMember.objects.filter(project=project).select_related('user')
    return [(m.user.id, m.user.username) for m in members]


# =============================================================================
# DECORATORS
# =============================================================================

def require_project_permission(permission_func):
    """Декоратор для проверки прав на проект"""
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, pk=None, project_id=None, *args, **kwargs):
            from .models import Project
            pid = pk or project_id
            try:
                project = Project.objects.get(pk=pid)
            except Project.DoesNotExist:
                return JsonResponse({'error': 'Проект не найден'}, status=404)

            if not permission_func(request.user, project):
                return HttpResponseForbidden('Недостаточно прав')

            request.project = project
            return view_func(request, pk=pid, *args, **kwargs)
        return _wrapped_view
    return decorator


def require_task_permission(permission_func):
    """Декоратор для проверки прав на задачу"""
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, pk=None, task_id=None, *args, **kwargs):
            from .models import Task
            tid = pk or task_id
            try:
                task = Task.objects.get(pk=tid)
            except Task.DoesNotExist:
                return JsonResponse({'error': 'Задача не найдена'}, status=404)

            if not permission_func(request.user, task):
                return HttpResponseForbidden('Недостаточно прав')

            request.task = task
            return view_func(request, pk=tid, *args, **kwargs)
        return _wrapped_view
    return decorator


# Shortcut decorators
require_project_view = require_project_permission(ProjectPermissions.can_view)
require_project_edit = require_project_permission(ProjectPermissions.can_edit)
require_project_manage_members = require_project_permission(ProjectPermissions.can_manage_members)
require_project_delete = require_project_permission(ProjectPermissions.can_delete_project)

require_task_view = require_task_permission(TaskPermissions.can_view)
require_task_edit = require_task_permission(TaskPermissions.can_edit)
require_task_delete = require_task_permission(TaskPermissions.can_delete)
