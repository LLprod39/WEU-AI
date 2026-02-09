"""
Middleware: русский язык для админки Django + определение мобильных устройств.
"""
from django.utils import translation
from django.conf import settings


class CsrfTrustNgrokMiddleware:
    """
    Динамически добавляет ngrok-домены в CSRF_TRUSTED_ORIGINS.
    При каждом рестарте ngrok меняет URL (8e81-..., 8c56-..., и т.д.),
    поэтому фиксированный список не работает. Этот middleware доверяет
    любой Origin с *.ngrok-free.app или *.ngrok.io.
    """
    NGROK_PATTERNS = (".ngrok-free.app", ".ngrok.io")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.META.get("HTTP_ORIGIN")
        if origin and any(p in origin for p in self.NGROK_PATTERNS):
            trusted = getattr(settings, "CSRF_TRUSTED_ORIGINS", [])
            if origin not in trusted:
                settings.CSRF_TRUSTED_ORIGINS = list(trusted) + [origin]
                # http-версия для смешанного контента
                http_origin = origin.replace("https://", "http://")
                if http_origin not in settings.CSRF_TRUSTED_ORIGINS:
                    settings.CSRF_TRUSTED_ORIGINS = list(settings.CSRF_TRUSTED_ORIGINS) + [http_origin]
        return self.get_response(request)


class AdminRussianMiddleware:
    """Включает русский интерфейс для страниц /admin/."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/admin/"):
            translation.activate("ru")
        response = self.get_response(request)
        return response


class MobileDetectionMiddleware:
    """
    Определяет мобильные устройства по User-Agent.
    Устанавливает request.is_mobile = True/False.
    """
    
    MOBILE_KEYWORDS = [
        'mobile', 'android', 'iphone', 'ipad', 'ipod', 
        'webos', 'blackberry', 'opera mini', 'opera mobi',
        'iemobile', 'windows phone', 'palm', 'symbian'
    ]
    
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user_agent = request.META.get('HTTP_USER_AGENT', '').lower()
        request.is_mobile = any(kw in user_agent for kw in self.MOBILE_KEYWORDS)
        
        # Также проверяем query параметр для тестирования
        if request.GET.get('mobile') == '1':
            request.is_mobile = True
        elif request.GET.get('mobile') == '0':
            request.is_mobile = False
            
        response = self.get_response(request)
        return response


def get_template_name(request, desktop_template: str) -> str:
    """
    Возвращает мобильный или десктопный шаблон в зависимости от устройства.
    
    Args:
        request: Django request object
        desktop_template: имя десктопного шаблона (например 'chat.html')
        
    Returns:
        Путь к шаблону: 'mobile/chat.html' или 'chat.html'
    """
    if getattr(request, 'is_mobile', False):
        return f'mobile/{desktop_template}'
    return desktop_template
