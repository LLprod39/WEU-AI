"""
WEU AI Agent - URL Configuration
"""
from django.urls import path
from django.contrib.auth.views import LogoutView
from . import views
from tasks import project_views as task_project_views

urlpatterns = [
    # Public landing (no auth)
    path('welcome/', views.welcome_view, name='welcome'),
    path('docs/ui-guide/', views.docs_ui_guide_view, name='docs_ui_guide'),

    # Authentication
    path('login/', views.CustomLoginView.as_view(), name='login'),
    path('logout/', LogoutView.as_view(next_page='login'), name='logout'),

    # Main Pages
    path('', views.dashboard_view, name='index'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('chat/', views.chat_view, name='chat'),
    path('orchestrator/', views.orchestrator_view, name='orchestrator'),
    path('monitor/', views.monitor_view, name='monitor'),
    path('knowledge-base/', views.knowledge_base_view, name='knowledge_base'),

    # Dashboard API
    path('api/dashboard/stats/', views.api_dashboard_stats, name='api_dashboard_stats'),
    path('settings/', views.settings_view, name='settings'),
    path('settings/projects/<int:pk>/', task_project_views.project_settings, name='settings_project'),
    path('settings/access/', views.settings_access_view, name='settings_access'),
    path('settings/users/', views.settings_users_view, name='settings_users'),
    path('settings/groups/', views.settings_groups_view, name='settings_groups'),
    path('settings/permissions/', views.settings_permissions_view, name='settings_permissions'),
    
    # Health (no auth)
    path('api/health/', views.api_health, name='api_health'),
    
    # Chat API
    path('api/chat/', views.chat_api, name='chat_api'),
    path('chat_api/', views.chat_api, name='chat_api_legacy'),  # Legacy URL
    path('api/chats/', views.api_chats_list, name='api_chats_list'),
    path('api/chats/new/', views.api_chats_create, name='api_chats_create'),
    path('api/chats/<int:chat_id>/', views.api_chat_detail, name='api_chat_detail'),
    
    # RAG API
    path('api/rag/add/', views.rag_add_api, name='rag_add'),
    path('api/rag/query/', views.rag_query_api, name='rag_query'),
    path('api/rag/reset/', views.rag_reset_api, name='rag_reset'),
    path('api/rag/delete/', views.rag_delete_api, name='rag_delete'),
    path('api/rag/documents/', views.rag_documents_api, name='rag_documents'),
    
    # Tools & Models API
    path('api/tools/', views.api_tools_list, name='api_tools'),
    path('api/models/', views.api_models_list, name='api_models'),
    
    # Settings API
    path('api/settings/', views.api_settings, name='api_settings'),
    path('api/settings/check/', views.api_settings_check, name='api_settings_check'),
    path('api/disk/', views.api_disk_usage, name='api_disk_usage'),
    path('api/clear-history/', views.api_clear_history, name='api_clear_history'),

    # Access Management API (Users, Groups, Permissions)
    path('api/access/users/', views.api_access_users, name='api_access_users'),
    path('api/access/users/<int:user_id>/', views.api_access_user_detail, name='api_access_user_detail'),
    path('api/access/users/<int:user_id>/password/', views.api_access_user_password, name='api_access_user_password'),
    path('api/access/groups/', views.api_access_groups, name='api_access_groups'),
    path('api/access/groups/<int:group_id>/', views.api_access_group_detail, name='api_access_group_detail'),
    path('api/access/groups/<int:group_id>/members/', views.api_access_group_members, name='api_access_group_members'),
    path('api/access/permissions/', views.api_access_permissions, name='api_access_permissions'),
    path('api/access/permissions/<int:perm_id>/', views.api_access_permission_detail, name='api_access_permission_detail'),
    
    # File Upload API
    path('api/chat/upload/', views.api_upload_file, name='api_upload_file'),
    
    # Agents API
    path('api/agents/', views.api_agents_list, name='api_agents_list'),
    path('api/agents/execute/', views.api_agent_execute, name='api_agent_execute'),
    
    # IDE API
    path('api/ide/files/', views.api_ide_list_files, name='api_ide_list_files'),
    path('api/ide/file/', views.api_ide_read_file, name='api_ide_read_file'),
    path('api/ide/file/', views.api_ide_write_file, name='api_ide_write_file'),
    
    # IDE Page
    path('ide/', views.ide_view, name='ide'),
]
