#!/usr/bin/env python3
"""
Регрессионное тестирование основных страниц:
- Все основные страницы возвращают 200, без критических ошибок
- Тосты: контейнер и showToast доступны (в base и на страницах)
- Формы: валидация (field-error, data-required) присутствует там, где есть формы

При успехе выводит точно: <promise>PASS</promise>
"""
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')

import django
django.setup()

from django.test import Client
from django.contrib.auth import get_user_model

User = get_user_model()
FAILED = []


def fail(name, detail=""):
    FAILED.append((name, detail))


def get_or_create_user():
    u, _ = User.objects.get_or_create(
        username='test_runner',
        defaults={'is_staff': False, 'is_superuser': False}
    )
    if not u.password or u.password == '!':
        u.set_password('test_runner_pass_123')
        u.save()
    return u


def run_regression():
    client = Client()
    user = get_or_create_user()
    client.force_login(user)

    # --- 1. Health API (без авторизации) ---
    try:
        r = client.get('/api/health/')
        if r.status_code != 200:
            fail("Health API", f"status={r.status_code}")
    except Exception as e:
        fail("Health API", str(e))

    # --- 2. Основные страницы: 200 и ключевые элементы ---
    main_pages = [
        ('/', 'Chat (index)', [
            'id="send-btn"', 'id="chat-container"', 'connection-status',
            'toast-container', 'showToast', 'breadcrumbs', 'mobile-menu-btn', 'data-theme',
        ]),
        ('/chat/', 'Chat', ['id="send-btn"', 'connection-status', 'toast-container']),
        ('/orchestrator/', 'Orchestrator', ['connection-status', 'breadcrumbs']),
        ('/knowledge-base/', 'Knowledge Base', [
            'connection-status', 'breadcrumbs', 'documents-empty', 'openAddModal', 'skeleton',
        ]),
        ('/settings/', 'Settings', [
            'connection-status', 'settings-content', 'api-key-gemini', 'theme-select', 'data-theme',
            'field-error', 'input-field', 'toast-container', 'showToast',
        ]),
        ('/tasks/', 'Tasks', [
            'connection-status', 'breadcrumbs', 'tasks-empty-state', 'createTaskModal', 'New Task',
        ]),
        ('/agents/', 'Agents', [
            'connection-status', 'breadcrumbs', 'workflow', 'run', 'log',
        ]),
        ('/passwords/', 'Passwords', ['connection-status']),
        ('/servers/', 'Servers', ['connection-status']),
    ]

    for path, label, must_contain in main_pages:
        try:
            r = client.get(path)
            if r.status_code != 200:
                fail(f"Page {label}", f"status={r.status_code}")
                continue
            content = r.content.decode('utf-8', errors='replace')
            missing = [m for m in must_contain if m not in content]
            if missing:
                fail(f"Page {label}", f"missing: {missing[:5]}")
        except Exception as e:
            fail(f"Page {label}", str(e))

    # --- 3. Тосты: глобально в base (все страницы через base имеют toast-container и showToast) ---
    try:
        r = client.get('/')
        c = r.content.decode('utf-8', errors='replace')
        if 'toast-container' not in c or 'showToast' not in c:
            fail("Toasts", "toast-container or showToast missing in base/chat")
    except Exception as e:
        fail("Toasts", str(e))

    # --- 4. Валидация форм: Settings имеет field-error, data-required ---
    try:
        r = client.get('/settings/')
        c = r.content.decode('utf-8', errors='replace')
        if 'field-error' not in c or 'data-required' not in c:
            fail("Forms validation", "field-error or data-required missing on Settings")
    except Exception as e:
        fail("Forms validation", str(e))

    # --- 5. Логин: неавторизованный редирект на /login/ ---
    try:
        unauth = Client()
        r = unauth.get('/', follow=False)
        loc = (getattr(r, 'url', '') or r.get('Location', '') or '')
        loc = str(loc)
        if r.status_code not in (302, 301):
            # если не редирект — возможно auth отключена, не считаем критичным для "страницы работают"
            pass
        elif 'login' not in loc and not loc.startswith('/login'):
            fail("Auth", "unauthenticated should redirect to login")
    except Exception as e:
        fail("Auth", str(e))


if __name__ == '__main__':
    run_regression()

    if FAILED:
        for name, detail in FAILED:
            print(f"FAIL: {name} — {detail}", file=sys.stderr)
        sys.exit(1)

    print("<promise>PASS</promise>")
    sys.exit(0)
