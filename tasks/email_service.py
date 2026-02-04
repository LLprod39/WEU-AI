"""
Email-уведомления для проектов и задач
"""
import logging
from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.urls import reverse

logger = logging.getLogger(__name__)


class TaskEmailService:
    """Сервис отправки email-уведомлений"""

    @staticmethod
    def get_base_url():
        """Получить базовый URL сайта"""
        return getattr(settings, 'SITE_URL', 'http://localhost:9000')

    @classmethod
    def send_project_invitation(cls, invitation):
        """Отправить приглашение в проект"""
        try:
            base_url = cls.get_base_url()
            accept_url = f"{base_url}/tasks/invitations/{invitation.token}/"

            context = {
                'project': invitation.project,
                'invited_by': invitation.invited_by,
                'role': invitation.get_role_display(),
                'message': invitation.message,
                'accept_url': accept_url,
                'expires_at': invitation.expires_at,
            }

            subject = f"Приглашение в проект {invitation.project.name}"
            html_message = render_to_string('tasks/emails/project_invitation.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=subject,
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[invitation.email],
                html_message=html_message,
                fail_silently=False,
            )
            logger.info(f"Приглашение отправлено: {invitation.email} в {invitation.project.key}")
            return True
        except Exception as e:
            logger.error(f"Ошибка отправки приглашения: {e}")
            return False

    @classmethod
    def send_task_assigned(cls, task, assigned_by):
        """Уведомление о назначении задачи"""
        if not task.assignee or not task.assignee.email:
            return False

        try:
            base_url = cls.get_base_url()
            task_url = f"{base_url}/tasks/"  # Will be updated when we have project views

            context = {
                'task': task,
                'assigned_by': assigned_by,
                'task_url': task_url,
            }

            subject = f"Вам назначена задача: {task.get_display_id()}"
            html_message = render_to_string('tasks/emails/task_assigned.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=subject,
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[task.assignee.email],
                html_message=html_message,
                fail_silently=False,
            )
            logger.info(f"Уведомление о назначении отправлено: {task.assignee.email}")
            return True
        except Exception as e:
            logger.error(f"Ошибка отправки уведомления о назначении: {e}")
            return False

    @classmethod
    def send_task_mentioned(cls, task, mentioned_user, commenter, comment_text):
        """Уведомление об упоминании в комментарии"""
        if not mentioned_user.email:
            return False

        try:
            base_url = cls.get_base_url()
            task_url = f"{base_url}/tasks/"

            context = {
                'task': task,
                'mentioned_user': mentioned_user,
                'commenter': commenter,
                'comment_text': comment_text[:200],
                'task_url': task_url,
            }

            subject = f"Вас упомянули в задаче: {task.get_display_id()}"
            html_message = render_to_string('tasks/emails/task_mentioned.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=subject,
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[mentioned_user.email],
                html_message=html_message,
                fail_silently=False,
            )
            return True
        except Exception as e:
            logger.error(f"Ошибка отправки уведомления об упоминании: {e}")
            return False

    @classmethod
    def send_task_status_changed(cls, task, old_status, changed_by):
        """Уведомление watchers об изменении статуса"""
        watchers_emails = list(
            task.watchers.exclude(pk=changed_by.pk)
            .values_list('email', flat=True)
            .exclude(email='')
        )

        if not watchers_emails:
            return True

        try:
            base_url = cls.get_base_url()
            task_url = f"{base_url}/tasks/"

            context = {
                'task': task,
                'old_status': old_status,
                'new_status': task.get_status_display(),
                'changed_by': changed_by,
                'task_url': task_url,
            }

            subject = f"Статус задачи изменён: {task.get_display_id()}"
            html_message = render_to_string('tasks/emails/task_status_changed.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=subject,
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=watchers_emails,
                html_message=html_message,
                fail_silently=False,
            )
            return True
        except Exception as e:
            logger.error(f"Ошибка отправки уведомления об изменении статуса: {e}")
            return False

    @classmethod
    def send_sprint_started(cls, sprint):
        """Уведомление о начале спринта"""
        from .models import ProjectMember

        members = ProjectMember.objects.filter(
            project=sprint.project,
            notify_on_new_task=True
        ).select_related('user')

        emails = [m.user.email for m in members if m.user.email]

        if not emails:
            return True

        try:
            base_url = cls.get_base_url()

            context = {
                'sprint': sprint,
                'project': sprint.project,
                'sprint_url': f"{base_url}/tasks/projects/{sprint.project.pk}/sprints/",
            }

            subject = f"Спринт начат: {sprint.name} ({sprint.project.key})"
            html_message = render_to_string('tasks/emails/sprint_started.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=subject,
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=emails,
                html_message=html_message,
                fail_silently=False,
            )
            return True
        except Exception as e:
            logger.error(f"Ошибка отправки уведомления о спринте: {e}")
            return False

    @classmethod
    def send_project_member_added(cls, membership):
        """Уведомление о добавлении в проект"""
        if not membership.user.email:
            return False

        try:
            base_url = cls.get_base_url()

            context = {
                'project': membership.project,
                'user': membership.user,
                'role': membership.get_role_display(),
                'invited_by': membership.invited_by,
                'project_url': f"{base_url}/tasks/projects/{membership.project.pk}/",
            }

            subject = f"Вы добавлены в проект: {membership.project.name}"
            html_message = render_to_string('tasks/emails/project_member_added.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=subject,
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[membership.user.email],
                html_message=html_message,
                fail_silently=False,
            )
            return True
        except Exception as e:
            logger.error(f"Ошибка отправки уведомления о добавлении в проект: {e}")
            return False
