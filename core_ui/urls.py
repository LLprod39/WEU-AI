"""
WEU AI Agent - URL Configuration
"""
from django.urls import path
from django.contrib.auth.views import LogoutView
from . import views

urlpatterns = [
    # Public landing (no auth)
    path('welcome/', views.welcome_view, name='welcome'),
    path('docs/ui-guide/', views.docs_ui_guide_view, name='docs_ui_guide'),

    # Authentication
    path('login/', views.CustomLoginView.as_view(), name='login'),
    path('logout/', LogoutView.as_view(next_page='login'), name='logout'),

    # Main Pages
    path('', views.index, name='index'),
    path('chat/', views.index, name='chat'),
    path('orchestrator/', views.orchestrator_view, name='orchestrator'),
    path('knowledge-base/', views.knowledge_base_view, name='knowledge_base'),
    path('settings/', views.settings_view, name='settings'),
    
    # Health (no auth)
    path('api/health/', views.api_health, name='api_health'),
    
    # Chat API
    path('api/chat/', views.chat_api, name='chat_api'),
    path('chat_api/', views.chat_api, name='chat_api_legacy'),  # Legacy URL
    
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
    path('api/clear-history/', views.api_clear_history, name='api_clear_history'),
    
    # File Upload API
    path('api/chat/upload/', views.api_upload_file, name='api_upload_file'),
    
    # Agents API
    path('api/agents/', views.api_agents_list, name='api_agents_list'),
    path('api/agents/execute/', views.api_agent_execute, name='api_agent_execute'),
]
