"""
Tools for accessing and managing Tasks data for the current user.
"""
import json
from typing import Any, Dict, Optional

from app.tools.base import BaseTool, ToolMetadata, ToolParameter
from app.services.permissions import PermissionService
from asgiref.sync import sync_to_async
from django.db.models import Q, Count, Case, When, Value, IntegerField
from django.utils import timezone
from django.utils.dateparse import parse_datetime


OPEN_STATUSES = ("TODO", "IN_PROGRESS", "BLOCKED")
ALL_STATUSES = ("TODO", "IN_PROGRESS", "DONE", "BLOCKED", "CANCELLED")
ALL_PRIORITIES = ("HIGH", "MEDIUM", "LOW")


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


def _preview(text: str) -> str:
    if not text:
        return ""
    cleaned = " ".join(text.split())
    return (cleaned[:220] + "...") if len(cleaned) > 220 else cleaned


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in ("1", "true", "yes", "y", "on", "да"):
        return True
    if text in ("0", "false", "no", "n", "off", "нет"):
        return False
    return default


def _parse_due_date(value: Any):
    if value in (None, ""):
        return None
    dt = parse_datetime(str(value))
    if dt is None:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt


def _task_json(task, user=None) -> Dict[str, Any]:
    can_delete = False
    if user is not None:
        try:
            can_delete = bool(PermissionService.can_delete_task(user, task))
        except Exception:
            can_delete = False
    return {
        "id": task.id,
        "title": task.title,
        "description": _preview(task.description or ""),
        "status": task.status,
        "priority": getattr(task, "priority", None),
        "due_date": _dt(task.due_date),
        "created_at": _dt(task.created_at),
        "updated_at": _dt(task.updated_at),
        "completed_at": _dt(task.completed_at),
        "assignee": task.assignee.username if task.assignee else None,
        "created_by": task.created_by.username if task.created_by else None,
        "target_server": task.target_server.name if getattr(task, "target_server", None) else None,
        "is_overdue": bool(task.is_overdue()) if hasattr(task, "is_overdue") else False,
        "can_delete": can_delete,
    }


class TasksListTool(BaseTool):
    """Список задач пользователя из раздела Tasks."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="tasks_list",
            description=(
                "Список задач пользователя из раздела Tasks. "
                "Поддерживает фильтры, дедлайны, сортировку по срочности и пагинацию. "
                "Используй для вопросов: какие задачи, что срочно, какие просрочены, что в работе."
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
                    name="include_completed",
                    type="boolean",
                    description="Включать завершённые (DONE/CANCELLED). По умолчанию true.",
                    required=False,
                ),
                ToolParameter(
                    name="overdue_only",
                    type="boolean",
                    description="Только просроченные задачи (due_date < now и статус не DONE/CANCELLED).",
                    required=False,
                ),
                ToolParameter(
                    name="due_before",
                    type="string",
                    description="Показать задачи с due_date <= этой даты (ISO-8601).",
                    required=False,
                ),
                ToolParameter(
                    name="sort_by",
                    type="string",
                    description="Сортировка: urgency|due_date|priority|updated_at|created_at. По умолчанию urgency.",
                    required=False,
                ),
                ToolParameter(
                    name="offset",
                    type="integer",
                    description="Смещение для пагинации (>=0).",
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

        user = User.objects.filter(id=user_id).first()
        if not user:
            return "Пользователь не найден."

        qs = PermissionService.get_tasks_for_user(user).select_related(
            "assignee", "created_by", "target_server"
        )

        status = (kwargs.get("status") or "").strip()
        if status:
            statuses = [s.strip().upper() for s in status.split(",") if s.strip()]
            statuses = [s for s in statuses if s in ALL_STATUSES]
            if statuses:
                qs = qs.filter(status__in=statuses)

        include_completed = _to_bool(kwargs.get("include_completed"), default=True)
        if not include_completed and not status:
            qs = qs.filter(status__in=OPEN_STATUSES)

        search = (kwargs.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))

        overdue_only = _to_bool(kwargs.get("overdue_only"), default=False)
        if overdue_only:
            qs = qs.filter(status__in=OPEN_STATUSES, due_date__lt=timezone.now())

        due_before = _parse_due_date(kwargs.get("due_before"))
        if due_before:
            qs = qs.filter(due_date__isnull=False, due_date__lte=due_before)

        sort_by = (kwargs.get("sort_by") or "urgency").strip().lower()
        if sort_by == "due_date":
            qs = qs.order_by("due_date", "-updated_at")
        elif sort_by == "priority":
            priority_rank = Case(
                When(priority="HIGH", then=Value(0)),
                When(priority="MEDIUM", then=Value(1)),
                When(priority="LOW", then=Value(2)),
                default=Value(3),
                output_field=IntegerField(),
            )
            qs = qs.order_by(priority_rank, "due_date", "-updated_at")
        elif sort_by == "created_at":
            qs = qs.order_by("-created_at")
        elif sort_by == "updated_at":
            qs = qs.order_by("-updated_at")
        else:
            # urgency: в работе/к выполнению + ближайший срок + высокий приоритет
            status_rank = Case(
                When(status="IN_PROGRESS", then=Value(0)),
                When(status="TODO", then=Value(1)),
                When(status="BLOCKED", then=Value(2)),
                When(status="DONE", then=Value(4)),
                When(status="CANCELLED", then=Value(5)),
                default=Value(6),
                output_field=IntegerField(),
            )
            due_null_rank = Case(
                When(due_date__isnull=True, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
            priority_rank = Case(
                When(priority="HIGH", then=Value(0)),
                When(priority="MEDIUM", then=Value(1)),
                When(priority="LOW", then=Value(2)),
                default=Value(3),
                output_field=IntegerField(),
            )
            qs = qs.order_by(status_rank, due_null_rank, "due_date", priority_rank, "-updated_at")

        try:
            limit = int(kwargs.get("limit") or 20)
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(100, limit))

        try:
            offset = int(kwargs.get("offset") or 0)
        except (TypeError, ValueError):
            offset = 0
        offset = max(0, offset)

        total_count = qs.count()
        status_stats_qs = qs.values("status").annotate(count=Count("id"))
        status_stats = {row["status"]: row["count"] for row in status_stats_qs}

        tasks_page = list(qs[offset: offset + limit])
        items = [_task_json(t, user=user) for t in tasks_page]

        result = {
            "total_count": total_count,
            "returned_count": len(items),
            "offset": offset,
            "limit": limit,
            "has_more": (offset + len(items)) < total_count,
            "status_stats": status_stats,
            "tasks": items,
            "query": {
                "status": status or None,
                "search": search or None,
                "include_completed": include_completed,
                "overdue_only": overdue_only,
                "due_before": _dt(due_before),
                "sort_by": sort_by,
            },
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
            **_task_json(task, user=user),
            "description": task.description or "",
            "started_at": _dt(task.started_at),
            "subtasks": [
                {"id": s.id, "title": s.title, "is_completed": s.is_completed}
                for s in task.subtasks.all()
            ],
        }

        return json.dumps(data, ensure_ascii=False, indent=2)


class TaskCreateTool(BaseTool):
    """Создание новой задачи."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="task_create",
            description=(
                "Создаёт задачу в Tasks. "
                "Используй когда пользователь просит создать новую задачу или поставить задачу с дедлайном."
            ),
            category="tasks",
            parameters=[
                ToolParameter(name="title", type="string", description="Название задачи (обязательно)."),
                ToolParameter(name="description", type="string", description="Описание.", required=False),
                ToolParameter(name="priority", type="string", description="HIGH|MEDIUM|LOW", required=False),
                ToolParameter(name="status", type="string", description="TODO|IN_PROGRESS|BLOCKED|DONE|CANCELLED", required=False),
                ToolParameter(name="due_date", type="string", description="ISO-8601 дата дедлайна.", required=False),
                ToolParameter(name="assignee_username", type="string", description="Username исполнителя.", required=False),
            ],
        )

    async def execute(self, **kwargs) -> Any:
        return await sync_to_async(self._execute_sync, thread_sensitive=True)(**kwargs)

    def _execute_sync(self, **kwargs) -> Any:
        user_id = _get_user_id(kwargs)
        if not user_id:
            return "Требуется контекст пользователя (user_id)."

        from django.contrib.auth.models import User
        from tasks.models import Task

        user = User.objects.filter(id=user_id).first()
        if not user:
            return "Пользователь не найден."

        title = (kwargs.get("title") or "").strip()
        if not title:
            return "Нужно поле title."

        description = (kwargs.get("description") or "").strip()
        priority = str(kwargs.get("priority") or "MEDIUM").upper()
        if priority not in ALL_PRIORITIES:
            priority = "MEDIUM"

        status = str(kwargs.get("status") or "TODO").upper()
        if status not in ALL_STATUSES:
            status = "TODO"

        due_date = _parse_due_date(kwargs.get("due_date"))
        assignee = None
        assignee_username = (kwargs.get("assignee_username") or "").strip()
        if assignee_username:
            assignee = User.objects.filter(username=assignee_username).first()

        task = Task.objects.create(
            title=title,
            description=description,
            priority=priority,
            status=status,
            due_date=due_date,
            assignee=assignee,
            created_by=user,
        )

        return json.dumps(
            {
                "success": True,
                "message": "Задача создана.",
                "task": _task_json(task, user=user),
            },
            ensure_ascii=False,
            indent=2,
        )


class TaskUpdateTool(BaseTool):
    """Обновление существующей задачи."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="task_update",
            description=(
                "Обновляет задачу (статус, приоритет, срок, название, описание, исполнитель). "
                "Используй для 'взять в работу', 'закрыть задачу', 'перенести срок'."
            ),
            category="tasks",
            parameters=[
                ToolParameter(name="task_id", type="integer", description="ID задачи."),
                ToolParameter(name="title", type="string", description="Новое название.", required=False),
                ToolParameter(name="description", type="string", description="Новое описание.", required=False),
                ToolParameter(name="status", type="string", description="TODO|IN_PROGRESS|BLOCKED|DONE|CANCELLED", required=False),
                ToolParameter(name="priority", type="string", description="HIGH|MEDIUM|LOW", required=False),
                ToolParameter(name="due_date", type="string", description="ISO-8601 срок. Пустая строка очистит срок.", required=False),
                ToolParameter(name="assignee_username", type="string", description="Username исполнителя.", required=False),
            ],
        )

    async def execute(self, **kwargs) -> Any:
        return await sync_to_async(self._execute_sync, thread_sensitive=True)(**kwargs)

    def _execute_sync(self, **kwargs) -> Any:
        user_id = _get_user_id(kwargs)
        if not user_id:
            return "Требуется контекст пользователя (user_id)."

        from django.contrib.auth.models import User
        from tasks.models import Task

        user = User.objects.filter(id=user_id).first()
        if not user:
            return "Пользователь не найден."

        try:
            task_id = int(kwargs.get("task_id"))
        except (TypeError, ValueError):
            return "Нужен валидный task_id."

        task = Task.objects.filter(id=task_id).select_related("assignee", "created_by", "target_server").first()
        if not task or not PermissionService.can_view_task(user, task):
            return "Задача не найдена или нет доступа."
        if not PermissionService.can_edit_task(user, task):
            return "Нет прав на редактирование задачи."

        changed_fields = []

        if "title" in kwargs:
            title = (kwargs.get("title") or "").strip()
            if title and title != task.title:
                task.title = title
                changed_fields.append("title")

        if "description" in kwargs:
            description = (kwargs.get("description") or "").strip()
            if description != (task.description or ""):
                task.description = description
                changed_fields.append("description")

        if "status" in kwargs:
            status = str(kwargs.get("status") or "").upper().strip()
            if status in ALL_STATUSES and status != task.status:
                task.status = status
                changed_fields.append("status")
                if status == "DONE" and not task.completed_at:
                    task.completed_at = timezone.now()
                    changed_fields.append("completed_at")

        if "priority" in kwargs:
            priority = str(kwargs.get("priority") or "").upper().strip()
            if priority in ALL_PRIORITIES and priority != task.priority:
                task.priority = priority
                changed_fields.append("priority")

        if "due_date" in kwargs:
            raw_due_date = kwargs.get("due_date")
            if raw_due_date in (None, ""):
                if task.due_date is not None:
                    task.due_date = None
                    changed_fields.append("due_date")
            else:
                due_date = _parse_due_date(raw_due_date)
                if due_date and task.due_date != due_date:
                    task.due_date = due_date
                    changed_fields.append("due_date")

        if "assignee_username" in kwargs:
            assignee_username = (kwargs.get("assignee_username") or "").strip()
            assignee = User.objects.filter(username=assignee_username).first() if assignee_username else None
            assignee_id = assignee.id if assignee else None
            if task.assignee_id != assignee_id:
                task.assignee = assignee
                changed_fields.append("assignee")

        if changed_fields:
            task.save()

        return json.dumps(
            {
                "success": True,
                "message": "Задача обновлена." if changed_fields else "Изменений не было.",
                "changed_fields": changed_fields,
                "task": _task_json(task, user=user),
            },
            ensure_ascii=False,
            indent=2,
        )


class TaskDeleteTool(BaseTool):
    """Удаление задачи."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="task_delete",
            description=(
                "Удаляет задачу по task_id. "
                "Требует confirm=true. "
                "Используй только когда пользователь явно просит удалить задачу."
            ),
            category="tasks",
            parameters=[
                ToolParameter(name="task_id", type="integer", description="ID задачи."),
                ToolParameter(
                    name="confirm",
                    type="boolean",
                    description="Подтверждение удаления. Должно быть true.",
                    required=True,
                ),
            ],
        )

    async def execute(self, **kwargs) -> Any:
        return await sync_to_async(self._execute_sync, thread_sensitive=True)(**kwargs)

    def _execute_sync(self, **kwargs) -> Any:
        user_id = _get_user_id(kwargs)
        if not user_id:
            return "Требуется контекст пользователя (user_id)."

        from django.contrib.auth.models import User
        from tasks.models import Task

        user = User.objects.filter(id=user_id).first()
        if not user:
            return "Пользователь не найден."

        try:
            task_id = int(kwargs.get("task_id"))
        except (TypeError, ValueError):
            return "Нужен валидный task_id."

        if not _to_bool(kwargs.get("confirm"), default=False):
            return "Удаление не выполнено: передай confirm=true."

        task = Task.objects.filter(id=task_id).select_related("created_by", "assignee").first()
        if not task or not PermissionService.can_view_task(user, task):
            return "Задача не найдена или нет доступа."
        if not PermissionService.can_delete_task(user, task):
            return "Нет прав на удаление задачи."

        deleted_task = {
            "id": task.id,
            "title": task.title,
            "status": task.status,
            "priority": getattr(task, "priority", None),
        }
        task.delete()

        return json.dumps(
            {
                "success": True,
                "message": "Задача удалена.",
                "deleted_task": deleted_task,
            },
            ensure_ascii=False,
            indent=2,
        )
