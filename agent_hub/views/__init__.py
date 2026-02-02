"""
Agent Hub Views Package.

This package contains views split by domain:
- pages: HTML page views (agents_page, logs_page, etc.)
- profiles: Agent profile CRUD operations
- workflows: Workflow CRUD and generation
- execution: Workflow and agent run execution
- admin: Admin panel views
- mcp: MCP server management
- custom_agents: Custom agent management

For backward compatibility, all views are re-exported from this module.
New code should import from specific submodules.

Example:
    # Old way (still works)
    from agent_hub.views import agents_page

    # New way (preferred)
    from agent_hub.views.pages import agents_page
"""
# Re-export everything from the legacy views module for backward compatibility
# This allows existing code to continue using `from agent_hub.views import ...`
#
# As views are migrated to submodules, remove them from this import
# and add them from the new location.

# Import from new modular structure
from agent_hub.views.pages import (
    agents_page,
    logs_page,
    admin_logs_page,
    custom_agents_view,
)

from agent_hub.views_legacy import (
    # Profiles API
    api_profiles_list,
    api_profiles_create,
    api_profiles_update,
    api_profiles_delete,
    api_profile_run,
    # Agent Runs API
    api_agent_run,
    api_runs_list,
    api_run_status,
    api_run_stop,
    api_run_delete,
    # Projects API
    api_projects_list,
    api_projects_create,
    # Workflows API
    api_workflows_list,
    api_workflow_import,
    api_workflow_get,
    api_workflow_update,
    api_workflow_delete,
    api_workflow_generate,
    api_workflow_from_task,
    api_workflow_create_manual,
    api_tasks_generate,
    # Workflow Runs API
    api_workflow_run,
    api_workflow_run_status,
    api_workflow_stop,
    api_workflow_restart,
    api_workflow_skip_step,
    api_workflow_skip_specific_step,
    api_workflow_continue,
    api_workflow_retry_step,
    api_workflow_run_delete,
    api_workflow_download_project,
    # Admin API
    admin_api_runs_list,
    admin_api_run_status,
    admin_api_run_update,
    admin_api_run_restart,
    admin_api_workflow_run_status,
    admin_api_workflow_run_update,
    admin_api_workflow_run_restart,
    # Assist API
    api_assist_config,
    api_assist_auto,
    # MCP API
    api_mcp_servers,
    api_mcp_server_connect,
    api_mcp_server_disconnect,
    api_mcp_server_tools,
    # Models and Smart Analyze
    api_list_models,
    api_smart_analyze,
    # Custom Agents API
    api_custom_agents_list,
    api_custom_agent_detail,
    api_custom_agent_export,
    # Helper functions used by other modules
    _generate_workflow_script,
    _start_workflow_run,
    _write_ralph_yml,
    create_workflow_from_task,
)

__all__ = [
    # Pages
    "agents_page",
    "logs_page",
    "admin_logs_page",
    "custom_agents_view",
    # Profiles API
    "api_profiles_list",
    "api_profiles_create",
    "api_profiles_update",
    "api_profiles_delete",
    "api_profile_run",
    # Agent Runs API
    "api_agent_run",
    "api_runs_list",
    "api_run_status",
    "api_run_stop",
    "api_run_delete",
    # Projects API
    "api_projects_list",
    "api_projects_create",
    # Workflows API
    "api_workflows_list",
    "api_workflow_import",
    "api_workflow_get",
    "api_workflow_update",
    "api_workflow_delete",
    "api_workflow_generate",
    "api_workflow_from_task",
    "api_workflow_create_manual",
    "api_tasks_generate",
    # Workflow Runs API
    "api_workflow_run",
    "api_workflow_run_status",
    "api_workflow_stop",
    "api_workflow_restart",
    "api_workflow_skip_step",
    "api_workflow_skip_specific_step",
    "api_workflow_continue",
    "api_workflow_retry_step",
    "api_workflow_run_delete",
    "api_workflow_download_project",
    # Admin API
    "admin_api_runs_list",
    "admin_api_run_status",
    "admin_api_run_update",
    "admin_api_run_restart",
    "admin_api_workflow_run_status",
    "admin_api_workflow_run_update",
    "admin_api_workflow_run_restart",
    # Assist API
    "api_assist_config",
    "api_assist_auto",
    # MCP API
    "api_mcp_servers",
    "api_mcp_server_connect",
    "api_mcp_server_disconnect",
    "api_mcp_server_tools",
    # Models and Smart Analyze
    "api_list_models",
    "api_smart_analyze",
    # Custom Agents API
    "api_custom_agents_list",
    "api_custom_agent_detail",
    "api_custom_agent_export",
    # Helper functions
    "_generate_workflow_script",
    "_start_workflow_run",
    "_write_ralph_yml",
    "create_workflow_from_task",
]
