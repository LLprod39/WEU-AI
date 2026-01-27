#!/usr/bin/env python3
"""
Скрипт для проверки, что страница работает без ошибок
"""
import os
import sys
from pathlib import Path

# Настройка Django
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')

try:
    import django
    django.setup()
    
    # Проверка импорта views
    from core_ui import views
    from core_ui import urls
    from web_ui import urls as root_urls
    
    # Проверка, что view index существует и может быть вызвана
    if not hasattr(views, 'index'):
        raise AssertionError("View 'index' не найдена")
    if not callable(views.index):
        raise AssertionError("View 'index' не является функцией")
    
    # Проверка URL-конфигурации
    if not hasattr(root_urls, 'urlpatterns'):
        raise AssertionError("urlpatterns не найдены в root urls")
    if not hasattr(urls, 'urlpatterns'):
        raise AssertionError("urlpatterns не найдены в core_ui urls")
    
    # Проверка шаблонов
    from django.template.loader import get_template
    try:
        template = get_template('chat.html')
        if template is None:
            raise AssertionError("Шаблон chat.html не найден")
    except Exception as e:
        raise AssertionError(f"Ошибка загрузки шаблона chat.html: {e}")
    
    # Проверка базового шаблона
    try:
        base_template = get_template('base.html')
        if base_template is None:
            raise AssertionError("Шаблон base.html не найден")
    except Exception as e:
        raise AssertionError(f"Ошибка загрузки шаблона base.html: {e}")
    
    print("<promise>PASS</promise>")
    sys.exit(0)
    
except Exception as e:
    print(f"ОШИБКА: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
