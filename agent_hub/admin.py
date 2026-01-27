from django.contrib import admin
from .models import AgentProfile, AgentPreset, AgentRun, AgentWorkflow, AgentWorkflowRun


@admin.register(AgentProfile)
class AgentProfileAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "agent_type", "runtime", "owner", "is_default", "is_active", "updated_at")
    search_fields = ("name", "description", "owner__username")
    list_filter = ("agent_type", "runtime", "is_default", "is_active")


@admin.register(AgentPreset)
class AgentPresetAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "agent_type", "runtime", "is_system")
    search_fields = ("name", "description")


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = ("id", "runtime", "status", "initiated_by", "created_at")
    list_filter = ("runtime", "status")
    search_fields = ("input_task", "output_text")


@admin.register(AgentWorkflow)
class AgentWorkflowAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "runtime", "owner", "created_at")
    search_fields = ("name", "description", "owner__username")
    list_filter = ("runtime",)


@admin.register(AgentWorkflowRun)
class AgentWorkflowRunAdmin(admin.ModelAdmin):
    list_display = ("id", "workflow", "status", "current_step", "created_at")
    list_filter = ("status",)
