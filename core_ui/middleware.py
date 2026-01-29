"""
Middleware: русский язык для админки Django + определение мобильных устройств.
"""
from django.utils import translation


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
