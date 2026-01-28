from django.urls import path
from . import views

app_name = 'tasks'

urlpatterns = [
    path('', views.task_list, name='task_list'),
    path('create/', views.task_create, name='task_create'),
    
    # Notifications
    path('notifications/', views.notifications_list, name='notifications_list'),
    path('notifications/mark-all-read/', views.notifications_mark_all_read, name='notifications_mark_all_read'),
    path('notifications/<int:notification_id>/read/', views.notification_mark_read, name='notification_mark_read'),
    path('notifications/<int:notification_id>/action/', views.notification_action, name='notification_action'),
    
    # Execution Settings
    path('settings/', views.execution_settings_page, name='execution_settings'),
    path('settings/get/', views.execution_settings_get, name='execution_settings_get'),
    path('settings/update/', views.execution_settings_update, name='execution_settings_update'),
    
    # Task operations
    path('<int:task_id>/approve-auto-execution/', views.approve_auto_execution, name='approve_auto_execution'),
    path('<int:task_id>/delegate-form/', views.delegate_form, name='delegate_form'),
    path('<int:task_id>/', views.task_detail_api, name='task_detail_api'),
    path('<int:task_id>/update-status/', views.task_update_status, name='task_update_status'),
    path('<int:task_id>/delete/', views.task_delete, name='task_delete'),
    path('<int:task_id>/ai-improve/', views.ai_improve_description, name='ai_improve'),
    path('<int:task_id>/ai-breakdown/', views.ai_breakdown, name='ai_breakdown'),
    path('<int:task_id>/ai-analyze/', views.ai_analyze, name='ai_analyze'),
]
