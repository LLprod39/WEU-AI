"""
HTML page views for agent_hub.

This module contains views that render HTML templates.
"""
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from agent_hub.models import (
    AgentProfile,
    AgentPreset,
    AgentRun,
    AgentWorkflow,
    AgentWorkflowRun,
)
from agent_hub.views.utils import get_project_folders, is_admin
from core_ui.decorators import require_feature
from core_ui.middleware import get_template_name


@login_required
@require_feature("agents", redirect_on_forbidden=True)
def agents_page(request):
    """Main agents page with profiles, workflows, and runs."""
    from servers.models import Server

    profiles = AgentProfile.objects.filter(owner=request.user, is_active=True)
    presets = AgentPreset.objects.all()
    recent_runs = AgentRun.objects.filter(initiated_by=request.user)[:10]
    workflows = AgentWorkflow.objects.filter(owner=request.user).select_related(
        "target_server"
    )[:10]
    workflow_runs = AgentWorkflowRun.objects.filter(initiated_by=request.user)[:10]

    # Build workflow runs data with progress info
    workflow_runs_data = []
    for run in workflow_runs:
        steps = (run.workflow.script or {}).get("steps", [])
        total_steps = len(steps)
        progress_pct = 0
        current_step_title = ""
        if total_steps:
            progress_pct = min(int((run.current_step / total_steps) * 100), 100)
            if 0 < run.current_step <= total_steps:
                current_step_title = steps[run.current_step - 1].get("title", "")
        workflow_runs_data.append({
            "run": run,
            "total_steps": total_steps,
            "progress_pct": progress_pct,
            "current_step_title": current_step_title,
        })

    presets_data = [
        {
            "name": preset.name,
            "description": preset.description,
            "agent_type": preset.agent_type,
            "runtime": preset.runtime,
            "config": preset.config,
        }
        for preset in presets
    ]

    workflows_data = [
        {
            "id": workflow.id,
            "name": workflow.name,
            "script": workflow.script,
            "project_path": workflow.project_path,
            "target_server_id": workflow.target_server_id,
            "target_server_name": (
                workflow.target_server.name if workflow.target_server else None
            ),
        }
        for workflow in workflows
    ]

    projects_data = get_project_folders(include_files_count=False)

    # User's servers for target server selection
    servers_data = [
        {"id": s.id, "name": s.name, "host": s.host}
        for s in Server.objects.filter(user=request.user).only("id", "name", "host")
    ]

    # Use new simplified template by default, legacy with ?legacy=1
    use_legacy = request.GET.get("legacy") == "1"
    if getattr(request, "is_mobile", False):
        template = "agent_hub/mobile/agents.html"
    elif use_legacy:
        template = "agent_hub/agents.html"
    else:
        template = "agent_hub/agents_new.html"

    return render(
        request,
        template,
        {
            "profiles": profiles,
            "presets": presets,
            "recent_runs": recent_runs,
            "workflows": workflows,
            "workflow_runs": workflow_runs_data,
            "presets_data": presets_data,
            "workflows_data": workflows_data,
            "projects_data": projects_data,
            "servers_data": servers_data,
        },
    )


@login_required
@require_feature("agents", redirect_on_forbidden=True)
@require_http_methods(["GET"])
def logs_page(request):
    """Logs viewing page for agent/workflow runs."""
    run_type = (request.GET.get("type") or "workflow").strip()
    run_id = (request.GET.get("run_id") or "").strip()
    return render(
        request,
        "agent_hub/logs.html",
        {
            "run_type": run_type,
            "run_id": run_id,
        },
    )


@login_required
@require_feature("agents", redirect_on_forbidden=True)
@require_http_methods(["GET"])
def admin_logs_page(request):
    """Admin logs page - requires admin privileges."""
    if not is_admin(request):
        return HttpResponseForbidden("Forbidden")
    return render(request, "agent_hub/admin_logs.html", {})


@login_required
@require_feature("agents")
def custom_agents_view(request):
    """Custom agents management page."""
    from servers.models import Server
    
    servers_data = [
        {"id": s.id, "name": s.name, "host": s.host}
        for s in Server.objects.filter(user=request.user, is_active=True)
    ]
    
    template = get_template_name(request, "agent_hub/custom_agents.html")
    return render(request, template, {"servers_data": servers_data})
