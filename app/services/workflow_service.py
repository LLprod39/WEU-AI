"""
Workflow service for WEU AI Platform.

This module contains workflow creation and management logic
extracted from agent_hub/views.py to break circular imports
and centralize business logic.

Usage:
    from app.services.workflow_service import WorkflowService

    workflow, run = WorkflowService.create_from_task(task, user)
"""
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from django.conf import settings
from loguru import logger

if TYPE_CHECKING:
    from django.contrib.auth.models import User
    from tasks.models import Task
    from agent_hub.models import AgentWorkflow, AgentWorkflowRun


class WorkflowService:
    """
    Service for workflow creation and management.

    Centralizes workflow-related business logic that was previously
    scattered across view functions.
    """

    @staticmethod
    def create_from_task(task: "Task", user: "User") -> tuple["AgentWorkflow | None", "AgentWorkflowRun | None"]:
        """
        Create a workflow from a Task and start its execution.

        This is the main entry point for creating workflows from the Tasks module.
        It breaks the circular import between tasks and agent_hub.

        Args:
            task: Task instance to create workflow from
            user: User who initiates the workflow

        Returns:
            Tuple of (workflow, run) or (None, None) if creation failed
        """
        # Import models here to avoid circular imports at module level
        from agent_hub.models import AgentWorkflow
        from app.core.model_config import model_manager

        # Import helper functions from views (will be moved to services later)
        from agent_hub.views import (
            _generate_workflow_script,
            _start_workflow_run,
            _write_ralph_yml,
        )

        task_text = f"{task.title}\n\n{task.description or ''}".strip()
        if not task_text:
            logger.error(f"Task {task.id} has no title/description")
            return None, None

        # Get project path from config
        project_path = ""
        try:
            project_path = (
                getattr(model_manager.config, "default_agent_output_path", None) or ""
            ).strip()
        except Exception:
            pass

        # Get target server from task
        target_server = getattr(task, "target_server", None)
        target_server_id = target_server.id if target_server else None
        target_server_name = target_server.name if target_server else None

        # Get runtime from settings
        default_runtime = model_manager.config.default_provider or "cursor"
        
        # Load recommended CustomAgent if specified
        custom_agent = None
        if hasattr(task, 'recommended_custom_agent_id') and task.recommended_custom_agent_id:
            from agent_hub.models import CustomAgent
            custom_agent = CustomAgent.objects.filter(
                id=task.recommended_custom_agent_id, 
                owner=user, 
                is_active=True
            ).first()
        
        # If custom_agent exists, use its parameters
        if custom_agent:
            default_runtime = custom_agent.runtime
            logger.info(f"Using CustomAgent {custom_agent.name} (id={custom_agent.id}) for task {task.id}")
            
            # Add knowledge_base to task text if available
            if hasattr(custom_agent, 'knowledge_base') and custom_agent.knowledge_base:
                task_text += f"\n\n--- База знаний агента ---\n{custom_agent.knowledge_base}"
                logger.info(f"Added knowledge_base to task text for agent {custom_agent.name}")

        # Generate workflow script
        parsed = _generate_workflow_script(
            task_text,
            default_runtime,
            from_task=True,
            user_id=user.id,
            target_server_id=target_server_id,
            target_server_name=target_server_name,
        )
        if not parsed:
            logger.error(f"Failed to generate workflow for task {task.id}")
            return None, None

        # Create workflow
        workflow = AgentWorkflow.objects.create(
            owner=user,
            name=parsed.get("name", (task.title or "Workflow")[:80]),
            description=parsed.get("description", "") or (task.description or "")[:200],
            runtime=default_runtime,
            script=parsed,
            project_path=project_path,
            target_server=target_server,
        )

        # Log creation
        if target_server:
            logger.info(
                f"Workflow {workflow.id} created from task {task.id} "
                f"with target_server: {target_server.name} ({target_server.host})"
            )
        else:
            logger.warning(
                f"Workflow {workflow.id} created from task {task.id} WITHOUT target_server!"
            )

        # Save workflow script to file
        workflows_dir = Path(settings.MEDIA_ROOT) / "workflows"
        workflows_dir.mkdir(parents=True, exist_ok=True)
        file_path = workflows_dir / f"workflow-{workflow.id}.json"
        parsed["script_file"] = str(file_path)

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(parsed, f, ensure_ascii=False, indent=2)

        # Save Ralph YAML if present
        if parsed.get("ralph_yml"):
            ralph_path = workflows_dir / f"workflow-{workflow.id}.ralph.yml"
            parsed["ralph_yml_path"] = str(ralph_path)
            _write_ralph_yml(ralph_path, parsed["ralph_yml"])

        workflow.script = parsed
        workflow.save(update_fields=["script"])

        # Start workflow execution
        run = _start_workflow_run(workflow, user)

        # Update task status
        task.ai_execution_status = "RUNNING"
        task.save(update_fields=["ai_execution_status"])

        return workflow, run

    @staticmethod
    def get_workflow_status(workflow_id: int, user: "User") -> dict[str, Any] | None:
        """
        Get current status of a workflow.

        Args:
            workflow_id: ID of the workflow
            user: User requesting the status (for permission check)

        Returns:
            Status dict or None if not found/not authorized
        """
        from agent_hub.models import AgentWorkflow, AgentWorkflowRun
        from app.services.permissions import PermissionService

        try:
            workflow = AgentWorkflow.objects.get(id=workflow_id)
        except AgentWorkflow.DoesNotExist:
            return None

        if not PermissionService.can_view_workflow(user, workflow):
            return None

        # Get latest run
        latest_run = (
            AgentWorkflowRun.objects.filter(workflow=workflow)
            .order_by("-created_at")
            .first()
        )

        steps = (workflow.script or {}).get("steps", [])
        total_steps = len(steps)

        status = {
            "workflow_id": workflow.id,
            "name": workflow.name,
            "total_steps": total_steps,
            "has_run": latest_run is not None,
        }

        if latest_run:
            status.update({
                "run_id": latest_run.id,
                "run_status": latest_run.status,
                "current_step": latest_run.current_step,
                "finished_at": latest_run.finished_at.isoformat() if latest_run.finished_at else None,
            })

        return status


# =============================================================================
# Backward Compatibility Function
# =============================================================================
# This function maintains compatibility with existing code.
# New code should use WorkflowService.create_from_task() directly.


def create_workflow_from_task(task: "Task", user: "User") -> tuple["AgentWorkflow | None", "AgentWorkflowRun | None"]:
    """
    Backward compatibility alias for WorkflowService.create_from_task().

    Deprecated: Use WorkflowService.create_from_task() directly.
    """
    return WorkflowService.create_from_task(task, user)
