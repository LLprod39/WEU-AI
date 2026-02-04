"""
Триггеры уведомлений: создание TaskNotification и отправка email при событиях.
"""
import re
from django.urls import reverse
from django.contrib.auth.models import User

from .models import TaskNotification, ProjectMember, ProjectMemberRole


def notify_project_invitation(invitation):
    """Уведомление приглашённому пользователю (если зарегистрирован)."""
    if not invitation.user_id:
        return
    try:
        url = reverse('tasks:invitation_respond', args=[invitation.token])
        TaskNotification.objects.create(
            user=invitation.user,
            notification_type='PROJECT_INVITATION',
            title=f'Приглашение в проект {invitation.project.name}',
            message=f'{invitation.invited_by.username} приглашает вас в проект «{invitation.project.name}».',
            task=None,
            action_url=url,
            action_data={'invitation_id': invitation.id, 'project_id': invitation.project_id},
        )
    except Exception:
        pass


def notify_project_role_changed(project, user, new_role):
    """Уведомление пользователю об изменении его роли в проекте."""
    try:
        role_display = dict(ProjectMemberRole.choices).get(new_role, new_role)
        TaskNotification.objects.create(
            user=user,
            notification_type='PROJECT_ROLE_CHANGED',
            title=f'Роль в проекте {project.name} изменена',
            message=f'Ваша роль в проекте «{project.name}» изменена на «{role_display}».',
            task=None,
            action_url=reverse('tasks:project_detail', args=[project.id]),
        )
    except Exception:
        pass


def notify_project_member_left(project, user, removed_by=None):
    """Уведомление пользователю, что его удалили из проекта (не при добровольном выходе)."""
    try:
        if removed_by and removed_by != user:
            msg = f'{removed_by.username} удалил вас из проекта «{project.name}».'
            TaskNotification.objects.create(
                user=user,
                notification_type='PROJECT_MEMBER_LEFT',
                title=f'Удаление из проекта {project.name}',
                message=msg,
                task=None,
                action_url=reverse('tasks:project_list'),
            )
    except Exception:
        pass


def notify_project_member_left_to_admins(project, user_who_left):
    """Уведомление владельцу/админам, что участник покинул проект."""
    try:
        admins = ProjectMember.objects.filter(
            project=project,
            role__in=[ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]
        ).exclude(user=user_who_left).values_list('user_id', flat=True)
        for uid in admins:
            TaskNotification.objects.create(
                user_id=uid,
                notification_type='PROJECT_MEMBER_LEFT',
                task=None,
                title=f'Участник покинул проект {project.name}',
                message=f'{user_who_left.username} покинул проект «{project.name}».',
                action_url=reverse('tasks:project_detail', args=[project.id]),
            )
    except Exception:
        pass


def notify_project_member_joined(project, new_member, invited_by=None):
    """Уведомление владельцу/админам о новом участнике проекта."""
    try:
        admins = ProjectMember.objects.filter(
            project=project,
            role__in=[ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]
        ).exclude(user=new_member.user).values_list('user', flat=True)
        who = invited_by.username if invited_by else new_member.user.username
        for admin_id in admins:
            TaskNotification.objects.create(
                user_id=admin_id,
                notification_type='PROJECT_MEMBER_JOINED',
                title=f'Новый участник в {project.name}',
                message=f'{who} присоединился к проекту «{project.name}».',
                task=None,
                action_url=reverse('tasks:project_detail', args=[project.id]),
            )
    except Exception:
        pass


def notify_task_assigned(task, assignee, assigned_by):
    """Уведомление о назначении задачи (push + email, если назначен не сам себе)."""
    if not assignee or assignee == assigned_by:
        return
    try:
        TaskNotification.objects.create(
            user=assignee,
            notification_type='TASK_ASSIGNED',
            task=task,
            title=f'Вам назначена задача {task.get_display_id()}',
            message=f'{assigned_by.username} назначил вам задачу: {task.title}',
            action_url=reverse('tasks:task_list') + f'?project={task.project_id}' if task.project_id else reverse('tasks:task_list'),
        )
        from .email_service import TaskEmailService
        TaskEmailService.send_task_assigned(task, assigned_by)
    except Exception:
        pass


def notify_task_moved(task, old_project, new_project, moved_by):
    """Уведомление assignee и watchers о перемещении задачи."""
    try:
        users_to_notify = set()
        if task.assignee_id:
            users_to_notify.add(task.assignee_id)
        for w in task.watchers.values_list('id', flat=True):
            users_to_notify.add(w)
        users_to_notify.discard(moved_by.id)
        old_name = old_project.name if old_project else 'личные'
        new_name = new_project.name if new_project else 'личные'
        for uid in users_to_notify:
            TaskNotification.objects.create(
                user_id=uid,
                notification_type='TASK_MOVED',
                task=task,
                title=f'Задача {task.get_display_id()} перемещена',
                message=f'Задача «{task.title}» перемещена из «{old_name}» в «{new_name}».',
                action_url=reverse('tasks:task_list') + (f'?project={task.project_id}' if task.project_id else ''),
            )
    except Exception:
        pass


def notify_task_watching(task, updated_by, summary='Обновление задачи'):
    """Уведомление наблюдателям об обновлении задачи (кроме автора изменения)."""
    try:
        user_ids = set(task.watchers.values_list('id', flat=True))
        if task.assignee_id and task.assignee_id != updated_by.id:
            user_ids.add(task.assignee_id)
        user_ids.discard(updated_by.id)
        for uid in user_ids:
            TaskNotification.objects.create(
                user_id=uid,
                notification_type='TASK_WATCHING',
                task=task,
                title=f'Обновление: {task.get_display_id()}',
                message=f'{updated_by.username}: {summary}',
                action_url=reverse('tasks:task_list') + (f'?project={task.project_id}' if task.project_id else ''),
            )
    except Exception:
        pass


def notify_sprint_started(sprint):
    """Уведомление участникам проекта о старте спринта."""
    try:
        members = ProjectMember.objects.filter(project=sprint.project).values_list('user_id', flat=True)
        for uid in members:
            TaskNotification.objects.create(
                user_id=uid,
                notification_type='SPRINT_STARTED',
                task=None,
                title=f'Спринт «{sprint.name}» начат',
                message=f'Спринт «{sprint.name}» в проекте {sprint.project.name} начат.',
                action_url=reverse('tasks:project_detail', args=[sprint.project_id]) + f'?sprint={sprint.id}',
            )
    except Exception:
        pass


def notify_mentioned_in_comment(task, comment_content, author):
    """Уведомление пользователям, упомянутым в комментарии (@username) — push + email."""
    mentions = re.findall(r'@(\w+)', comment_content)
    if not mentions:
        return
    try:
        from .email_service import TaskEmailService
        users = User.objects.filter(username__in=mentions).exclude(id=author.id)
        preview = comment_content[:100] + ('…' if len(comment_content) > 100 else '')
        for user in users:
            TaskNotification.objects.create(
                user=user,
                notification_type='TASK_MENTIONED',
                task=task,
                title=f'Упоминание в задаче {task.get_display_id()}',
                message=f'{author.username} упомянул вас: {preview}',
                action_url=reverse('tasks:task_list') + (f'?project={task.project_id}' if task.project_id else ''),
            )
            TaskEmailService.send_task_mentioned(task, user, author, comment_content)
    except Exception:
        pass


def notify_sprint_completed(sprint):
    """Уведомление участникам проекта о завершении спринта."""
    try:
        members = ProjectMember.objects.filter(project=sprint.project).values_list('user_id', flat=True)
        for uid in members:
            TaskNotification.objects.create(
                user_id=uid,
                notification_type='SPRINT_COMPLETED',
                task=None,
                title=f'Спринт «{sprint.name}» завершён',
                message=f'Спринт «{sprint.name}» в проекте {sprint.project.name} завершён.',
                action_url=reverse('tasks:sprint_list', args=[sprint.project_id]),
            )
    except Exception:
        pass
