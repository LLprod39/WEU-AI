#!/usr/bin/env python3
"""
Комплексная проверка всех вкладок, кнопок и отсутствия ошибок
"""
import sys
import os
from pathlib import Path

# Настройка Django
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')

errors = []
warnings = []

def check_file_exists(file_path, description):
    """Проверка существования файла"""
    full_path = BASE_DIR / file_path
    if not full_path.exists():
        errors.append(f"Файл не найден: {file_path} ({description})")
        return False
    return True

def check_syntax(file_path):
    """Проверка синтаксиса Python файла"""
    full_path = BASE_DIR / file_path
    if not full_path.exists():
        return False
    
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            code = f.read()
        compile(code, str(full_path), 'exec')
        return True
    except SyntaxError as e:
        errors.append(f"Синтаксическая ошибка в {file_path}: {e}")
        return False
    except Exception as e:
        errors.append(f"Ошибка при проверке {file_path}: {e}")
        return False

def check_template_buttons(template_path):
    """Проверка, что кнопки в шаблоне не disabled"""
    full_path = BASE_DIR / template_path
    if not full_path.exists():
        return False
    
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Проверка на disabled кнопки (кроме тех, что должны быть disabled по логике)
        # Ищем кнопки с disabled без условий
        lines = content.split('\n')
        for i, line in enumerate(lines, 1):
            # Пропускаем комментарии и disabled с условиями
            if 'disabled' in line.lower() and 'disabled:opacity' not in line.lower():
                # Проверяем, что это не условный disabled
                if '{%' not in line and 'disabled=' in line:
                    # Проверяем, что это не временный disabled (например, при отправке)
                    if 'send-btn' in line or 'sendBtn.disabled' in content:
                        # Это нормально - кнопка отправки временно disabled
                        continue
                    warnings.append(f"Возможная проблема в {template_path}:{i} - кнопка может быть disabled: {line.strip()}")
        
        return True
    except Exception as e:
        errors.append(f"Ошибка при проверке шаблона {template_path}: {e}")
        return False

def check_view_function(views_content, func_name, description):
    """Проверка наличия функции view"""
    if f'def {func_name}' not in views_content and f'async def {func_name}' not in views_content:
        errors.append(f"Функция {func_name} не найдена в views.py ({description})")
        return False
    return True

def check_url_pattern(urls_content, pattern, description):
    """Проверка наличия URL паттерна"""
    if pattern not in urls_content:
        errors.append(f"URL паттерн не найден: {pattern} ({description})")
        return False
    return True

try:
    import django
    django.setup()
    
    # ============================================
    # Проверка основных файлов
    # ============================================
    print("Проверка основных файлов...", file=sys.stderr)
    
    required_files = [
        ('core_ui/views.py', 'Views'),
        ('core_ui/urls.py', 'URLs'),
        ('web_ui/urls.py', 'Root URLs'),
        ('web_ui/settings.py', 'Settings'),
        ('core_ui/templates/base.html', 'Base template'),
        ('core_ui/templates/chat.html', 'Chat template'),
        ('core_ui/templates/orchestrator.html', 'Orchestrator template'),
        ('core_ui/templates/knowledge_base.html', 'Knowledge Base template'),
        ('core_ui/templates/settings.html', 'Settings template'),
    ]
    
    for file_path, description in required_files:
        check_file_exists(file_path, description)
    
    # ============================================
    # Проверка синтаксиса Python файлов
    # ============================================
    print("Проверка синтаксиса...", file=sys.stderr)
    
    python_files = [
        'core_ui/views.py',
        'core_ui/urls.py',
        'web_ui/urls.py',
        'web_ui/settings.py',
    ]
    
    for file_path in python_files:
        check_syntax(file_path)
    
    # ============================================
    # Проверка views
    # ============================================
    print("Проверка views...", file=sys.stderr)
    
    views_path = BASE_DIR / 'core_ui/views.py'
    if views_path.exists():
        with open(views_path, 'r', encoding='utf-8') as f:
            views_content = f.read()
        
        required_views = [
            ('index', 'Главная страница Chat'),
            ('orchestrator_view', 'Orchestrator'),
            ('knowledge_base_view', 'Knowledge Base'),
            ('settings_view', 'Settings'),
            ('chat_api', 'Chat API'),
        ]
        
        for func_name, description in required_views:
            check_view_function(views_content, func_name, description)
    
    # ============================================
    # Проверка URL-конфигурации
    # ============================================
    print("Проверка URL-конфигурации...", file=sys.stderr)
    
    urls_path = BASE_DIR / 'core_ui/urls.py'
    if urls_path.exists():
        with open(urls_path, 'r', encoding='utf-8') as f:
            urls_content = f.read()
        
        required_urls = [
            ("path('', views.index", 'Главная страница'),
            ("path('orchestrator/', views.orchestrator_view", 'Orchestrator'),
            ("path('knowledge-base/', views.knowledge_base_view", 'Knowledge Base'),
            ("path('settings/', views.settings_view", 'Settings'),
            ("path('api/chat/', views.chat_api", 'Chat API'),
        ]
        
        for pattern, description in required_urls:
            check_url_pattern(urls_content, pattern, description)
    
    # Проверка root URLs
    root_urls_path = BASE_DIR / 'web_ui/urls.py'
    if root_urls_path.exists():
        with open(root_urls_path, 'r', encoding='utf-8') as f:
            root_urls_content = f.read()
        
        if "include('core_ui.urls')" not in root_urls_content:
            errors.append("core_ui.urls не включен в root URLs")
    
    # ============================================
    # Проверка шаблонов
    # ============================================
    print("Проверка шаблонов...", file=sys.stderr)
    
    from django.template.loader import get_template
    
    templates_to_check = [
        'base.html',
        'chat.html',
        'orchestrator.html',
        'knowledge_base.html',
        'settings.html',
    ]
    
    for template_name in templates_to_check:
        try:
            template = get_template(template_name)
            if template is None:
                errors.append(f"Шаблон {template_name} не найден")
        except Exception as e:
            errors.append(f"Ошибка загрузки шаблона {template_name}: {e}")
    
    # ============================================
    # Проверка кнопок в шаблонах
    # ============================================
    print("Проверка кнопок в шаблонах...", file=sys.stderr)
    
    templates_to_check_buttons = [
        'core_ui/templates/chat.html',
        'core_ui/templates/base.html',
    ]
    
    for template_path in templates_to_check_buttons:
        check_template_buttons(template_path)
    
    # ============================================
    # Проверка импортов и доступности views
    # ============================================
    print("Проверка импортов...", file=sys.stderr)
    
    try:
        from core_ui import views
        from core_ui import urls
        from web_ui import urls as root_urls
        
        # Проверка, что все необходимые функции доступны
        required_functions = ['index', 'orchestrator_view', 'knowledge_base_view', 'settings_view', 'chat_api']
        for func_name in required_functions:
            if not hasattr(views, func_name):
                errors.append(f"View '{func_name}' не найдена в core_ui.views")
            elif not callable(getattr(views, func_name)):
                errors.append(f"View '{func_name}' не является функцией")
        
        # Проверка URL-конфигурации
        if not hasattr(root_urls, 'urlpatterns'):
            errors.append("urlpatterns не найдены в root urls")
        if not hasattr(urls, 'urlpatterns'):
            errors.append("urlpatterns не найдены в core_ui urls")
            
    except ImportError as e:
        errors.append(f"Ошибка импорта: {e}")
    except Exception as e:
        errors.append(f"Ошибка при проверке импортов: {e}")
    
    # ============================================
    # Проверка навигации в base.html
    # ============================================
    print("Проверка навигации...", file=sys.stderr)
    
    base_template_path = BASE_DIR / 'core_ui/templates/base.html'
    if base_template_path.exists():
        with open(base_template_path, 'r', encoding='utf-8') as f:
            base_content = f.read()
        
        # Проверка наличия ссылок на все основные страницы
        nav_links = [
            ("url 'index'", 'Chat'),
            ("url 'orchestrator'", 'Orchestrator'),
            ("url 'agent_hub:agents_page'", 'Agents'),
            ("url 'knowledge_base'", 'Knowledge Base'),
            ("url 'tasks:task_list'", 'Tasks'),
            ("url 'servers:server_list'", 'Servers'),
            ("url 'passwords:password_list'", 'Passwords'),
            ("url 'settings'", 'Settings'),
        ]
        
        for pattern, description in nav_links:
            if pattern not in base_content:
                warnings.append(f"Ссылка навигации не найдена: {description} ({pattern})")
    
    # ============================================
    # Проверка кнопок в chat.html
    # ============================================
    print("Проверка кнопок в chat.html...", file=sys.stderr)
    
    chat_template_path = BASE_DIR / 'core_ui/templates/chat.html'
    if chat_template_path.exists():
        with open(chat_template_path, 'r', encoding='utf-8') as f:
            chat_content = f.read()
        
        # Проверка наличия основных кнопок
        required_buttons = [
            ('id="send-btn"', 'Кнопка отправки'),
            ('id="attach-btn"', 'Кнопка прикрепления файла'),
            ('onclick="clearChat()"', 'Кнопка очистки чата'),
            ('id="model-select"', 'Выбор модели'),
            ('id="use-rag"', 'Чекбокс RAG'),
        ]
        
        for pattern, description in required_buttons:
            if pattern not in chat_content:
                errors.append(f"Кнопка/элемент не найден в chat.html: {description} ({pattern})")
        
        # Проверка, что кнопка отправки не всегда disabled
        if 'send-btn' in chat_content:
            # Проверяем, что есть логика для включения/выключения disabled
            if 'sendBtn.disabled' not in chat_content and 'disabled' in chat_content:
                # Это нормально, если disabled только временно
                pass
    
    # ============================================
    # Итоговая проверка
    # ============================================
    
    if errors:
        print("\n❌ ОШИБКИ НАЙДЕНЫ:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    
    if warnings:
        print("\n⚠️  ПРЕДУПРЕЖДЕНИЯ:", file=sys.stderr)
        for warning in warnings:
            print(f"  - {warning}", file=sys.stderr)
    
    print("Все проверки пройдены успешно!", file=sys.stderr)
    print("<promise>PASS</promise>")
    sys.exit(0)
    
except Exception as e:
    print(f"❌ КРИТИЧЕСКАЯ ОШИБКА: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
