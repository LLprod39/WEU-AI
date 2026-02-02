"""
Service layer for WEU AI Platform.

This module contains business logic extracted from views.
Services should be the primary location for complex operations
that span multiple models or require external integrations.

Modules:
    - permissions: Centralized permission checks
    - workflow_service: Workflow creation and execution logic
    - task_service: Task analysis and processing (TODO)
    - agent_service: Agent management (TODO)
    - execution_service: CLI agent execution (TODO)
"""
from app.services.permissions import PermissionService
from app.services.server_metrics import collect_metrics
from app.services.workflow_service import WorkflowService, create_workflow_from_task

__all__ = [
    "PermissionService",
    "WorkflowService",
    "create_workflow_from_task",
    "collect_metrics",
]
