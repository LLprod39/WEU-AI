"""
Helpers for deterministic task board payloads in chat responses.
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


STATUS_ORDER = ("TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED")


def _parse_tool_payload(tool_result: Any) -> Optional[Dict[str, Any]]:
    if isinstance(tool_result, dict):
        return tool_result
    if isinstance(tool_result, str):
        try:
            parsed = json.loads(tool_result)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _normalize_task(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        task_id = int(item.get("id"))
    except (TypeError, ValueError):
        return None

    status = str(item.get("status") or "TODO").upper()
    priority = str(item.get("priority") or "MEDIUM").upper()
    assignee = item.get("assignee") or item.get("assignee_username")

    return {
        "id": task_id,
        "title": str(item.get("title") or f"Task #{task_id}"),
        "description": str(item.get("description") or "").strip(),
        "status": status,
        "priority": priority,
        "assignee": assignee if assignee else None,
        "due_date": item.get("due_date"),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
        "completed_at": item.get("completed_at"),
        "target_server": item.get("target_server") or item.get("target_server_name"),
        "actions": {
            "view": f"task:{task_id}",
            "open": f"/tasks/{task_id}/",
            "chat": f"/chat/?task_id={task_id}",
            "can_take_in_progress": status in {"TODO", "BLOCKED"},
            "can_delete": bool(item.get("can_delete")),
        },
    }


def build_task_board_payload(
    tool_name: str,
    tool_result: Any,
    query: str = "",
) -> Optional[Dict[str, Any]]:
    payload = _parse_tool_payload(tool_result)
    if not payload:
        return None

    if tool_name == "tasks_list":
        raw_tasks = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
        total_count = payload.get("total_count")
        has_more = bool(payload.get("has_more"))
        offset = payload.get("offset")
        limit = payload.get("limit")
    elif tool_name == "task_detail":
        raw_tasks = [payload] if payload.get("id") else []
        total_count = len(raw_tasks)
        has_more = False
        offset = 0
        limit = 1
    else:
        return None

    tasks: List[Dict[str, Any]] = []
    for raw_task in raw_tasks:
        if not isinstance(raw_task, dict):
            continue
        normalized = _normalize_task(raw_task)
        if normalized:
            tasks.append(normalized)

    status_stats: Dict[str, int] = {status: 0 for status in STATUS_ORDER}
    for task in tasks:
        status = task["status"]
        status_stats[status] = status_stats.get(status, 0) + 1

    try:
        total = int(total_count)
    except (TypeError, ValueError):
        total = len(tasks)

    active = (
        status_stats.get("TODO", 0)
        + status_stats.get("IN_PROGRESS", 0)
        + status_stats.get("BLOCKED", 0)
    )
    completed = status_stats.get("DONE", 0)

    return {
        "type": "task_board",
        "schema_version": 1,
        "source_tool": tool_name,
        "query": query,
        "query_params": payload.get("query") if isinstance(payload.get("query"), dict) else {},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status_order": list(STATUS_ORDER),
        "summary": {
            "total": total,
            "returned": len(tasks),
            "active": active,
            "completed": completed,
            "has_more": has_more,
            "offset": offset,
            "limit": limit,
            "status_stats": status_stats,
        },
        "tasks": tasks,
    }
