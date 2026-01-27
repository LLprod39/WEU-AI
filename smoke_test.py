#!/usr/bin/env python3
"""
Smoke-тест основных страниц: проверка на 200 OK (или 302 для редиректа на логин).
Запуск: python smoke_test.py [BASE_URL]
BASE_URL по умолчанию не используется — тесты идут через Django test client.
Для проверки живого сервера: python smoke_test.py http://127.0.0.1:8000
"""
import os
import sys
from urllib.parse import urljoin

# Без аргумента — через Django Client (сервер не нужен)
USE_LIVE = len(sys.argv) > 1
BASE_URL = (sys.argv[1].rstrip('/') + '/') if USE_LIVE else None

def run_django_client():
    import django
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    django.setup()
    from django.test import Client
    client = Client()
    return client.get

def run_requests():
    try:
        import requests
    except ImportError:
        print('Для проверки по BASE_URL нужен requests: pip install requests', file=sys.stderr)
        sys.exit(2)
    def get(path):
        url = urljoin(BASE_URL, path)
        return requests.get(url, timeout=10, allow_redirects=False)
    return get

get = run_requests() if USE_LIVE else run_django_client()

# Маршруты, где ожидаем 200
MUST_200 = [
    '/api/health/',
    '/welcome/',
    '/login/',
]

# Маршруты, где допускаем 200 или 302 (редирект на логин)
OK_200_OR_302 = [
    '/',
    '/chat/',
    '/orchestrator/',
    '/knowledge-base/',
    '/settings/',
    '/tasks/',
    '/agents/',
]

def main():
    fails = []
    for path in MUST_200:
        try:
            r = get(path)
            code = r.status_code
            if code != 200:
                fails.append(f'{path} -> {code} (expected 200)')
        except Exception as e:
            fails.append(f'{path} -> {e!r}')

    for path in OK_200_OR_302:
        try:
            r = get(path)
            code = r.status_code
            if code not in (200, 302):
                fails.append(f'{path} -> {code} (expected 200 or 302)')
        except Exception as e:
            fails.append(f'{path} -> {e!r}')

    if fails:
        for line in fails:
            print(line, file=sys.stderr)
        sys.exit(1)
    print('OK')
    sys.exit(0)

if __name__ == '__main__':
    main()
