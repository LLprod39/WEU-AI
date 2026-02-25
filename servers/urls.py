from django.urls import path
from . import views

app_name = 'servers'

urlpatterns = [
    path('', views.server_list, name='server_list'),
    path('hub/', views.multi_terminal, name='multi_terminal'),
    path('<int:server_id>/terminal/', views.server_terminal_page, name='server_terminal'),
    path('<int:server_id>/terminal/minimal/', views.terminal_minimal, name='terminal_minimal'),
    path('api/create/', views.server_create, name='server_create'),
    path('api/<int:server_id>/update/', views.server_update, name='server_update'),
    path('api/<int:server_id>/test/', views.server_test_connection, name='server_test'),
    path('api/<int:server_id>/execute/', views.server_execute_command, name='server_execute'),
    path('api/<int:server_id>/delete/', views.server_delete, name='server_delete'),
    path('api/<int:server_id>/shares/', views.server_share_list, name='server_share_list'),
    path('api/<int:server_id>/share/', views.server_share_create, name='server_share_create'),
    path('api/<int:server_id>/shares/<int:share_id>/revoke/', views.server_share_revoke, name='server_share_revoke'),
    path('api/groups/create/', views.group_create, name='group_create'),
    path('api/groups/<int:group_id>/update/', views.group_update, name='group_update'),
    path('api/groups/<int:group_id>/delete/', views.group_delete, name='group_delete'),
    path('api/groups/<int:group_id>/add-member/', views.group_add_member, name='group_add_member'),
    path('api/groups/<int:group_id>/remove-member/', views.group_remove_member, name='group_remove_member'),
    path('api/groups/<int:group_id>/subscribe/', views.group_subscribe, name='group_subscribe'),
    path('api/bulk-update/', views.bulk_update_servers, name='bulk_update_servers'),
    path('api/global-context/', views.global_context_get, name='global_context_get'),
    path('api/global-context/save/', views.global_context_save, name='global_context_save'),
    path('api/groups/<int:group_id>/context/', views.group_context_get, name='group_context_get'),
    path('api/groups/<int:group_id>/context/save/', views.group_context_save, name='group_context_save'),
    path('api/<int:server_id>/get/', views.server_get, name='server_get'),
    path('api/<int:server_id>/knowledge/', views.server_knowledge_list, name='server_knowledge_list'),
    path('api/<int:server_id>/knowledge/create/', views.server_knowledge_create, name='server_knowledge_create'),
    path('api/<int:server_id>/knowledge/<int:knowledge_id>/update/', views.server_knowledge_update, name='server_knowledge_update'),
    path('api/<int:server_id>/knowledge/<int:knowledge_id>/delete/', views.server_knowledge_delete, name='server_knowledge_delete'),
    path('api/master-password/set/', views.set_master_password, name='set_master_password'),
    path('api/master-password/check/', views.get_master_password, name='get_master_password'),
    path('api/master-password/clear/', views.clear_master_password, name='clear_master_password'),
]
