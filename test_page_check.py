#!/usr/bin/env python3
"""
Простая проверка страницы
"""
import sys
import os
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
    assert hasattr(views, 'index'), "View 'index' не найдена"
    assert callable(views.index), "View 'index' не является функцией"
    
    # Проверка URL-конфигурации
    assert hasattr(root_urls, 'urlpatterns'), "urlpatterns не найдены в root urls"
    assert hasattr(urls, 'urlpatterns'), "urlpatterns не найдены в core_ui urls"
    
    # Проверка шаблонов
    from django.template.loader import get_template
    try:
        template = get_template('chat.html')
        assert template is not None, "Шаблон chat.html не найден"
    except Exception as e:
        raise AssertionError(f"Ошибка загрузки шаблона chat.html: {e}")
    
    # Проверка базового шаблона
    try:
        base_template = get_template('base.html')
        assert base_template is not None, "Шаблон base.html не найден"
    except Exception as e:
        raise AssertionError(f"Ошибка загрузки шаблона base.html: {e}")
    
    print("<promise>PASS</promise>")
    sys.exit(0)
    
except Exception as e:
    print(f"ОШИБКА: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
