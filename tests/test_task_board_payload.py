import json

from app.core.task_board import build_task_board_payload


def test_build_task_board_payload_from_tasks_list():
    tool_result = json.dumps(
        {
            "total_count": 2,
            "status_stats": {"TODO": 1, "DONE": 1},
            "tasks": [
                {
                    "id": 10,
                    "title": "Настроить мониторинг",
                    "description": "Prometheus + alerts",
                    "status": "TODO",
                    "priority": "HIGH",
                    "assignee": "devops",
                    "due_date": "2026-02-10T12:00:00+00:00",
                    "can_delete": True,
                },
                {
                    "id": 11,
                    "title": "Проверить backup",
                    "status": "DONE",
                    "priority": "LOW",
                    "assignee": None,
                },
            ],
        }
    )

    payload = build_task_board_payload("tasks_list", tool_result, query="дай сводку")

    assert payload is not None
    assert payload["type"] == "task_board"
    assert payload["summary"]["total"] == 2
    assert payload["summary"]["active"] == 1
    assert payload["summary"]["completed"] == 1
    assert len(payload["tasks"]) == 2
    assert payload["tasks"][0]["actions"]["view"] == "task:10"
    assert payload["tasks"][0]["actions"]["can_take_in_progress"] is True
    assert payload["tasks"][0]["actions"]["can_delete"] is True
    assert payload["tasks"][1]["actions"]["can_take_in_progress"] is False
    assert payload["tasks"][1]["actions"]["can_delete"] is False


def test_build_task_board_payload_from_task_detail():
    tool_result = {
        "id": 42,
        "title": "Исправить API",
        "description": "500 на /api/chat/",
        "status": "IN_PROGRESS",
        "priority": "MEDIUM",
        "assignee": "backend",
    }

    payload = build_task_board_payload("task_detail", tool_result, query="детали")

    assert payload is not None
    assert payload["summary"]["returned"] == 1
    assert payload["summary"]["active"] == 1
    assert payload["tasks"][0]["id"] == 42
    assert payload["tasks"][0]["assignee"] == "backend"
