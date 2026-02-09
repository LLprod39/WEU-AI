from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.db import transaction
import secrets


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

    # Project Management (Jira-like)
    project = models.ForeignKey(
        'Project',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='tasks',
        verbose_name="Проект"
    )
    sprint = models.ForeignKey(
        'Sprint',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='tasks',
        verbose_name="Спринт"
    )
    task_key = models.CharField(
        max_length=20,
        blank=True,
        db_index=True,
        verbose_name="Ключ задачи",
        help_text="Автогенерируемый ключ (WEU-123)"
    )

    # Команда (группа исполнителей; опционально к assignee)
    assigned_team = models.ForeignKey(
        'Team',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='tasks',
        verbose_name="Команда"
    )

    # Наблюдатели
    watchers = models.ManyToManyField(
        User,
        blank=True,
        related_name='watched_tasks',
        verbose_name="Наблюдатели"
    )

    # Иерархия задач (Epic -> Story -> Task)
    parent_task = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='child_tasks',
        verbose_name="Родительская задача"
    )
    
    # AI Assignment
    assigned_to_ai = models.BooleanField(default=False, help_text="Назначена ли задача на ИИ")
    ai_agent_type = models.CharField(
        max_length=50, 
        blank=True, 
        null=True,
        help_text="Тип агента для выполнения (react, simple, complex, ralph) — используется если recommended_custom_agent не задан"
    )
    recommended_custom_agent = models.ForeignKey(
        'agent_hub.CustomAgent',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
        help_text="Рекомендованный кастомный агент для выполнения задачи"
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
    
    # External integration (Jira, GitHub, etc)
    external_system = models.CharField(
        max_length=50,
        choices=[
            ('jira', 'Jira'),
            ('github', 'GitHub Issues'),
            ('gitlab', 'GitLab Issues'),
            ('internal', 'Internal'),
        ],
        default='internal',
        help_text="Внешняя система, из которой импортирована задача"
    )
    external_id = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        help_text="ID задачи во внешней системе (например DEVOPS-123)"
    )
    external_url = models.URLField(
        blank=True,
        help_text="Прямая ссылка на задачу во внешней системе"
    )
    sync_back = models.BooleanField(
        default=True,
        help_text="Синхронизировать статус обратно во внешнюю систему"
    )
    last_synced_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Время последней синхронизации с внешней системой"
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-priority']),
            models.Index(fields=['assignee', 'status']),
            models.Index(fields=['assigned_to_ai', 'ai_execution_status']),
            models.Index(fields=['target_server', 'status']),
            models.Index(fields=['due_date', 'status']),
            models.Index(fields=['project', 'status']),
            models.Index(fields=['project', 'sprint']),
            models.Index(fields=['task_key']),
        ]

    def __str__(self):
        if self.task_key:
            return f"{self.task_key}: {self.title}"
        return self.title

    def save(self, *args, **kwargs):
        # Генерация task_key для задач с проектом
        if self.project and not self.task_key:
            self.task_key = self.project.get_next_task_key()
        super().save(*args, **kwargs)

    def get_display_id(self):
        """Получить отображаемый ID задачи"""
        return self.task_key if self.task_key else f"#{self.pk}"

    def get_blocking_tasks(self):
        """Получить задачи, которые блокируют эту"""
        return Task.objects.filter(
            outgoing_relations__to_task=self,
            outgoing_relations__relation_type='blocks'
        )

    def get_blocked_tasks(self):
        """Получить задачи, заблокированные этой"""
        return Task.objects.filter(
            incoming_relations__from_task=self,
            incoming_relations__relation_type='blocks'
        )

    def add_watcher(self, user):
        """Добавить наблюдателя"""
        self.watchers.add(user)

    def remove_watcher(self, user):
        """Удалить наблюдателя"""
        self.watchers.remove(user)

    def is_watching(self, user):
        """Проверить, наблюдает ли пользователь за задачей"""
        return self.watchers.filter(pk=user.pk).exists()
    
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

    @property
    def completed_subtasks_count(self):
        """Количество завершенных подзадач"""
        return self.subtasks.filter(is_completed=True).count()


class TaskShare(models.Model):
    """Share a task with another user. Visibility + optional edit right."""
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='shares')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='task_shares')
    can_edit = models.BooleanField(default=False)

    class Meta:
        unique_together = ['task', 'user']
        indexes = [
            models.Index(fields=['user', 'task']),
        ]

    def __str__(self):
        return f"{self.task.title} → {self.user.username} (edit={self.can_edit})"


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
    """Уведомления о задачах и проектах (push-уведомления)"""
    NOTIFICATION_TYPES = [
        # Задачи и выполнение
        ('AUTO_EXECUTION_SUGGESTION', 'Предложение автоматического выполнения'),
        ('SERVER_CONFIRMATION', 'Подтверждение сервера'),
        ('QUESTIONS_REQUIRED', 'Требуются уточнения'),
        ('TASK_OVERDUE', 'Просрочка задачи'),
        ('SUBTASK_OVERDUE', 'Просрочка подзадачи'),
        ('EXECUTION_STARTED', 'Начато выполнение'),
        ('EXECUTION_COMPLETED', 'Выполнение завершено'),
        ('EXECUTION_FAILED', 'Ошибка выполнения'),
        ('SERVER_DETECTED', 'Обнаружен сервер в задаче'),
        ('INFO', 'Информация'),
        ('WARNING', 'Предупреждение'),
        # Проекты (task может быть null)
        ('PROJECT_INVITATION', 'Приглашение в проект'),
        ('PROJECT_ROLE_CHANGED', 'Изменение роли в проекте'),
        ('PROJECT_MEMBER_JOINED', 'Новый участник проекта'),
        ('PROJECT_MEMBER_LEFT', 'Участник покинул проект'),
        # Задачи
        ('TASK_ASSIGNED', 'Задача назначена'),
        ('TASK_MENTIONED', 'Упоминание в задаче'),
        ('TASK_WATCHING', 'Обновление отслеживаемой задачи'),
        ('TASK_MOVED', 'Задача перемещена'),
        # Спринты
        ('SPRINT_STARTED', 'Спринт начат'),
        ('SPRINT_ENDING', 'Спринт заканчивается'),
        ('SPRINT_COMPLETED', 'Спринт завершён'),
    ]

    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name='notifications',
        null=True,
        blank=True,
        help_text='Для уведомлений уровня проекта (приглашение и т.д.) — пусто'
    )
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


class UserDelegatePreference(models.Model):
    """Настройка пользователя: при делегировании задачи ИИ открывать чат или форму задачи."""
    DELEGATE_UI_CHAT = 'chat'
    DELEGATE_UI_TASK_FORM = 'task_form'
    DELEGATE_UI_CHOICES = [
        (DELEGATE_UI_CHAT, 'Чат с контекстом задачи'),
        (DELEGATE_UI_TASK_FORM, 'Форма задачи агента'),
    ]
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='delegate_preference',
    )
    delegate_ui = models.CharField(
        max_length=20,
        choices=DELEGATE_UI_CHOICES,
        default=DELEGATE_UI_CHAT,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Настройка делегирования ИИ'
        verbose_name_plural = 'Настройки делегирования ИИ'

    def __str__(self):
        return f"{self.user.username}: {self.get_delegate_ui_display()}"


class TaskExecutionSettings(models.Model):
    """Настройки выполнения задач ИИ для пользователя."""
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='task_execution_settings',
    )
    
    # Подтверждение сервера
    require_server_confirmation = models.BooleanField(
        default=True,
        help_text="Требовать подтверждение сервера перед выполнением задачи"
    )
    
    # Автоматическое выполнение
    auto_execute_simple_tasks = models.BooleanField(
        default=False,
        help_text="Автоматически выполнять простые задачи без подтверждения"
    )
    
    # Уточняющие вопросы
    ask_questions_before_execution = models.BooleanField(
        default=True,
        help_text="Задавать уточняющие вопросы перед выполнением, если информации недостаточно"
    )
    
    # Сервер по умолчанию
    default_server = models.ForeignKey(
        'servers.Server',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='default_for_users',
        help_text="Сервер по умолчанию для выполнения задач (если не указан другой)"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Настройки выполнения задач'
        verbose_name_plural = 'Настройки выполнения задач'

    def __str__(self):
        return f"TaskExecutionSettings for {self.user.username}"
    
    @classmethod
    def get_for_user(cls, user):
        """Получить настройки для пользователя, создать если не существуют."""
        settings, _ = cls.objects.get_or_create(user=user)
        return settings


# =============================================================================
# PROJECT MANAGEMENT MODELS (Jira-like functionality)
# =============================================================================

class Project(models.Model):
    """Проект — контейнер для задач"""
    name = models.CharField(max_length=200, verbose_name="Название")
    key = models.CharField(
        max_length=10,
        unique=True,
        verbose_name="Ключ",
        help_text="Короткий ключ проекта (например: WEU, DEV). Используется в ID задач."
    )
    description = models.TextField(blank=True, verbose_name="Описание")

    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='owned_projects',
        verbose_name="Владелец"
    )

    # Настройки
    is_public = models.BooleanField(
        default=False,
        verbose_name="Публичный",
        help_text="Видимость для всех пользователей системы"
    )
    default_assignee = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='default_assignee_projects',
        verbose_name="Исполнитель по умолчанию"
    )

    # Визуал
    color = models.CharField(
        max_length=7,
        default='#3B82F6',
        verbose_name="Цвет",
        help_text="HEX цвет проекта"
    )
    icon = models.CharField(
        max_length=50,
        default='folder',
        verbose_name="Иконка"
    )

    # Счётчик задач для генерации ID типа "WEU-123"
    task_counter = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    archived_at = models.DateTimeField(null=True, blank=True, verbose_name="Архивирован")

    class Meta:
        ordering = ['-updated_at']
        verbose_name = "Проект"
        verbose_name_plural = "Проекты"
        indexes = [
            models.Index(fields=['owner', '-updated_at']),
            models.Index(fields=['key']),
        ]

    def __str__(self):
        return f"{self.key}: {self.name}"

    def get_next_task_key(self):
        """Генерация следующего ключа задачи (WEU-123)"""
        with transaction.atomic():
            project = Project.objects.select_for_update().get(pk=self.pk)
            project.task_counter += 1
            project.save(update_fields=['task_counter'])
            return f"{self.key}-{project.task_counter}"

    def is_archived(self):
        return self.archived_at is not None

    def get_member_count(self):
        return self.members.count()

    def get_task_count(self):
        return self.tasks.count()

    def get_open_task_count(self):
        return self.tasks.exclude(status__in=['DONE', 'CANCELLED']).count()


class ProjectMemberRole(models.TextChoices):
    OWNER = 'owner', 'Владелец'
    ADMIN = 'admin', 'Администратор'
    MEMBER = 'member', 'Участник'
    VIEWER = 'viewer', 'Наблюдатель'


class ProjectMember(models.Model):
    """Членство в проекте с ролями"""
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='members'
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='project_memberships'
    )
    role = models.CharField(
        max_length=20,
        choices=ProjectMemberRole.choices,
        default=ProjectMemberRole.MEMBER
    )

    # Уведомления
    notify_on_new_task = models.BooleanField(default=True, verbose_name="Уведомлять о новых задачах")
    notify_on_mention = models.BooleanField(default=True, verbose_name="Уведомлять об упоминаниях")
    notify_on_assignment = models.BooleanField(default=True, verbose_name="Уведомлять о назначениях")

    joined_at = models.DateTimeField(auto_now_add=True)
    invited_by = models.ForeignKey(
        User,
        null=True,
        on_delete=models.SET_NULL,
        related_name='sent_project_invitations'
    )

    class Meta:
        unique_together = ['project', 'user']
        verbose_name = "Участник проекта"
        verbose_name_plural = "Участники проектов"
        indexes = [
            models.Index(fields=['user', 'project']),
            models.Index(fields=['project', 'role']),
        ]

    def __str__(self):
        return f"{self.user.username} в {self.project.key} ({self.get_role_display()})"

    def can_edit_project(self):
        return self.role in [ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]

    def can_manage_members(self):
        return self.role in [ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN]

    def can_create_tasks(self):
        return self.role in [ProjectMemberRole.OWNER, ProjectMemberRole.ADMIN, ProjectMemberRole.MEMBER]

    def can_delete_project(self):
        return self.role == ProjectMemberRole.OWNER


# =============================================================================
# TEAMS (группы пользователей)
# =============================================================================

class TeamMemberRole(models.TextChoices):
    OWNER = 'owner', 'Владелец'
    ADMIN = 'admin', 'Администратор'
    MEMBER = 'member', 'Участник'


class Team(models.Model):
    """Команда — группа пользователей для совместной работы."""
    name = models.CharField(max_length=100, verbose_name="Название")
    slug = models.SlugField(max_length=50, unique=True, allow_unicode=True, verbose_name="Код")
    description = models.TextField(blank=True, verbose_name="Описание")
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='owned_teams',
        verbose_name="Владелец"
    )
    color = models.CharField(max_length=7, default='#6366f1', verbose_name="Цвет")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = "Команда"
        verbose_name_plural = "Команды"
        indexes = [
            models.Index(fields=['owner']),
            models.Index(fields=['slug']),
        ]

    def __str__(self):
        return self.name

    def get_member_count(self):
        return self.members.count()


class TeamMember(models.Model):
    """Участник команды с ролью."""
    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name='members'
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='team_memberships'
    )
    role = models.CharField(
        max_length=20,
        choices=TeamMemberRole.choices,
        default=TeamMemberRole.MEMBER
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['team', 'user']
        verbose_name = "Участник команды"
        verbose_name_plural = "Участники команд"
        indexes = [
            models.Index(fields=['user', 'team']),
            models.Index(fields=['team', 'role']),
        ]

    def __str__(self):
        return f"{self.user.username} в {self.team.name}"

    def can_manage_team(self):
        return self.role in [TeamMemberRole.OWNER, TeamMemberRole.ADMIN]


class ProjectInvitationStatus(models.TextChoices):
    PENDING = 'pending', 'Ожидает'
    ACCEPTED = 'accepted', 'Принято'
    DECLINED = 'declined', 'Отклонено'
    EXPIRED = 'expired', 'Истекло'


class ProjectInvitation(models.Model):
    """Приглашения в проект"""
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='invitations'
    )
    email = models.EmailField(verbose_name="Email", help_text="Для приглашения по email")
    user = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='project_invitations_received',
        help_text="Если уже зарегистрирован"
    )
    role = models.CharField(
        max_length=20,
        choices=ProjectMemberRole.choices,
        default=ProjectMemberRole.MEMBER
    )

    invited_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='project_invitations_sent'
    )
    status = models.CharField(
        max_length=20,
        choices=ProjectInvitationStatus.choices,
        default=ProjectInvitationStatus.PENDING
    )

    message = models.TextField(blank=True, verbose_name="Персональное сообщение")
    token = models.CharField(max_length=64, unique=True, help_text="Для принятия по ссылке")

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Приглашение в проект"
        verbose_name_plural = "Приглашения в проекты"
        indexes = [
            models.Index(fields=['email', 'status']),
            models.Index(fields=['token']),
            models.Index(fields=['project', 'status']),
        ]

    def __str__(self):
        return f"Приглашение {self.email} в {self.project.key}"

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(48)
        if not self.expires_at:
            self.expires_at = timezone.now() + timezone.timedelta(days=7)
        super().save(*args, **kwargs)

    def is_expired(self):
        return timezone.now() > self.expires_at

    def accept(self, user):
        """Принять приглашение"""
        if self.status != ProjectInvitationStatus.PENDING:
            raise ValidationError("Приглашение уже обработано")
        if self.is_expired():
            self.status = ProjectInvitationStatus.EXPIRED
            self.save()
            raise ValidationError("Приглашение истекло")

        # Создаём членство
        ProjectMember.objects.get_or_create(
            project=self.project,
            user=user,
            defaults={
                'role': self.role,
                'invited_by': self.invited_by,
            }
        )

        self.status = ProjectInvitationStatus.ACCEPTED
        self.user = user
        self.responded_at = timezone.now()
        self.save()

    def decline(self):
        """Отклонить приглашение"""
        if self.status != ProjectInvitationStatus.PENDING:
            raise ValidationError("Приглашение уже обработано")

        self.status = ProjectInvitationStatus.DECLINED
        self.responded_at = timezone.now()
        self.save()


class ProjectMaterialType(models.TextChoices):
    DOCUMENT = 'document', 'Документ'
    LINK = 'link', 'Ссылка'
    FILE = 'file', 'Файл'
    WIKI = 'wiki', 'Wiki-страница'


class ProjectMaterial(models.Model):
    """Материалы проекта — документы, ссылки, файлы"""
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='materials'
    )

    title = models.CharField(max_length=200, verbose_name="Название")
    description = models.TextField(blank=True, verbose_name="Описание")
    material_type = models.CharField(
        max_length=20,
        choices=ProjectMaterialType.choices,
        verbose_name="Тип"
    )

    # Для файлов
    file = models.FileField(
        upload_to='project_materials/%Y/%m/',
        null=True,
        blank=True,
        verbose_name="Файл"
    )
    file_size = models.PositiveIntegerField(null=True, blank=True)

    # Для ссылок
    url = models.URLField(max_length=500, blank=True, verbose_name="URL")

    # Для wiki
    content = models.TextField(blank=True, verbose_name="Содержимое", help_text="Markdown")

    # Организация
    folder = models.CharField(max_length=200, blank=True, verbose_name="Папка")
    pinned = models.BooleanField(default=False, verbose_name="Закреплён")

    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-pinned', '-updated_at']
        verbose_name = "Материал проекта"
        verbose_name_plural = "Материалы проектов"
        indexes = [
            models.Index(fields=['project', '-pinned', '-updated_at']),
            models.Index(fields=['project', 'material_type']),
        ]

    def __str__(self):
        return f"{self.title} ({self.project.key})"


class SprintStatus(models.TextChoices):
    PLANNING = 'planning', 'Планирование'
    ACTIVE = 'active', 'Активный'
    COMPLETED = 'completed', 'Завершён'


class Sprint(models.Model):
    """Спринт/Итерация"""
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='sprints'
    )
    name = models.CharField(max_length=100, verbose_name="Название")
    goal = models.TextField(blank=True, verbose_name="Цель спринта")

    status = models.CharField(
        max_length=20,
        choices=SprintStatus.choices,
        default=SprintStatus.PLANNING
    )

    start_date = models.DateField(null=True, blank=True, verbose_name="Начало")
    end_date = models.DateField(null=True, blank=True, verbose_name="Окончание")

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_sprints'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-start_date', '-created_at']
        verbose_name = "Спринт"
        verbose_name_plural = "Спринты"
        indexes = [
            models.Index(fields=['project', 'status']),
            models.Index(fields=['project', '-start_date']),
        ]

    def __str__(self):
        return f"{self.name} ({self.project.key})"

    def get_task_count(self):
        return self.tasks.count()

    def get_completed_task_count(self):
        return self.tasks.filter(status='DONE').count()

    def get_progress_percentage(self):
        total = self.get_task_count()
        if total == 0:
            return 0
        return int((self.get_completed_task_count() / total) * 100)

    def start(self):
        """Начать спринт"""
        if self.status != SprintStatus.PLANNING:
            raise ValidationError("Можно начать только спринт в статусе 'Планирование'")

        # Проверяем, нет ли активного спринта в проекте
        active = Sprint.objects.filter(
            project=self.project,
            status=SprintStatus.ACTIVE
        ).exclude(pk=self.pk).exists()
        if active:
            raise ValidationError("В проекте уже есть активный спринт")

        self.status = SprintStatus.ACTIVE
        if not self.start_date:
            self.start_date = timezone.now().date()
        self.save()

    def complete(self):
        """Завершить спринт"""
        if self.status != SprintStatus.ACTIVE:
            raise ValidationError("Можно завершить только активный спринт")

        self.status = SprintStatus.COMPLETED
        self.completed_at = timezone.now()
        self.save()


class SavedFilter(models.Model):
    """Сохранённые фильтры/виды"""
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='saved_task_filters'
    )
    project = models.ForeignKey(
        Project,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='saved_filters'
    )

    name = models.CharField(max_length=100, verbose_name="Название")
    filter_config = models.JSONField(
        verbose_name="Конфигурация фильтра",
        help_text='{"status": ["TODO"], "assignee": [1,2], "priority": ["HIGH"]}'
    )

    is_default = models.BooleanField(default=False, verbose_name="По умолчанию")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'name']
        verbose_name = "Сохранённый фильтр"
        verbose_name_plural = "Сохранённые фильтры"
        indexes = [
            models.Index(fields=['user', 'project']),
        ]

    def __str__(self):
        project_key = self.project.key if self.project else "Global"
        return f"{self.name} ({project_key})"


# =============================================================================
# TASK RELATIONSHIP MODELS
# =============================================================================

class TaskRelationType(models.TextChoices):
    BLOCKS = 'blocks', 'Блокирует'
    IS_BLOCKED_BY = 'blocked_by', 'Заблокирована'
    RELATES_TO = 'relates_to', 'Связана с'
    DUPLICATES = 'duplicates', 'Дублирует'
    IS_DUPLICATED_BY = 'duplicated_by', 'Дублируется'


class TaskRelation(models.Model):
    """Связи между задачами"""
    from_task = models.ForeignKey(
        'Task',
        on_delete=models.CASCADE,
        related_name='outgoing_relations'
    )
    to_task = models.ForeignKey(
        'Task',
        on_delete=models.CASCADE,
        related_name='incoming_relations'
    )
    relation_type = models.CharField(
        max_length=20,
        choices=TaskRelationType.choices,
        default=TaskRelationType.RELATES_TO
    )

    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['from_task', 'to_task', 'relation_type']
        verbose_name = "Связь задач"
        verbose_name_plural = "Связи задач"

    def __str__(self):
        return f"{self.from_task.task_key or self.from_task.id} {self.get_relation_type_display()} {self.to_task.task_key or self.to_task.id}"
