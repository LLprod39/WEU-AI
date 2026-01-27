from django.urls import path
from . import views

app_name = "agent_hub"

urlpatterns = [
    path("", views.agents_page, name="agents_page"),
    path("api/profiles/", views.api_profiles_list, name="api_profiles_list"),
    path("api/profiles/create/", views.api_profiles_create, name="api_profiles_create"),
    path("api/profiles/<int:profile_id>/update/", views.api_profiles_update, name="api_profiles_update"),
    path("api/profiles/<int:profile_id>/delete/", views.api_profiles_delete, name="api_profiles_delete"),
    path("api/run/", views.api_agent_run, name="api_agent_run"),
    path("api/runs/", views.api_runs_list, name="api_runs_list"),
    path("api/runs/<int:run_id>/status/", views.api_run_status, name="api_run_status"),
    path("api/runs/<int:run_id>/stop/", views.api_run_stop, name="api_run_stop"),
    path("api/runs/<int:run_id>/delete/", views.api_run_delete, name="api_run_delete"),
    path("api/assist-config/", views.api_assist_config, name="api_assist_config"),
    path("api/projects/", views.api_projects_list, name="api_projects_list"),
    path("api/projects/create/", views.api_projects_create, name="api_projects_create"),
    path("api/workflows/", views.api_workflows_list, name="api_workflows_list"),
    path("api/workflows/import/", views.api_workflow_import, name="api_workflow_import"),
    path("api/workflows/<int:workflow_id>/", views.api_workflow_get, name="api_workflow_get"),
    path("api/workflows/<int:workflow_id>/update/", views.api_workflow_update, name="api_workflow_update"),
    path("api/workflows/<int:workflow_id>/delete/", views.api_workflow_delete, name="api_workflow_delete"),
    path("api/workflows/generate/", views.api_workflow_generate, name="api_workflow_generate"),
    path("api/workflows/create-manual/", views.api_workflow_create_manual, name="api_workflow_create_manual"),
    path("api/tasks/generate/", views.api_tasks_generate, name="api_tasks_generate"),
    path("api/workflows/run/", views.api_workflow_run, name="api_workflow_run"),
    path("api/workflows/run/<int:run_id>/status/", views.api_workflow_run_status, name="api_workflow_run_status"),
    path("api/workflows/run/<int:run_id>/stop/", views.api_workflow_stop, name="api_workflow_stop"),
    path("api/workflows/run/<int:run_id>/restart/", views.api_workflow_restart, name="api_workflow_restart"),
    path("api/workflows/run/<int:run_id>/delete/", views.api_workflow_run_delete, name="api_workflow_run_delete"),
    path("api/assist-auto/", views.api_assist_auto, name="api_assist_auto"),
]
