"""
Server Management Models
"""
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class ServerGroup(models.Model):
    """Groups for organizing servers"""
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=7, default='#3b82f6')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='server_groups')
    created_at = models.DateTimeField(auto_now_add=True)
    tags = models.ManyToManyField("ServerGroupTag", blank=True, related_name="groups")
    
    class Meta:
        unique_together = ['name', 'user']
        ordering = ['name']
    
    def __str__(self):
        return self.name


class ServerGroupTag(models.Model):
    """Tags for server groups"""
    name = models.CharField(max_length=50)
    color = models.CharField(max_length=7, default="#6b7280")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="server_group_tags")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["name", "user"]
        ordering = ["name"]

    def __str__(self):
        return self.name


class ServerGroupMember(models.Model):
    """Memberships with roles"""
    ROLE_CHOICES = [
        ("owner", "Owner"),
        ("admin", "Admin"),
        ("member", "Member"),
        ("viewer", "Viewer"),
    ]
    group = models.ForeignKey(ServerGroup, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="server_group_memberships")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="member")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["group", "user"]

    def __str__(self):
        return f"{self.group.name} - {self.user.username} ({self.role})"


class ServerGroupSubscription(models.Model):
    """Subscriptions for notifications or favorites"""
    KIND_CHOICES = [
        ("follow", "Follow"),
        ("favorite", "Favorite"),
    ]
    group = models.ForeignKey(ServerGroup, on_delete=models.CASCADE, related_name="subscriptions")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="server_group_subscriptions")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="follow")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["group", "user", "kind"]


class ServerGroupPermission(models.Model):
    """Optional granular permissions overrides"""
    group = models.ForeignKey(ServerGroup, on_delete=models.CASCADE, related_name="permissions")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="server_group_permissions")
    can_view = models.BooleanField(default=True)
    can_execute = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)
    can_manage_members = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["group", "user"]


class Server(models.Model):
    """Server configuration"""
    AUTH_METHOD_CHOICES = [
        ('password', 'Password'),
        ('key', 'SSH Key'),
        ('key_password', 'SSH Key + Password'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='servers')
    group = models.ForeignKey(
        ServerGroup, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='servers'
    )
    
    # Server info
    name = models.CharField(max_length=200)  # Display name
    host = models.CharField(max_length=255)
    port = models.IntegerField(default=22)
    username = models.CharField(max_length=100)
    
    # Authentication
    auth_method = models.CharField(max_length=20, choices=AUTH_METHOD_CHOICES, default='password')
    encrypted_password = models.TextField(blank=True)  # Encrypted password if using password auth
    key_path = models.CharField(max_length=500, blank=True)  # Path to SSH key
    salt = models.BinaryField(null=True, blank=True)  # For password encryption
    
    # Additional info
    tags = models.CharField(max_length=500, blank=True)  # Comma-separated tags
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_connected = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['user', '-updated_at']),
            models.Index(fields=['group', 'user']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.host}:{self.port})"
    
    def get_connection_string(self) -> str:
        """Get SSH connection string"""
        return f"{self.username}@{self.host}:{self.port}"


class ServerConnection(models.Model):
    """Active server connections"""
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='connections')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='server_connections')
    connection_id = models.CharField(max_length=100, unique=True)  # Internal connection ID
    status = models.CharField(max_length=20, default='connected')  # connected, disconnected, error
    connected_at = models.DateTimeField(auto_now_add=True)
    disconnected_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-connected_at']
    
    def __str__(self):
        return f"{self.server.name} - {self.status}"


class ServerCommandHistory(models.Model):
    """History of commands executed on servers"""
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='command_history')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    command = models.TextField()
    output = models.TextField(blank=True)
    exit_code = models.IntegerField(null=True, blank=True)
    executed_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-executed_at']
        indexes = [
            models.Index(fields=['server', '-executed_at']),
        ]
    
    def __str__(self):
        return f"{self.server.name}: {self.command[:50]}"
