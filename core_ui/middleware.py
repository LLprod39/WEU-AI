"""
Middleware: русский язык для админки Django + определение мобильных устройств.
"""
from urllib.parse import urlparse

from django.utils import translation
from django.conf import settings


def _origin_from_referer(referer: str) -> str | None:
    """Из Referer извлекает origin (scheme + netloc)."""
    if not referer or not referer.startswith(("http://", "https://")):
        return None
    try:
        p = urlparse(referer)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}"
    except Exception:
        pass
    return None


class CsrfTrustNgrokMiddleware:
    """
    Динамически добавляет любые ngrok-домены в CSRF_TRUSTED_ORIGINS.
    При каждом рестарте ngrok меняет URL (8e81-..., 4b20-..., и т.д.),
    поэтому фиксированный список не помогает. Middleware доверяет любой
    origin с *.ngrok-free.app или *.ngrok.io из заголовков Origin и Referer.
    """
    NGROK_PATTERNS = (".ngrok-free.app", ".ngrok.io")

    def __init__(self, get_response):
        self.get_response = get_response

    def _is_ngrok_origin(self, origin: str | None) -> bool:
        if not origin or not origin.startswith(("http://", "https://")):
            return False
        return any(p in origin for p in self.NGROK_PATTERNS)

    def _add_origins(self, to_add: set[str]) -> None:
        if not to_add:
            return
        trusted = list(getattr(settings, "CSRF_TRUSTED_ORIGINS", []))
        changed = False
        for origin in to_add:
            if origin not in trusted:
                trusted.append(origin)
                changed = True
            # всегда добавляем вторую схему (http/https) для того же хоста
            other = origin.replace("https://", "http://") if origin.startswith("https://") else origin.replace("http://", "https://")
            if other not in trusted:
                trusted.append(other)
                changed = True
        if changed:
            settings.CSRF_TRUSTED_ORIGINS = trusted

    def __call__(self, request):
        origins_to_trust: set[str] = set()

        # 1) Origin — браузер часто шлёт при CORS / частично при POST
        origin = request.META.get("HTTP_ORIGIN")
        if self._is_ngrok_origin(origin):
            origins_to_trust.add(origin)

        # 2) Referer — при POST с формы браузер может не слать Origin, но шлёт Referer
        referer = request.META.get("HTTP_REFERER")
        referer_origin = _origin_from_referer(referer)
        if self._is_ngrok_origin(referer_origin):
            origins_to_trust.add(referer_origin)

        self._add_origins(origins_to_trust)
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
