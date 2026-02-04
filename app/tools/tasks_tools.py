"""
Tools for accessing Tasks data for the current user.
"""
import json
from typing import Any, Dict, Optional

from app.tools.base import BaseTool, ToolMetadata, ToolParameter
from app.services.permissions import PermissionService
from asgiref.sync import sync_to_async


def _get_user_id(kwargs: Dict[str, Any]) -> Optional[int]:
    ctx = kwargs.get("_context") or {}
    user_id = ctx.get("user_id")
    if not user_id:
        return None
    try:
        return int(user_id)
    except (TypeError, ValueError):
        return None


def _dt(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


class TasksListTool(BaseTool):
    """Список задач пользователя из раздела Tasks."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="tasks_list",
            description=(
                "Список задач пользователя из раздела Tasks. "
                "Возвращает JSON с полными данными: total_count, status_stats (статистика по статусам), "
                "и массив tasks с деталями каждой задачи. "
                "Можно фильтровать по статусу и искать по тексту."
            ),
            category="tasks",
            parameters=[
                ToolParameter(
                    name="status",
                    type="string",
                    description="Фильтр по статусу (TODO, IN_PROGRESS, DONE, BLOCKED, CANCELLED). Можно через запятую.",
                    required=False,
                ),
                ToolParameter(
                    name="search",
                    type="string",
                    description="Поиск по title/description (частичное совпадение).",
                    required=False,
                ),
                ToolParameter(
                    name="limit",
                    type="integer",
                    description="Максимум задач (1-100). По умолчанию 20.",
                    required=False,
                ),
            ],
        )

    async def execute(self, **kwargs) -> Any:
        return await sync_to_async(self._execute_sync, thread_sensitive=True)(**kwargs)

    def _execute_sync(self, **kwargs) -> Any:
        user_id = _get_user_id(kwargs)
        if not user_id:
            return "Требуется контекст пользователя (user_id). Используй только в чате WEU AI."

        from django.contrib.auth.models import User
        from django.db.models import Q
        from collections import Counter

        user = User.objects.filter(id=user_id).first()
        if not user:
            return "Пользователь не найден."

        qs = PermissionService.get_tasks_for_user(user).select_related(
            "assignee", "created_by", "target_server"
        )

        status = (kwargs.get("status") or "").strip()
        if status:
            statuses = [s.strip().upper() for s in status.split(",") if s.strip()]
            if statuses:
                qs = qs.filter(status__in=statuses)

        search = (kwargs.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))

        try:
            limit = int(kwargs.get("limit") or 20)
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(100, limit))

        # Получаем все задачи до лимита для подсчёта статистики
        all_tasks = list(qs.order_by("-updated_at")[:limit])

        # Статистика по статусам (простой подсчёт)
        status_stats = dict(Counter(t.status for t in all_tasks))
        total_count = len(all_tasks)

        def _preview(text: str) -> str:
            if not text:
                return ""
            cleaned = " ".join(text.split())
            return (cleaned[:160] + "...") if len(cleaned) > 160 else cleaned

        items = []
        for t in all_tasks:
            items.append({
                "id": t.id,
                "title": t.title,
                "description": _preview(t.description or ""),
                "status": t.status,
                "priority": getattr(t, "priority", None),
                "due_date": _dt(t.due_date),
                "created_at": _dt(t.created_at),
                "updated_at": _dt(t.updated_at),
                "completed_at": _dt(t.completed_at),
                "assignee": t.assignee.username if t.assignee else None,
                "created_by": t.created_by.username if t.created_by else None,
                "target_server": t.target_server.name if getattr(t, "target_server", None) else None,
            })

        result = {
            "total_count": total_count,
            "returned_count": len(items),
            "limit": limit,
            "status_stats": status_stats,
            "tasks": items,
        }
        return json.dumps(result, ensure_ascii=False, indent=2)


class TaskDetailTool(BaseTool):
    """Подробная информация по задаче."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="task_detail",
            description="Подробная информация по задаче из раздела Tasks по id.",
            category="tasks",
            parameters=[
                ToolParameter(
                    name="task_id",
                    type="integer",
                    description="ID задачи",
                )
            ],
        )

    async def execute(self, **kwargs) -> Any:
        return await sync_to_async(self._execute_sync, thread_sensitive=True)(**kwargs)

    def _execute_sync(self, **kwargs) -> Any:
        user_id = _get_user_id(kwargs)
        if not user_id:
            return "Требуется контекст пользователя (user_id). Используй только в чате WEU AI."

        from django.contrib.auth.models import User
        from tasks.models import Task

        user = User.objects.filter(id=user_id).first()
        if not user:
            return "Пользователь не найден."

        task_id = kwargs.get("task_id")
        if task_id is None:
            return "Нужен параметр task_id."

        try:
            task_id = int(task_id)
        except (TypeError, ValueError):
            return "task_id должен быть числом."

        task = Task.objects.filter(id=task_id).select_related(
            "assignee", "created_by", "target_server"
        ).prefetch_related("subtasks").first()
        if not task or not PermissionService.can_view_task(user, task):
            return "Задача не найдена или нет доступа."

        data = {
            "id": task.id,
            "title": task.title,
            "description": task.description or "",
            "status": task.status,
            "priority": getattr(task, "priority", None),
            "due_date": _dt(task.due_date),
            "created_at": _dt(task.created_at),
            "updated_at": _dt(task.updated_at),
            "started_at": _dt(task.started_at),
            "completed_at": _dt(task.completed_at),
            "assignee": task.assignee.username if task.assignee else None,
            "created_by": task.created_by.username if task.created_by else None,
            "target_server": task.target_server.name if getattr(task, "target_server", None) else None,
            "subtasks": [
                {"id": s.id, "title": s.title, "is_completed": s.is_completed}
                for s in task.subtasks.all()
            ],
        }

        return json.dumps(data, ensure_ascii=False, indent=2)
