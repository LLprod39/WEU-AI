from django.contrib import admin

from skills.models import Skill, SkillShare, SkillSyncLog


@admin.register(Skill)
class SkillAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "slug",
        "owner",
        "status",
        "version",
        "source_type",
        "auto_sync_enabled",
        "is_active",
        "updated_at",
    )
    list_filter = ("status", "source_type", "auto_sync_enabled", "is_active")
    search_fields = ("name", "slug", "description")
    autocomplete_fields = ("owner",)


@admin.register(SkillSyncLog)
class SkillSyncLogAdmin(admin.ModelAdmin):
    list_display = ("id", "skill", "success", "created_at")
    list_filter = ("success",)
    search_fields = ("skill__name", "message")
    autocomplete_fields = ("skill",)


@admin.register(SkillShare)
class SkillShareAdmin(admin.ModelAdmin):
    list_display = ("id", "skill", "shared_with", "shared_by", "can_edit", "can_manage", "updated_at")
    list_filter = ("can_edit", "can_manage")
    search_fields = ("skill__name", "shared_with__username", "shared_by__username")
    autocomplete_fields = ("skill", "shared_with", "shared_by")
