import json
from datetime import timedelta

import pytest
from django.utils import timezone

from app.tools.tasks_tools import TasksListTool, TaskCreateTool, TaskUpdateTool, TaskDeleteTool


@pytest.mark.django_db
def test_tasks_list_total_count_and_has_more(user):
    from tasks.models import Task

    Task.objects.create(
        title="Urgent",
        status="TODO",
        priority="HIGH",
        due_date=timezone.now() + timedelta(days=1),
        created_by=user,
    )
    Task.objects.create(
        title="Later",
        status="IN_PROGRESS",
        priority="MEDIUM",
        due_date=timezone.now() + timedelta(days=5),
        created_by=user,
    )
    Task.objects.create(
        title="Done",
        status="DONE",
        priority="LOW",
        created_by=user,
    )

    tool = TasksListTool()
    raw = tool._execute_sync(
        _context={"user_id": user.id},
        include_completed=False,
        sort_by="urgency",
        limit=1,
        offset=0,
    )
    data = json.loads(raw)

    assert data["total_count"] == 2
    assert data["returned_count"] == 1
    assert data["has_more"] is True
    assert data["status_stats"]["TODO"] == 1
    assert data["status_stats"]["IN_PROGRESS"] == 1


@pytest.mark.django_db
def test_task_create_and_update_tools(user):
    create_tool = TaskCreateTool()
    created_raw = create_tool._execute_sync(
        _context={"user_id": user.id},
        title="Deploy Redis",
        description="Run redis in docker",
        priority="HIGH",
        status="TODO",
    )
    created_data = json.loads(created_raw)
    assert created_data["success"] is True
    task_id = created_data["task"]["id"]

    update_tool = TaskUpdateTool()
    updated_raw = update_tool._execute_sync(
        _context={"user_id": user.id},
        task_id=task_id,
        status="IN_PROGRESS",
        due_date=(timezone.now() + timedelta(days=2)).isoformat(),
    )
    updated_data = json.loads(updated_raw)
    assert updated_data["success"] is True
    assert updated_data["task"]["status"] == "IN_PROGRESS"
    assert updated_data["task"]["due_date"] is not None


@pytest.mark.django_db
def test_task_delete_tool_requires_confirm_and_deletes(user):
    from tasks.models import Task

    task = Task.objects.create(
        title="Delete me",
        status="TODO",
        priority="LOW",
        created_by=user,
    )

    tool = TaskDeleteTool()
    no_confirm = tool._execute_sync(
        _context={"user_id": user.id},
        task_id=task.id,
    )
    assert "confirm=true" in no_confirm

    confirmed = tool._execute_sync(
        _context={"user_id": user.id},
        task_id=task.id,
        confirm=True,
    )
    confirmed_data = json.loads(confirmed)
    assert confirmed_data["success"] is True
    assert confirmed_data["deleted_task"]["id"] == task.id
    assert not Task.objects.filter(id=task.id).exists()
