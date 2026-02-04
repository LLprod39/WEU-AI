from django.urls import path
from . import views
from . import project_views
from . import team_views

app_name = 'tasks'

urlpatterns = [
    # ==========================================================================
    # TEAMS
    # ==========================================================================
    path('teams/', team_views.team_list, name='team_list'),
    path('teams/create/', team_views.team_create, name='team_create'),
    path('teams/<int:pk>/', team_views.team_detail, name='team_detail'),
    path('teams/<int:pk>/edit/', team_views.team_edit, name='team_edit'),
    path('teams/<int:pk>/delete/', team_views.team_delete, name='team_delete'),
    path('teams/<int:pk>/members/add/', team_views.team_member_add, name='team_member_add'),
    path('teams/<int:pk>/members/<int:user_id>/remove/', team_views.team_member_remove, name='team_member_remove'),
    path('teams/<int:pk>/members/<int:user_id>/role/', team_views.team_member_role, name='team_member_role'),
    path('projects/<int:project_pk>/teams/<int:team_pk>/add/', team_views.add_team_to_project, name='add_team_to_project'),

    # ==========================================================================
    # PROJECTS
    # ==========================================================================
    path('projects/', project_views.project_list, name='project_list'),
    path('projects/api/', project_views.project_list_api, name='project_list_api'),
    path('projects/create/', project_views.project_create, name='project_create'),
    path('projects/<int:pk>/', project_views.project_detail, name='project_detail'),
    path('projects/<int:pk>/backlog/', project_views.project_backlog, name='project_backlog'),
    path('projects/<int:pk>/settings/', project_views.project_settings_redirect, name='project_settings'),
    path('projects/<int:pk>/delete/', project_views.project_delete, name='project_delete'),
    path('projects/<int:pk>/archive/', project_views.project_archive, name='project_archive'),
    path('projects/<int:pk>/leave/', project_views.project_leave, name='project_leave'),

    # Project Members
    path('projects/<int:pk>/members/', project_views.project_members, name='project_members'),
    path('projects/<int:pk>/members/add/', project_views.project_member_add, name='project_member_add'),
    path('projects/<int:pk>/members/<int:user_id>/remove/', project_views.project_member_remove, name='project_member_remove'),
    path('projects/<int:pk>/members/<int:user_id>/role/', project_views.project_member_role, name='project_member_role'),

    # Project Invitations
    path('projects/<int:pk>/invite/', project_views.project_invite, name='project_invite'),
    path('invitations/<str:token>/', project_views.invitation_respond, name='invitation_respond'),

    # Project Materials
    path('projects/<int:pk>/materials/', project_views.project_materials, name='project_materials'),
    path('projects/<int:pk>/materials/add/', project_views.material_add, name='material_add'),
    path('materials/<int:pk>/', project_views.material_detail, name='material_detail'),
    path('materials/<int:pk>/delete/', project_views.material_delete, name='material_delete'),

    # Sprints
    path('projects/<int:pk>/sprints/', project_views.sprint_list, name='sprint_list'),
    path('projects/<int:pk>/sprints/create/', project_views.sprint_create, name='sprint_create'),
    path('sprints/<int:pk>/', project_views.sprint_detail, name='sprint_detail'),
    path('sprints/<int:pk>/start/', project_views.sprint_start, name='sprint_start'),
    path('sprints/<int:pk>/complete/', project_views.sprint_complete, name='sprint_complete'),
    path('sprints/<int:pk>/add-tasks/', project_views.sprint_add_tasks, name='sprint_add_tasks'),

    # Saved Filters
    path('filters/', project_views.filter_list, name='filter_list'),
    path('filters/save/', project_views.filter_save, name='filter_save'),
    path('filters/<int:pk>/delete/', project_views.filter_delete, name='filter_delete'),

    # Task Relations & Watchers
    path('<int:pk>/link/', project_views.task_link, name='task_link'),
    path('<int:pk>/link/<int:relation_id>/delete/', project_views.task_unlink, name='task_unlink'),
    path('<int:pk>/watchers/', project_views.task_watchers, name='task_watchers'),
    path('<int:pk>/move/', project_views.task_move, name='task_move'),

    # Bulk Operations
    path('bulk/', project_views.tasks_bulk_action, name='tasks_bulk_action'),

    # ==========================================================================
    # TASKS (existing)
    # ==========================================================================
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
    path('<int:task_id>/update-priority/', views.task_update_priority, name='task_update_priority'),
    path('<int:task_id>/update-server/', views.task_update_server, name='task_update_server'),
    path('<int:task_id>/delete/', views.task_delete, name='task_delete'),

    # Subtasks
    path('<int:task_id>/subtask/', views.subtask_create, name='subtask_create'),
    path('subtask/<int:subtask_id>/toggle/', views.subtask_toggle, name='subtask_toggle'),
    path('subtask/<int:subtask_id>/', views.subtask_delete, name='subtask_delete'),

    # Comments
    path('<int:task_id>/comments/', views.comments_list, name='comments_list'),
    path('<int:task_id>/comment/', views.comment_create, name='comment_create'),

    # AI
    path('<int:task_id>/ai-improve/', views.ai_improve_description, name='ai_improve'),
    path('<int:task_id>/ai-breakdown/', views.ai_breakdown, name='ai_breakdown'),
    path('<int:task_id>/ai-analyze/', views.ai_analyze, name='ai_analyze'),
]
