"""
Middleware: русский язык для админки Django.
Для запросов к /admin/ активируется локаль 'ru'.
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
