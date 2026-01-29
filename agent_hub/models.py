"""
Models for agent profiles, presets, and run logs.
"""
from django.db import models
from django.contrib.auth.models import User


class AgentProfile(models.Model):
    """User-configurable agent profile"""
    AGENT_TYPE_CHOICES = [
        ("simple", "Simple"),
        ("complex", "Complex"),
        ("react", "ReAct"),
        ("ralph", "Ralph Wiggum"),
    ]
    RUNTIME_CHOICES = [
        ("internal", "Internal"),
        ("cursor", "Cursor CLI"),
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
