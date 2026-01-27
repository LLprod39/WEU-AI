from django.urls import path
from . import views

app_name = 'servers'

urlpatterns = [
    path('', views.server_list, name='server_list'),
    path('api/create/', views.server_create, name='server_create'),
    path('api/<int:server_id>/test/', views.server_test_connection, name='server_test'),
    path('api/<int:server_id>/execute/', views.server_execute_command, name='server_execute'),
    path('api/groups/create/', views.group_create, name='group_create'),
    path('api/groups/<int:group_id>/update/', views.group_update, name='group_update'),
    path('api/groups/<int:group_id>/delete/', views.group_delete, name='group_delete'),
    path('api/groups/<int:group_id>/add-member/', views.group_add_member, name='group_add_member'),
    path('api/groups/<int:group_id>/remove-member/', views.group_remove_member, name='group_remove_member'),
    path('api/groups/<int:group_id>/subscribe/', views.group_subscribe, name='group_subscribe'),
    path('api/bulk-update/', views.bulk_update_servers, name='bulk_update_servers'),
]
