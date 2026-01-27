"""
Django management command для проверки страницы
"""
from django.core.management.base import BaseCommand
from django.template.loader import get_template
from core_ui import views
from core_ui import urls
from web_ui import urls as root_urls


class Command(BaseCommand):
    help = 'Проверка, что страница работает без ошибок'

    def handle(self, *args, **options):
        try:
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
            
            self.stdout.write("<promise>PASS</promise>")
            
        except Exception as e:
            self.stderr.write(f"ОШИБКА: {e}")
            import traceback
            traceback.print_exc()
            raise
