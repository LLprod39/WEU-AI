#!/usr/bin/env python3
"""
Простая проверка без Django setup
"""
import sys
from pathlib import Path

errors = []

# Проверка существования файлов
files_to_check = [
    'core_ui/views.py',
    'core_ui/urls.py',
    'web_ui/urls.py',
    'web_ui/settings.py',
    'core_ui/templates/chat.html',
    'core_ui/templates/base.html',
]

for file_path in files_to_check:
    full_path = Path(__file__).parent / file_path
    if not full_path.exists():
        errors.append(f"Файл не найден: {file_path}")

# Проверка синтаксиса
for file_path in ['core_ui/views.py', 'core_ui/urls.py', 'web_ui/urls.py', 'web_ui/settings.py']:
    full_path = Path(__file__).parent / file_path
    if full_path.exists():
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                code = f.read()
            compile(code, str(full_path), 'exec')
        except SyntaxError as e:
            errors.append(f"Синтаксическая ошибка в {file_path}: {e}")

# Проверка структуры views
views_path = Path(__file__).parent / 'core_ui/views.py'
if views_path.exists():
    with open(views_path, 'r', encoding='utf-8') as f:
        views_content = f.read()
    
    if 'def index(request):' not in views_content:
        errors.append("Функция index не найдена в core_ui/views.py")
    
    if "return render(request, 'chat.html', context)" not in views_content:
        errors.append("View index не рендерит шаблон chat.html")

# Проверка URL-конфигурации
urls_path = Path(__file__).parent / 'core_ui/urls.py'
if urls_path.exists():
    with open(urls_path, 'r', encoding='utf-8') as f:
        urls_content = f.read()
    
    if "path('', views.index" not in urls_content:
        errors.append("URL для index не найден в core_ui/urls.py")

if errors:
    print("ОШИБКИ НАЙДЕНЫ:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    sys.exit(1)
else:
    print("<promise>PASS</promise>")
    sys.exit(0)
