"""
Core UI models: app-level permissions for users and chat sessions.
"""
from django.db import models
from django.contrib.auth.models import User


# -----------------------------------------
# Chat history
# -----------------------------------------


class ChatSession(models.Model):
    """Сессия чата — список сообщений одного диалога."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_sessions')
    title = models.CharField(max_length=200, default='Новый чат')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.user.username}: {self.title}"


class ChatMessage(models.Model):
    """Одно сообщение в сессии чата."""
    ROLE_USER = 'user'
    ROLE_ASSISTANT = 'assistant'
    ROLE_CHOICES = [(ROLE_USER, 'User'), (ROLE_ASSISTANT, 'Assistant')]

    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.session_id} [{self.role}]: {self.content[:50]}..."


# -----------------------------------------
# Permissions
# -----------------------------------------


FEATURE_CHOICES = [
    ('agents', 'Agents'),
    ('orchestrator', 'Orchestrator'),
    ('servers', 'Servers'),
    ('tasks', 'Tasks'),
    ('knowledge_base', 'Knowledge Base'),
    ('settings', 'Settings'),
]

# Features allowed by default for new users (settings is never default — only is_staff or explicit grant)
DEFAULT_ALLOWED_FEATURES = {'agents', 'orchestrator', 'servers', 'tasks', 'knowledge_base'}


class UserAppPermission(models.Model):
    """Per-user, per-feature permission. Used for flexible access to app sections (tabs)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='app_permissions')
    feature = models.CharField(max_length=30, choices=FEATURE_CHOICES)
    allowed = models.BooleanField(default=True)

    class Meta:
        unique_together = ['user', 'feature']
        ordering = ['user', 'feature']
        indexes = [
            models.Index(fields=['user', 'feature']),
        ]

    def __str__(self):
        return f"{self.user.username} / {self.feature} = {self.allowed}"
