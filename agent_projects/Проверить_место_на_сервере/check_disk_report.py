#!/usr/bin/env python3
"""Скрипт проверки места на диске: корень ФС и каталоги приложения."""
import os
import sys
import django

# Добавляем корень проекта в path (скрипт может запускаться из любой директории)
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(script_dir))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
os.chdir(project_root)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')
django.setup()

from app.utils.disk_usage import get_disk_usage_report
from django.conf import settings


def _format_bytes(n: int) -> str:
    """Форматирует байты в человекочитаемый вид (KB, MB, GB, TB)."""
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if abs(n) < 1024:
            return f'{n:.1f} {unit}'
        n /= 1024
    return f'{n:.1f} PB'


report = get_disk_usage_report(
    include_root=True,
    base_dir=settings.BASE_DIR,
    media_root=settings.MEDIA_ROOT,
    uploaded_files_dir=getattr(settings, 'UPLOADED_FILES_DIR', None),
    agent_projects_dir=getattr(settings, 'AGENT_PROJECTS_DIR', None),
)
for entry in report:
    if 'error' not in entry:
        total = entry.get('total')
        used = entry.get('used')
        free = entry.get('free')
        if total is not None:
            entry['total_human'] = _format_bytes(total)
        if used is not None:
            entry['used_human'] = _format_bytes(used)
        if free is not None:
            entry['free_human'] = _format_bytes(free)
for item in report:
    path = item.get('path', '')
    total = item.get('total', 0)
    used = item.get('used', 0)
    free = item.get('free', 0)
    percent_used = item.get('percent_used', 0)
    total_hr = item.get('total_human', '')
    used_hr = item.get('used_human', '')
    free_hr = item.get('free_human', '')
    print(f"path={path} total={total} used={used} free={free} percent_used={percent_used} total_human={total_hr} used_human={used_hr} free_human={free_hr}")
print("---")
print("STEP_DONE")
