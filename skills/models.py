from django.conf import settings
from django.db import models
from django.db.models import Q


class Skill(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_STAGING = "staging"
    STATUS_PROD = "prod"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_STAGING, "Staging"),
        (STATUS_PROD, "Production"),
    ]

    SOURCE_MANUAL = "manual"
    SOURCE_GIT = "git"
    SOURCE_CHOICES = [
        (SOURCE_MANUAL, "Manual"),
        (SOURCE_GIT, "Git"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="skills",
        help_text="null = глобальный корпоративный skill",
    )
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)

    # Core content
    system_prompt = models.TextField(blank=True, default="")
    instructions = models.TextField(blank=True, default="")
    rules = models.TextField(blank=True, default="")
    references = models.JSONField(
        default=list,
        blank=True,
        help_text='Список объектов вида {"title": "...", "content": "..."}',
    )
    variables = models.JSONField(default=dict, blank=True)
    tags = models.JSONField(default=list, blank=True)

    # Runtime and auto-apply behavior
    allowed_runtimes = models.JSONField(
        default=list,
        blank=True,
        help_text='Пусто = для всех runtime, иначе список: ["cursor", "claude", ...]',
    )
    server_scope_all = models.BooleanField(
        default=True,
        help_text="True = применяется ко всем серверам пользователя. False = только выбранные server_ids.",
    )
    server_scope_ids = models.JSONField(
        default=list,
        blank=True,
        help_text="ID серверов, к которым относится этот skill (если server_scope_all=False).",
    )
    auto_apply_chat = models.BooleanField(default=False)
    auto_apply_agents = models.BooleanField(default=False)
    auto_apply_workflows = models.BooleanField(default=False)

    # Sync source
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_MANUAL)
    source_url = models.CharField(max_length=600, blank=True, default="")
    source_ref = models.CharField(max_length=120, blank=True, default="main")
    source_path = models.CharField(
        max_length=400,
        blank=True,
        default="SKILL.md",
        help_text="Файл или папка внутри репозитория (например SKILL.md или skills/devops)",
    )
    auto_sync_enabled = models.BooleanField(default=False)
    sync_interval_minutes = models.PositiveIntegerField(default=60)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_sync_error = models.TextField(blank=True, default="")

    # Lifecycle
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "slug"],
                name="skills_unique_owner_slug",
            ),
            models.UniqueConstraint(
                fields=["slug"],
                condition=Q(owner__isnull=True),
                name="skills_unique_global_slug",
            ),
        ]
        indexes = [
            models.Index(fields=["owner", "is_active", "status"]),
            models.Index(fields=["auto_sync_enabled", "last_synced_at"]),
            models.Index(fields=["updated_at"]),
        ]

    def __str__(self) -> str:
        scope = "global" if self.owner_id is None else f"user:{self.owner_id}"
        return f"{self.name} ({scope})"

    def supports_runtime(self, runtime: str | None) -> bool:
        if not runtime:
            return True
        allowed = self.allowed_runtimes or []
        if not allowed:
            return True
        return runtime in allowed

    def render_compact(self, include_references: bool = True, max_reference_chars: int = 2000) -> str:
        lines = [
            f"# Skill: {self.name}",
            f"Version: {self.version}",
        ]
        if self.description:
            lines.append(f"Description: {self.description.strip()}")
        if not self.server_scope_all and self.server_scope_ids:
            lines.append(f"Server Scope: {self.server_scope_ids}")
        if self.rules.strip():
            lines.append("\n[Rules]")
            lines.append(self.rules.strip())
        if self.system_prompt.strip():
            lines.append("\n[System Prompt]")
            lines.append(self.system_prompt.strip())
        if self.instructions.strip():
            lines.append("\n[Instructions]")
            lines.append(self.instructions.strip())

        if include_references and self.references:
            lines.append("\n[References]")
            spent = 0
            for item in self.references:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title") or "Reference").strip()
                content = str(item.get("content") or "").strip()
                if not content:
                    continue
                remain = max_reference_chars - spent
                if remain <= 0:
                    break
                snippet = content[:remain]
                spent += len(snippet)
                lines.append(f"- {title}: {snippet}")
        return "\n".join(lines)


class SkillShare(models.Model):
    skill = models.ForeignKey(Skill, on_delete=models.CASCADE, related_name="shares")
    shared_with = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="shared_skills",
    )
    shared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="granted_skill_shares",
    )
    can_edit = models.BooleanField(default=False)
    can_manage = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["skill", "shared_with"],
                name="skills_unique_share_per_user",
            )
        ]
        indexes = [
            models.Index(fields=["shared_with", "-updated_at"]),
            models.Index(fields=["skill", "-updated_at"]),
        ]

    def __str__(self) -> str:
        return f"SkillShare(skill={self.skill_id}, user={self.shared_with_id})"


class SkillSyncLog(models.Model):
    skill = models.ForeignKey(Skill, on_delete=models.CASCADE, related_name="sync_logs")
    success = models.BooleanField(default=False)
    message = models.TextField(blank=True, default="")
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["skill", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"SkillSyncLog(skill={self.skill_id}, success={self.success})"
