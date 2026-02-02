"""
WEU AI Platform Django project.
"""
# Import Celery app so it's loaded when Django starts
from web_ui.celery import app as celery_app

__all__ = ("celery_app",)
