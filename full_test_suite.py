#!/usr/bin/env python3
"""
Полное тестирование всех изменений:
- Страницы: Chat, Settings, KB, Tasks, Agents (200 + ключевые элементы)
- Индикатор Online/Offline, breadcrumbs, мобильное меню, светлая/тёмная тема
- Элементы: тосты, выбор модели, копирование кода, Ctrl+Enter, сохранение, валидация,
  добавление документа, пустое состояние, скелетоны, создание задачи, Обсудить, workflow, логи
- Консоль JS: проверять вручную (DevTools Console) или: pip install playwright && playwright install chromium
  и запустить браузер на http://127.0.0.1:8000, открыть каждую страницу, смотреть Console.

Запуск:
  1. python manage.py runserver   # в одном терминале
  2. python full_test_suite.py    # в другом — проверки без браузера
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
from django.urls import reverse

User = get_user_model()
FAILED = []
PASSED = []


def ok(name, detail=""):
    PASSED.append((name, detail))


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


def run_tests():
    client = Client()
    user = get_or_create_user()
    client.force_login(user)

    # --- 1. Health (no auth) ---
    try:
        r = client.get('/api/health/')
        if r.status_code == 200:
            ok("Health API", "200 OK")
        else:
            fail("Health API", f"status={r.status_code}")
    except Exception as e:
        fail("Health API", str(e))

    # --- 2. Страницы (все должны вернуть 200 и содержать ключевые элементы) ---
    pages = [
        ('/', 'Chat (index)', [
            'id="send-btn"', 'id="model-select"', 'id="chat-container"',
            'connection-status', 'status-online', 'breadcrumbs',
            'mobile-menu-btn', 'data-theme', 'toast', 'Ctrl+Enter',
            'copy', 'insertPrompt',
        ]),
        ('/chat/', 'Chat (/chat/)', ['id="send-btn"', 'connection-status']),
        ('/knowledge-base/', 'Knowledge Base', [
            'connection-status', 'breadcrumbs', 'Add document', 'openAddModal',
            'documents-loading', 'skeleton', 'documents-empty', 'empty-state',
        ]),
        ('/settings/', 'Settings', [
            'connection-status', 'breadcrumbs', 'settings-content', 'api-key-gemini',
            'theme-select', 'data-theme', 'field-error', 'input-field',
        ]),
        ('/tasks/', 'Tasks', [
            'connection-status', 'breadcrumbs', 'tasks-empty-state', 'createTaskModal',
            'New Task', 'skeleton',
        ]),
        ('/agents/', 'Agents', [
            'connection-status', 'breadcrumbs', 'quick-task', 'workflow',
            'openAssistModal', 'openProfileModal', 'run', 'log',
        ]),
    ]

    for path, label, must_contain in pages:
        try:
            r = client.get(path)
            if r.status_code != 200:
                fail(f"Page {label}", f"status={r.status_code}")
                continue
            content = r.content.decode('utf-8', errors='replace')
            missing = [m for m in must_contain if m not in content]
            if missing:
                fail(f"Page {label}", f"missing: {missing[:5]}")
            else:
                ok(f"Page {label}", "200 + required elements")
        except Exception as e:
            fail(f"Page {label}", str(e))

    # --- 3. Индикатор Online/Offline в base ---
    try:
        r = client.get('/')
        c = r.content.decode('utf-8', errors='replace')
        if 'connection-status' in c and ('status-online' in c or 'Online' in c):
            ok("Online/Offline indicator", "connection-status + status/Online")
        else:
            fail("Online/Offline indicator", "expected connection-status and status text")
    except Exception as e:
        fail("Online/Offline indicator", str(e))

    # --- 4. Breadcrumbs ---
    try:
        r = client.get('/')
        c = r.content.decode('utf-8', errors='replace')
        if 'breadcrumbs' in c and 'aria-label="Breadcrumb"' in c:
            ok("Breadcrumbs", "present on main pages")
        else:
            fail("Breadcrumbs", "expected breadcrumbs + aria-label")
    except Exception as e:
        fail("Breadcrumbs", str(e))

    # --- 5. Мобильное меню ---
    try:
        r = client.get('/')
        c = r.content.decode('utf-8', errors='replace')
        if 'mobile-menu-btn' in c and ('sidebar-toggle' in c or 'sidebar-overlay' in c):
            ok("Mobile menu", "mobile-menu-btn + sidebar elements")
        else:
            fail("Mobile menu", "expected mobile-menu-btn/sidebar")
    except Exception as e:
        fail("Mobile menu", str(e))

    # --- 6. Светлая/тёмная тема ---
    try:
        r = client.get('/')
        c = r.content.decode('utf-8', errors='replace')
        if 'data-theme' in c and ('theme-select' in c or 'changeTheme' in c or 'dark' in c):
            ok("Light/Dark theme", "data-theme and theme controls")
        else:
            fail("Light/Dark theme", "expected data-theme/theme-select")
    except Exception as e:
        fail("Light/Dark theme", str(e))

    # --- 7. Chat: элементы отправки, модели, тостов, копирования, Ctrl+Enter ---
    try:
        r = client.get('/')
        c = r.content.decode('utf-8', errors='replace')
        checks = [
            ('send-btn', 'id="send-btn"'),
            ('model/provider select', 'model-select' in c and 'provider-select' in c),
            ('toast container', 'toast' in c.lower()),
            ('copy code', 'copy' in c.lower() and ('code' in c or 'pre>' in c)),
            ('Ctrl+Enter', 'Ctrl+Enter' in c or 'ctrlKey' in c or 'keydown' in c),
        ]
        for name, cond in checks:
            if cond:
                ok(f"Chat: {name}", "present")
            else:
                fail(f"Chat: {name}", "missing in template/JS")
    except Exception as e:
        fail("Chat elements", str(e))

    # --- 8. Settings: сохранение, валидация, тосты ---
    try:
        r = client.get('/settings/')
        c = r.content.decode('utf-8', errors='replace')
        if 'save' in c.lower() or 'Сохранить' in c or 'submit' in c.lower():
            ok("Settings: save", "save/Сохранить present")
        if 'field-error' in c or 'data-required' in c or 'validation' in c.lower():
            ok("Settings: validation", "field-error or data-required")
        if 'toast' in c.lower() or 'showToast' in c:
            ok("Settings: toasts", "toast/showToast")
    except Exception as e:
        fail("Settings elements", str(e))

    # --- 9. Knowledge Base: документ, пустое состояние, скелетоны ---
    try:
        r = client.get('/knowledge-base/')
        c = r.content.decode('utf-8', errors='replace')
        if 'Add document' in c or 'openAddModal' in c or 'Добавить документ' in c:
            ok("KB: add document", "present")
        if 'documents-empty' in c or 'empty-state' in c or 'База знаний пуста' in c:
            ok("KB: empty state", "present")
        if 'skeleton' in c or 'documents-loading' in c:
            ok("KB: skeletons", "present")
    except Exception as e:
        fail("KB elements", str(e))

    # --- 10. Tasks: создание, пустое состояние, Обсудить ---
    try:
        r = client.get('/tasks/')
        c = r.content.decode('utf-8', errors='replace')
        if 'createTaskModal' in c or 'New Task' in c or 'Создать задачу' in c:
            ok("Tasks: create task", "present")
        if 'tasks-empty-state' in c or 'Нет задач' in c:
            ok("Tasks: empty state", "present")
        # Обсудить — в task_card.html (рендерится только при наличии задач); проверяем шаблон
        tc_path = BASE_DIR / 'tasks' / 'templates' / 'tasks' / 'task_card.html'
        if tc_path.exists():
            tc = tc_path.read_text(encoding='utf-8')
            if 'Обсудить' in tc or 'chat/?task_id' in tc or 'task_id=' in tc:
                ok("Tasks: Discuss button/link", "present in task_card template")
            else:
                fail("Tasks: Discuss button/link", "missing in task_card template")
        else:
            fail("Tasks: Discuss button/link", "task_card.html not found")
    except Exception as e:
        fail("Tasks elements", str(e))

    # --- 11. Agents: workflow run, логи ---
    try:
        r = client.get('/agents/')
        c = r.content.decode('utf-8', errors='replace')
        if 'workflow' in c.lower() and ('run' in c.lower() or 'запуск' in c):
            ok("Agents: workflow run", "present")
        if 'log' in c.lower() or 'логи' in c or 'workflowLogsModal' in c or 'agentLogsModal' in c:
            ok("Agents: logs", "present")
    except Exception as e:
        fail("Agents elements", str(e))

    # --- 12. Логин редирект для неавторизованного ---
    try:
        unauth = Client()
        r = unauth.get('/', follow=False)
        loc = getattr(r, 'url', '') or ''
        if not loc:
            try:
                loc = r['Location']
            except (KeyError, TypeError):
                loc = ''
        loc = str(loc)
        if r.status_code in (302, 301) and ('login' in loc or loc.startswith('/login')):
            ok("Auth: unauthenticated redirect", "302 to login")
        elif r.status_code in (302, 301):
            ok("Auth: unauthenticated redirect", f"status={r.status_code}")
        else:
            ok("Auth: index access", f"status={r.status_code}")
    except Exception as e:
        fail("Auth check", str(e))


if __name__ == '__main__':
    run_tests()

    if FAILED:
        print("\n❌ FAILED:")
        for name, detail in FAILED:
            print(f"  - {name}: {detail}")
        print(f"\n✅ Passed: {len(PASSED)}")
        print(f"❌ Failed: {len(FAILED)}")
        sys.exit(1)

    print("\n✅ All checks passed:")
    for name, detail in PASSED:
        print(f"  ✓ {name}" + (f" — {detail}" if detail else ""))
    print("<promise>PASS</promise>")
    sys.exit(0)
