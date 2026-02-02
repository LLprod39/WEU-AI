"""
Celery tasks for task management.

These tasks replace the threading-based background execution
with proper async task queue processing.

Usage:
    from tasks.tasks import analyze_task_async

    # Queue task for background processing
    analyze_task_async.delay(task_id, user_id)

    # Or with options
    analyze_task_async.apply_async(
        args=[task_id, user_id],
        countdown=5,  # delay 5 seconds
    )
"""
from celery import shared_task
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_kwargs={"max_retries": 3},
    acks_late=True,
)
def analyze_task_async(self, task_id: int, user_id: int) -> dict:
    """
    Analyze a task in the background using SmartTaskAnalyzer.

    This replaces the threading-based _background_analyze_task function
    in tasks/views.py.

    Args:
        task_id: ID of the Task to analyze
        user_id: ID of the User who requested the analysis

    Returns:
        dict with analysis results
    """
    from django.contrib.auth import get_user_model
    from tasks.models import Task
    from tasks.smart_analyzer import SmartTaskAnalyzer

    User = get_user_model()

    logger.info(f"Starting task analysis: task_id={task_id}, user_id={user_id}")

    try:
        task = Task.objects.get(id=task_id)
        user = User.objects.get(id=user_id)
    except Task.DoesNotExist:
        logger.error(f"Task {task_id} not found")
        return {"error": f"Task {task_id} not found"}
    except User.DoesNotExist:
        logger.error(f"User {user_id} not found")
        return {"error": f"User {user_id} not found"}

    try:
        analyzer = SmartTaskAnalyzer()
        result = analyzer.analyze(task, user)

        logger.info(f"Task analysis completed: task_id={task_id}")
        return {
            "success": True,
            "task_id": task_id,
            "result": result,
        }
    except Exception as e:
        logger.exception(f"Task analysis failed: task_id={task_id}, error={e}")
        # Re-raise to trigger retry
        raise


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_kwargs={"max_retries": 3},
    acks_late=True,
    time_limit=1800,  # 30 minutes hard limit
    soft_time_limit=1500,  # 25 minutes soft limit
)
def run_workflow_async(self, workflow_id: int, run_id: int) -> dict:
    """
    Run a workflow in the background.

    Args:
        workflow_id: ID of the Workflow to run
        run_id: ID of the WorkflowRun instance

    Returns:
        dict with execution results
    """
    from agent_hub.models import Workflow, WorkflowRun

    logger.info(f"Starting workflow: workflow_id={workflow_id}, run_id={run_id}")

    try:
        workflow = Workflow.objects.get(id=workflow_id)
        run = WorkflowRun.objects.get(id=run_id)
    except Workflow.DoesNotExist:
        logger.error(f"Workflow {workflow_id} not found")
        return {"error": f"Workflow {workflow_id} not found"}
    except WorkflowRun.DoesNotExist:
        logger.error(f"WorkflowRun {run_id} not found")
        return {"error": f"WorkflowRun {run_id} not found"}

    try:
        # Update run status
        run.status = "running"
        run.save(update_fields=["status"])

        # TODO: Implement actual workflow execution
        # This will be filled in when workflow_service.py is created
        # For now, just mark as completed
        result = {"message": "Workflow execution placeholder"}

        run.status = "completed"
        run.save(update_fields=["status"])

        logger.info(f"Workflow completed: workflow_id={workflow_id}, run_id={run_id}")
        return {
            "success": True,
            "workflow_id": workflow_id,
            "run_id": run_id,
            "result": result,
        }
    except Exception as e:
        logger.exception(f"Workflow failed: workflow_id={workflow_id}, error={e}")
        run.status = "failed"
        run.save(update_fields=["status"])
        raise


@shared_task(bind=True)
def sync_jira_task(self, task_id: int) -> dict:
    """
    Sync a task with Jira in the background.

    Args:
        task_id: ID of the Task to sync

    Returns:
        dict with sync results
    """
    from tasks.models import Task

    logger.info(f"Syncing task with Jira: task_id={task_id}")

    try:
        task = Task.objects.get(id=task_id)
    except Task.DoesNotExist:
        logger.error(f"Task {task_id} not found")
        return {"error": f"Task {task_id} not found"}

    if not task.external_id or task.external_system != "jira":
        return {"error": "Task is not linked to Jira"}

    try:
        # TODO: Implement Jira sync logic
        # This will use app/integrations/jira_connector.py
        result = {"message": "Jira sync placeholder"}

        logger.info(f"Jira sync completed: task_id={task_id}")
        return {
            "success": True,
            "task_id": task_id,
            "result": result,
        }
    except Exception as e:
        logger.exception(f"Jira sync failed: task_id={task_id}, error={e}")
        raise
