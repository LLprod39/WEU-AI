"""
Models for agent profiles, presets, and run logs.
"""
from typing import Dict
import secrets
from django.db import models
from django.contrib.auth.models import User


class AgentProfile(models.Model):
    """
    User-configurable agent profile
    
    DEPRECATED: AgentProfile больше не создаётся из воркфлоу (api_assist_auto).
    Используется только для обратной совместимости со старыми AgentRun.
    Для новых агентов используйте CustomAgent.
    """
    AGENT_TYPE_CHOICES = [
        ("simple", "Simple"),
        ("complex", "Complex"),
        ("react", "ReAct"),
        ("ralph", "Ralph Wiggum"),
        ("claude_code", "Claude Code"),
    ]
    RUNTIME_CHOICES = [
        ("internal", "Internal"),
        ("cursor", "Cursor CLI"),
        ("claude", "Claude Code CLI"),
        ("codex", "Codex CLI"),
        ("opencode", "OpenCode CLI"),
        ("gemini", "Gemini CLI"),
        ("ralph", "Ralph Orchestrator"),
    ]
    MODE_CHOICES = [
        ("simple", "Simple"),
        ("advanced", "Advanced"),
    ]

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="agent_profiles")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    agent_type = models.CharField(max_length=20, choices=AGENT_TYPE_CHOICES, default="react")
    runtime = models.CharField(max_length=20, choices=RUNTIME_CHOICES, default="internal")
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default="simple")
    config = models.JSONField(default=dict, blank=True)
    
    # MCP Configuration per agent
    mcp_servers = models.JSONField(
        default=dict,
        blank=True,
        help_text="MCP серверы для этого агента (per-agent isolation)"
    )
    mcp_auto_approve = models.BooleanField(
        default=False,
        help_text="Автоматически одобрять MCP инструменты без подтверждения"
    )
    
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "-updated_at"]),
            models.Index(fields=["agent_type", "runtime"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.agent_type})"


class AgentPreset(models.Model):
    """System presets for quick start"""
    AGENT_TYPE_CHOICES = AgentProfile.AGENT_TYPE_CHOICES
    RUNTIME_CHOICES = AgentProfile.RUNTIME_CHOICES

    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    agent_type = models.CharField(max_length=20, choices=AGENT_TYPE_CHOICES)
    runtime = models.CharField(max_length=20, choices=RUNTIME_CHOICES)
    config = models.JSONField(default=dict, blank=True)
    is_system = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class AgentRun(models.Model):
    """Run history for agents and CLI runtime"""
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]
    RUNTIME_CHOICES = AgentProfile.RUNTIME_CHOICES

    profile = models.ForeignKey(
        AgentProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name="runs"
    )
    initiated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    runtime = models.CharField(max_length=20, choices=RUNTIME_CHOICES, default="internal")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    input_task = models.TextField()
    output_text = models.TextField(blank=True)
    logs = models.TextField(blank=True)
    log_events = models.JSONField(default=list, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["runtime", "-created_at"]),
            models.Index(fields=["status", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"Run {self.id} ({self.runtime})"


class AgentWorkflow(models.Model):
    """Workflow script with ordered steps"""
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="agent_workflows")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    runtime = models.CharField(max_length=20, choices=AgentProfile.RUNTIME_CHOICES, default="gemini")
    script = models.JSONField(default=dict, blank=True)
    project_path = models.CharField(max_length=500, blank=True, help_text="Путь к папке проекта (относительно agent_projects)")
    target_server = models.ForeignKey(
        "servers.Server",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="workflows",
        help_text="Целевой сервер для выполнения команд (если не указан — агент сам выбирает из доступных)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name
    
    def get_full_project_path(self):
        """Возвращает полный путь к папке проекта"""
        from django.conf import settings
        if self.project_path:
            return settings.AGENT_PROJECTS_DIR / self.project_path
        return settings.BASE_DIR


class AgentWorkflowRun(models.Model):
    """Run instance for workflow execution"""
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("paused", "Paused"),
    ]

    workflow = models.ForeignKey(AgentWorkflow, on_delete=models.CASCADE, related_name="runs")
    initiated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    current_step = models.IntegerField(default=0)
    logs = models.TextField(blank=True)
    output_text = models.TextField(blank=True)
    log_events = models.JSONField(default=list, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    step_results = models.JSONField(default=list, blank=True, help_text="Results for each step")
    retry_count = models.IntegerField(default=0, help_text="Number of retries for current step")
    max_retries = models.IntegerField(default=3, help_text="Max retries per step")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"WorkflowRun {self.id} ({self.status})"


class CustomAgent(models.Model):
    """
    Кастомные агенты пользователя (как в Claude Code)
    
    Пользователь может создать собственного агента с:
    - Кастомным промптом и инструкциями
    - Выбором инструментов
    - Конфигурацией runtime и модели
    - MCP серверами
    """
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="custom_agents")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    
    # Agent behavior
    system_prompt = models.TextField(
        help_text="Базовый промпт агента (роль, инструкции)",
        default="Ты DevOps агент, специализирующийся на автоматизации задач."
    )
    instructions = models.TextField(
        blank=True,
        help_text="Дополнительные инструкции для агента"
    )
    
    # Capabilities
    allowed_tools = models.JSONField(
        default=list,
        blank=True,
        help_text="Список разрешённых инструментов (ssh_execute, read_file, etc)"
    )
    max_iterations = models.IntegerField(
        default=5,
        help_text="Максимальное количество итераций для ReAct/Ralph"
    )
    temperature = models.FloatField(
        default=0.7,
        help_text="Temperature для LLM (0.0 - 1.0)"
    )
    completion_promise = models.CharField(
        max_length=100,
        default="COMPLETE",
        help_text="Фраза для завершения (для Ralph mode)"
    )
    
    # Runtime configuration
    runtime = models.CharField(
        max_length=20,
        choices=AgentProfile.RUNTIME_CHOICES,
        default="claude",
        help_text="CLI runtime для выполнения"
    )
    model = models.CharField(
        max_length=50,
        default="claude-4.5-sonnet",
        help_text="Модель для использования"
    )
    orchestrator_mode = models.CharField(
        max_length=20,
        choices=[
            ("react", "ReAct Loop"),
            ("ralph_internal", "Ralph Internal"),
            ("ralph_cli", "Ralph CLI"),
        ],
        default="ralph_internal",
        help_text="Режим оркестратора"
    )
    
    # MCP Configuration
    mcp_servers = models.JSONField(
        default=dict,
        blank=True,
        help_text="MCP серверы для этого агента"
    )
    mcp_auto_approve = models.BooleanField(
        default=False,
        help_text="Автоматически одобрять MCP инструменты"
    )
    
    # Server access and knowledge
    allowed_servers = models.JSONField(
        default=None,
        null=True,
        blank=True,
        help_text='null/"all" = все серверы пользователя, [id1, id2, ...] = только указанные серверы'
    )
    skills = models.ManyToManyField(
        "skills.Skill",
        blank=True,
        related_name="bound_custom_agents",
        help_text="Skills, которые будут автоматически добавляться в prompt этого агента",
    )
    knowledge_base = models.TextField(
        blank=True,
        default='',
        help_text="База знаний агента: инструкции, типичные проблемы, примеры (подставляется в системный промпт)"
    )
    
    # Metadata
    is_active = models.BooleanField(default=True)
    is_public = models.BooleanField(
        default=False,
        help_text="Доступен ли агент другим пользователям"
    )
    usage_count = models.IntegerField(default=0, help_text="Количество использований")
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "-updated_at"]),
            models.Index(fields=["is_active", "is_public"]),
        ]
    
    def __str__(self) -> str:
        return f"{self.name} ({self.runtime})"
    
    def to_cli_agent_config(self) -> Dict:
        """Экспорт в формат для Claude Code CLI agent config"""
        return {
            "name": self.name,
            "description": self.description,
            "system_prompt": self.system_prompt,
            "instructions": self.instructions,
            "allowed_tools": self.allowed_tools,
            "max_iterations": self.max_iterations,
            "temperature": self.temperature,
            "skill_ids": list(self.skills.values_list("id", flat=True)),
        }
    
    def get_allowed_servers(self, user):
        """
        Возвращает QuerySet серверов, доступных агенту
        
        Args:
            user: User instance для фильтрации серверов
            
        Returns:
            QuerySet[Server]: Доступные серверы
        """
        from servers.models import Server
        if self.allowed_servers is None or self.allowed_servers == "all":
            return Server.objects.filter(user=user, is_active=True)
        elif isinstance(self.allowed_servers, list):
            return Server.objects.filter(user=user, is_active=True, id__in=self.allowed_servers)
        return Server.objects.none()


def _generate_webhook_secret() -> str:
    # 48 hex chars, URL-safe and easy to paste into webhook URLs
    return secrets.token_hex(24)


class AgentWebhook(models.Model):
    """
    Webhook triggers for automatic agent execution.
    """
    EXECUTION_MODES = [
        ("task", "Task"),
        ("workflow", "Workflow"),
    ]

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="agent_webhooks")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    source = models.CharField(max_length=50, default="generic")
    secret = models.CharField(max_length=64, unique=True, db_index=True, default=_generate_webhook_secret)
    config = models.JSONField(default=dict, blank=True)

    # Agent selection
    custom_agent = models.ForeignKey(
        "agent_hub.CustomAgent",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="webhook_triggers",
    )
    agent_type = models.CharField(
        max_length=50,
        default="react",
        help_text="Fallback agent type if custom_agent is not set",
    )
    auto_execute = models.BooleanField(default=True)
    execution_mode = models.CharField(max_length=20, choices=EXECUTION_MODES, default="task")

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "-updated_at"]),
            models.Index(fields=["source"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.source})"


class AgentWebhookEvent(models.Model):
    """Webhook delivery log for debugging and audit."""
    STATUS_CHOICES = [
        ("received", "Received"),
        ("processed", "Processed"),
        ("failed", "Failed"),
    ]

    webhook = models.ForeignKey(AgentWebhook, on_delete=models.CASCADE, related_name="events")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="received")
    payload = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["webhook", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"WebhookEvent {self.id} ({self.status})"
