#!/usr/bin/env python
"""Краткая сводка по активным задачам (скрипт для manage.py shell)."""
import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "web_ui.settings")
django.setup()

from tasks.models import Task
from django.db.models import Count

active = Task.objects.exclude(status__in=["DONE", "CANCELLED"])
by_status = active.values("status").annotate(c=Count("id")).order_by("status")
total = active.count()

print("=== АКТИВНЫЕ ЗАДАЧИ ===")
print(f"Всего активных: {total}")
for row in by_status:
    print(f"  {row['status']}: {row['c']}")
if total:
    print()
    for t in active.order_by("-updated_at")[:15]:
        ai = t.ai_execution_status or "-"
        srv = t.target_server.name if t.target_server else "-"
        title_short = (t.title[:50] + "...") if len(t.title) > 50 else t.title
        print(f"  [{t.status}] {title_short} | AI: {ai} | сервер: {srv}")
else:
    print("Нет активных задач.")
