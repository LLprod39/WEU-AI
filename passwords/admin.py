from django.contrib import admin
from .models import (
    Credential, CredentialCategory, CredentialTag,
    CredentialTagRelation, CredentialAccessLog
)


@admin.register(CredentialCategory)
class CredentialCategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'created_at']
    search_fields = ['name']


@admin.register(CredentialTag)
class CredentialTagAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'created_at']
    search_fields = ['name']


@admin.register(Credential)
class CredentialAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'category', 'username', 'url', 'created_at', 'updated_at']
    list_filter = ['category', 'created_at']
    search_fields = ['name', 'username', 'email', 'url']
    readonly_fields = ['created_at', 'updated_at', 'last_accessed']
    filter_horizontal = []


@admin.register(CredentialAccessLog)
class CredentialAccessLogAdmin(admin.ModelAdmin):
    list_display = ['credential', 'user', 'action', 'ip_address', 'created_at']
    list_filter = ['action', 'created_at']
    readonly_fields = ['created_at']
    search_fields = ['credential__name']
