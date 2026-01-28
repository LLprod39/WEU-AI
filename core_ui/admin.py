from django.contrib import admin
from .models import UserAppPermission


@admin.register(UserAppPermission)
class UserAppPermissionAdmin(admin.ModelAdmin):
    list_display = ['user', 'feature', 'allowed']
    list_filter = ['feature', 'allowed']
    search_fields = ['user__username', 'user__email']
    ordering = ['user', 'feature']
    list_editable = ['allowed']
