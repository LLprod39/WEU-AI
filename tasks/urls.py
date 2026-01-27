from django.urls import path
from . import views

app_name = 'tasks'

urlpatterns = [
    path('', views.task_list, name='task_list'),
    path('create/', views.task_create, name='task_create'),
    path('<int:task_id>/', views.task_detail_api, name='task_detail_api'),
    path('<int:task_id>/update-status/', views.task_update_status, name='task_update_status'),
    path('<int:task_id>/delete/', views.task_delete, name='task_delete'),
    path('<int:task_id>/ai-improve/', views.ai_improve_description, name='ai_improve'),
    path('<int:task_id>/ai-breakdown/', views.ai_breakdown, name='ai_breakdown'),
    path('<int:task_id>/ai-analyze/', views.ai_analyze, name='ai_analyze'),
]
