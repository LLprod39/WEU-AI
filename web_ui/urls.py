"""
URL configuration for web_ui project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from app.integrations import jira_views

admin.site.site_header = "WEU AI Admin"
admin.site.site_title = "WEU AI — Админка"
admin.site.index_title = "Управление"

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('core_ui.urls')),
    path('tasks/', include('tasks.urls')),
    path('passwords/', include('passwords.urls')),
    path('servers/', include('servers.urls')),
    path('agents/', include('agent_hub.urls')),
    path('skills/', include('skills.urls')),
    
    # Jira Integration API
    path('api/jira/sync/', jira_views.api_jira_sync, name='api_jira_sync'),
    path('api/jira/update-status/', jira_views.api_jira_update_status, name='api_jira_update_status'),
    path('api/jira/test/', jira_views.api_jira_test, name='api_jira_test'),
    path('api/jira/projects/', jira_views.api_jira_projects, name='api_jira_projects'),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
