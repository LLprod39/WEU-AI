from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.exceptions import ValidationError


class TaskPriority(models.TextChoices):
    HIGH = 'HIGH', 'High'
    MEDIUM = 'MEDIUM', 'Medium'
    LOW = 'LOW', 'Low'


class Task(models.Model):
    STATUS_CHOICES = [
        ('TODO', 'To Do'),
        ('IN_PROGRESS', 'In Progress'),
        ('DONE', 'Done'),
        ('BLOCKED', 'Blocked'),
        ('CANCELLED', 'Cancelled'),
    ]

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='TODO')
    priority = models.CharField(
        max_length=10, 
        choices=TaskPriority.choices, 
        default=TaskPriority.MEDIUM
    )
    assignee = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='assigned_tasks'
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_tasks'
    )
    due_date = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # AI Assignment
    assigned_to_ai = models.BooleanField(default=False, help_text="Назначена ли задача на ИИ")
    ai_agent_type = models.CharField(
        max_length=50, 
        blank=True, 
        null=True,
        help_text="Тип агента для выполнения (react, simple, complex, ralph)"
    )
    ai_execution_status = models.CharField(
        max_length=20,
        choices=[
            ('PENDING', 'Ожидает выполнения'),
            ('ANALYZING', 'Анализируется'),
            ('PLANNING', 'Планируется'),
            ('EXECUTING', 'Выполняется'),
            ('COMPLETED', 'Завершена'),
            ('FAILED', 'Ошибка'),
            ('CANCELLED', 'Отменена'),
        ],
        default='PENDING',
        null=True,
        blank=True
    )
    
    # Server connection
    target_server = models.ForeignKey(
        'servers.Server',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
        help_text="Сервер, на котором нужно выполнить задачу"
    )
    server_name_mentioned = models.CharField(
        max_length=200,
        blank=True,
        help_text="Название сервера, упомянутое в описании задачи"
    )
    
    # Timing
    estimated_duration_hours = models.FloatField(
        null=True,
        blank=True,
        help_text="Оценка времени выполнения в часах"
    )
    actual_duration_hours = models.FloatField(
        null=True,
        blank=True,
        help_text="Фактическое время выполнения в часах"
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    # Smart execution
    auto_execution_suggested = models.BooleanField(
        default=False,
        help_text="Предложено ли автоматическое выполнение"
    )
    auto_execution_approved = models.BooleanField(
        default=False,
        help_text="Одобрено ли автоматическое выполнение"
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-priority']),
            models.Index(fields=['assignee', 'status']),
            models.Index(fields=['assigned_to_ai', 'ai_execution_status']),
            models.Index(fields=['target_server', 'status']),
            models.Index(fields=['due_date', 'status']),
        ]

    def __str__(self):
        return self.title
    
    def get_priority_color(self):
        """Get color for priority"""
        colors = {
            TaskPriority.HIGH: 'red',
            TaskPriority.MEDIUM: 'yellow',
            TaskPriority.LOW: 'green',
        }
        return colors.get(self.priority, 'gray')
    
    def is_overdue(self):
        """Проверка просрочки задачи"""
        if self.due_date and self.status not in ['DONE', 'CANCELLED']:
            return timezone.now() > self.due_date
        return False
    
    def get_progress_percentage(self):
        """Получить процент выполнения на основе подзадач"""
        subtasks = self.subtasks.all()
        if not subtasks:
            return 0
        completed = subtasks.filter(is_completed=True).count()
        return int((completed / subtasks.count()) * 100)


class TaskLabel(models.Model):
    """Labels/Tags for tasks"""
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(max_length=7, default='#3b82f6')  # Hex color
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class TaskLabelRelation(models.Model):
    """Many-to-many relationship between Task and TaskLabel"""
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='label_relations')
    label = models.ForeignKey(TaskLabel, on_delete=models.CASCADE, related_name='task_relations')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['task', 'label']


class SubTask(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='subtasks')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, help_text="Детальное описание подзадачи")
    is_completed = models.BooleanField(default=False)
    
    # Ordering
    order = models.IntegerField(default=0, help_text="Порядок выполнения подзадачи")
    
    # Timing
    estimated_duration_minutes = models.IntegerField(
        null=True,
        blank=True,
        help_text="Оценка времени выполнения в минутах"
    )
    actual_duration_minutes = models.IntegerField(
        null=True,
        blank=True,
        help_text="Фактическое время выполнения в минутах"
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    due_date = models.DateTimeField(null=True, blank=True, help_text="Срок выполнения подзадачи")
    
    # AI execution
    assigned_to_ai = models.BooleanField(default=False)
    execution_status = models.CharField(
        max_length=20,
        choices=[
            ('PENDING', 'Ожидает'),
            ('IN_PROGRESS', 'Выполняется'),
            ('COMPLETED', 'Завершена'),
            ('FAILED', 'Ошибка'),
            ('BLOCKED', 'Заблокирована'),
        ],
        default='PENDING'
    )
    
    created_at = models.DateTimeField(auto_now_add=True, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True, null=True, blank=True)

    class Meta:
        ordering = ['order', 'created_at']
        indexes = [
            models.Index(fields=['task', 'order']),
            models.Index(fields=['task', 'is_completed']),
        ]

    def __str__(self):
        return self.title
    
    def is_overdue(self):
        """Проверка просрочки подзадачи"""
        if self.due_date and not self.is_completed:
            return timezone.now() > self.due_date
        return False


class TaskComment(models.Model):
    """Comments on tasks"""
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Comment on {self.task.title} by {self.author}"


class TaskAttachment(models.Model):
    """File attachments for tasks"""
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='task_attachments/%Y/%m/%d/')
    filename = models.CharField(max_length=255)
    file_size = models.IntegerField()
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.filename} on {self.task.title}"


class TaskHistory(models.Model):
    """History of changes to tasks"""
    ACTION_CHOICES = [
        ('CREATED', 'Created'),
        ('UPDATED', 'Updated'),
        ('STATUS_CHANGED', 'Status Changed'),
        ('PRIORITY_CHANGED', 'Priority Changed'),
        ('ASSIGNEE_CHANGED', 'Assignee Changed'),
        ('COMMENT_ADDED', 'Comment Added'),
        ('ATTACHMENT_ADDED', 'Attachment Added'),
    ]

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='history')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    old_value = models.TextField(blank=True, null=True)
    new_value = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['task', '-created_at']),
        ]

    def __str__(self):
        return f"{self.action} on {self.task.title} at {self.created_at}"


class TaskExecution(models.Model):
    """Отслеживание выполнения задачи ИИ"""
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='executions')
    subtask = models.ForeignKey(
        SubTask,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='executions'
    )
    
    # Execution details
    agent_type = models.CharField(max_length=50, help_text="Тип агента, выполняющего задачу")
    execution_plan = models.JSONField(
        null=True,
        blank=True,
        help_text="План выполнения задачи"
    )
    execution_log = models.TextField(blank=True, help_text="Лог выполнения")
    
    # Status
    status = models.CharField(
        max_length=20,
        choices=[
            ('PENDING', 'Ожидает'),
            ('ANALYZING', 'Анализируется'),
            ('PLANNING', 'Планируется'),
            ('EXECUTING', 'Выполняется'),
            ('COMPLETED', 'Завершена'),
            ('FAILED', 'Ошибка'),
            ('CANCELLED', 'Отменена'),
        ],
        default='PENDING'
    )
    
    # Timing
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    estimated_duration_minutes = models.IntegerField(null=True, blank=True)
    actual_duration_minutes = models.IntegerField(null=True, blank=True)
    
    # Results
    result_summary = models.TextField(blank=True, help_text="Краткое описание результата")
    error_message = models.TextField(blank=True, help_text="Сообщение об ошибке, если есть")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['task', '-created_at']),
            models.Index(fields=['status', '-created_at']),
        ]
    
    def __str__(self):
        return f"Execution of {self.task.title} - {self.status}"


class TaskNotification(models.Model):
    """Уведомления о задачах (push-уведомления)"""
    NOTIFICATION_TYPES = [
        ('AUTO_EXECUTION_SUGGESTION', 'Предложение автоматического выполнения'),
        ('TASK_OVERDUE', 'Просрочка задачи'),
        ('SUBTASK_OVERDUE', 'Просрочка подзадачи'),
        ('EXECUTION_STARTED', 'Начато выполнение'),
        ('EXECUTION_COMPLETED', 'Выполнение завершено'),
        ('EXECUTION_FAILED', 'Ошибка выполнения'),
        ('SERVER_DETECTED', 'Обнаружен сервер в задаче'),
    ]
    
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='notifications')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='task_notifications')
    
    notification_type = models.CharField(max_length=50, choices=NOTIFICATION_TYPES)
    title = models.CharField(max_length=200)
    message = models.TextField()
    
    # Action data
    action_data = models.JSONField(
        null=True,
        blank=True,
        help_text="Данные для действия (например, server_id для подключения)"
    )
    action_url = models.CharField(
        max_length=500,
        blank=True,
        help_text="URL для действия"
    )
    
    # Status
    is_read = models.BooleanField(default=False)
    is_actioned = models.BooleanField(default=False, help_text="Было ли выполнено действие")
    
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)
    actioned_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_read', '-created_at']),
            models.Index(fields=['task', '-created_at']),
        ]
    
    def __str__(self):
        return f"{self.notification_type} - {self.title}"
