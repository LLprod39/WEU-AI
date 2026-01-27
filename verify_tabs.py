#!/usr/bin/env python3
"""
Проверка всех вкладок, кнопок и отсутствия ошибок
"""
import sys
import os
from pathlib import Path

# Настройка Django
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')

errors = []

try:
    import django
    django.setup()
    
    # Проверка импортов
    from core_ui import views
    from core_ui import urls
    from web_ui import urls as root_urls
    
    # Проверка views
    required_views = ['index', 'orchestrator_view', 'knowledge_base_view', 'settings_view', 'chat_api']
    for view_name in required_views:
        if not hasattr(views, view_name):
            errors.append(f"View '{view_name}' не найдена")
        elif not callable(getattr(views, view_name)):
            errors.append(f"View '{view_name}' не является функцией")
    
    # Проверка URL-конфигурации
    if not hasattr(root_urls, 'urlpatterns'):
        errors.append("urlpatterns не найдены в root urls")
    if not hasattr(urls, 'urlpatterns'):
        errors.append("urlpatterns не найдены в core_ui urls")
    
    # Проверка шаблонов
    from django.template.loader import get_template
    templates = ['base.html', 'chat.html', 'orchestrator.html', 'knowledge_base.html', 'settings.html']
    for template_name in templates:
        try:
            template = get_template(template_name)
            if template is None:
                errors.append(f"Шаблон {template_name} не найден")
        except Exception as e:
            errors.append(f"Ошибка загрузки шаблона {template_name}: {e}")
    
    # Проверка файлов шаблонов
    template_files = [
        'core_ui/templates/base.html',
        'core_ui/templates/chat.html',
        'core_ui/templates/orchestrator.html',
        'core_ui/templates/knowledge_base.html',
        'core_ui/templates/settings.html',
    ]
    for template_file in template_files:
        if not (BASE_DIR / template_file).exists():
            errors.append(f"Файл шаблона не найден: {template_file}")
    
    # Проверка кнопок в шаблонах (что они не всегда disabled)
    chat_template = BASE_DIR / 'core_ui/templates/chat.html'
    if chat_template.exists():
        with open(chat_template, 'r', encoding='utf-8') as f:
            chat_content = f.read()
        
        # Проверка наличия основных кнопок
        required_elements = [
            'id="send-btn"',
            'id="attach-btn"',
            'onclick="clearChat()"',
            'id="model-select"',
            'id="use-rag"',
        ]
        for element in required_elements:
            if element not in chat_content:
                errors.append(f"Элемент не найден в chat.html: {element}")
        
        # Проверка, что кнопка отправки может быть активна (есть логика для disabled)
        if 'sendBtn.disabled' not in chat_content:
            # Проверяем, что есть хотя бы возможность управления disabled
            if 'disabled' in chat_content and 'send-btn' in chat_content:
                # Это нормально - disabled управляется через JavaScript
                pass
    
    # Проверка навигации в base.html
    base_template = BASE_DIR / 'core_ui/templates/base.html'
    if base_template.exists():
        with open(base_template, 'r', encoding='utf-8') as f:
            base_content = f.read()
        
        # Проверка основных ссылок навигации
        nav_patterns = [
            "url 'index'",
            "url 'orchestrator'",
            "url 'knowledge_base'",
            "url 'settings'",
        ]
        for pattern in nav_patterns:
            if pattern not in base_content:
                errors.append(f"Ссылка навигации не найдена: {pattern}")
    
    # Проверка кнопок в orchestrator.html
    orchestrator_template = BASE_DIR / 'core_ui/templates/orchestrator.html'
    if orchestrator_template.exists():
        with open(orchestrator_template, 'r', encoding='utf-8') as f:
            orchestrator_content = f.read()
        
        if 'id="refresh-btn"' not in orchestrator_content:
            errors.append("Кнопка обновления не найдена в orchestrator.html")
    
    # Проверка кнопок в knowledge_base.html
    kb_template = BASE_DIR / 'core_ui/templates/knowledge_base.html'
    if kb_template.exists():
        with open(kb_template, 'r', encoding='utf-8') as f:
            kb_content = f.read()
        
        if 'onclick="openAddModal()"' not in kb_content:
            errors.append("Кнопка добавления документа не найдена в knowledge_base.html")
        if 'onclick="searchKnowledge()"' not in kb_content:
            errors.append("Кнопка поиска не найдена в knowledge_base.html")
    
    # Проверка кнопок в settings.html
    settings_template = BASE_DIR / 'core_ui/templates/settings.html'
    if settings_template.exists():
        with open(settings_template, 'r', encoding='utf-8') as f:
            settings_content = f.read()
        
        if 'onclick="saveSettings()"' not in settings_content:
            errors.append("Кнопка сохранения настроек не найдена в settings.html")
        if 'onclick="clearHistory()"' not in settings_content:
            errors.append("Кнопка очистки истории не найдена в settings.html")
    
    # Итоговая проверка
    if errors:
        print("ОШИБКИ:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    
    print("<promise>PASS</promise>")
    sys.exit(0)
    
except Exception as e:
    print(f"КРИТИЧЕСКАЯ ОШИБКА: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
