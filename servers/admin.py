from django.contrib import admin
from .models import (
    Server,
    ServerGroup,
    ServerConnection,
    ServerCommandHistory,
    ServerGroupMember,
    ServerGroupTag,
    ServerGroupSubscription,
    ServerGroupPermission,
)


@admin.register(ServerGroup)
class ServerGroupAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'created_at']
    list_filter = ['created_at']
    search_fields = ['name']


@admin.register(Server)
class ServerAdmin(admin.ModelAdmin):
    list_display = ['name', 'host', 'port', 'username', 'auth_method', 'user', 'is_active', 'created_at']
    list_filter = ['auth_method', 'is_active', 'created_at']
    search_fields = ['name', 'host', 'username']
    readonly_fields = ['created_at', 'updated_at', 'last_connected']


@admin.register(ServerConnection)
class ServerConnectionAdmin(admin.ModelAdmin):
    list_display = ['server', 'user', 'status', 'connected_at', 'disconnected_at']
    list_filter = ['status', 'connected_at']
    readonly_fields = ['connected_at', 'disconnected_at']


@admin.register(ServerCommandHistory)
class ServerCommandHistoryAdmin(admin.ModelAdmin):
    list_display = ['server', 'user', 'command', 'exit_code', 'executed_at']
    list_filter = ['executed_at', 'exit_code']
    readonly_fields = ['executed_at']
    search_fields = ['command', 'server__name']


@admin.register(ServerGroupTag)
class ServerGroupTagAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'created_at']
    search_fields = ['name']


@admin.register(ServerGroupMember)
class ServerGroupMemberAdmin(admin.ModelAdmin):
    list_display = ['group', 'user', 'role', 'joined_at']
    list_filter = ['role']
    search_fields = ['group__name', 'user__username']


@admin.register(ServerGroupSubscription)
class ServerGroupSubscriptionAdmin(admin.ModelAdmin):
    list_display = ['group', 'user', 'kind', 'created_at']
    list_filter = ['kind']


@admin.register(ServerGroupPermission)
class ServerGroupPermissionAdmin(admin.ModelAdmin):
    list_display = ['group', 'user', 'can_view', 'can_execute', 'can_edit', 'can_manage_members']
