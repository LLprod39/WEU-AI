#!/usr/bin/env python3
"""
Проверка, что страница работает без ошибок
"""
import sys
import os
from pathlib import Path

# Проверка синтаксиса Python файлов
files_to_check = [
    'core_ui/views.py',
    'core_ui/urls.py',
    'web_ui/urls.py',
    'web_ui/settings.py',
]

errors = []

for file_path in files_to_check:
    full_path = Path(__file__).parent / file_path
    if not full_path.exists():
        errors.append(f"Файл не найден: {file_path}")
        continue
    
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            code = f.read()
        compile(code, str(full_path), 'exec')
    except SyntaxError as e:
        errors.append(f"Синтаксическая ошибка в {file_path}: {e}")
    except Exception as e:
        errors.append(f"Ошибка при проверке {file_path}: {e}")

# Проверка существования шаблонов
templates_to_check = [
    'core_ui/templates/base.html',
    'core_ui/templates/chat.html',
]

for template_path in templates_to_check:
    full_path = Path(__file__).parent / template_path
    if not full_path.exists():
        errors.append(f"Шаблон не найден: {template_path}")

# Проверка структуры views
try:
    # Читаем views.py и проверяем наличие функции index
    views_path = Path(__file__).parent / 'core_ui/views.py'
    with open(views_path, 'r', encoding='utf-8') as f:
        views_content = f.read()
    
    if 'def index(request):' not in views_content:
        errors.append("Функция index не найдена в core_ui/views.py")
    
    if "return render(request, 'chat.html', context)" not in views_content:
        errors.append("View index не рендерит шаблон chat.html")
        
except Exception as e:
    errors.append(f"Ошибка при проверке views.py: {e}")

# Проверка URL-конфигурации
try:
    urls_path = Path(__file__).parent / 'core_ui/urls.py'
    with open(urls_path, 'r', encoding='utf-8') as f:
        urls_content = f.read()
    
    if "path('', views.index" not in urls_content:
        errors.append("URL для index не найден в core_ui/urls.py")
        
except Exception as e:
    errors.append(f"Ошибка при проверке urls.py: {e}")

if errors:
    print("ОШИБКИ НАЙДЕНЫ:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    sys.exit(1)
else:
    print("<promise>PASS</promise>")
    sys.exit(0)
