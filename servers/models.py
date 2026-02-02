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

    # Group-level rules
    rules = models.TextField(
        blank=True,
        help_text='Правила для группы серверов: специфичные политики, ограничения'
    )
    forbidden_commands = models.JSONField(
        default=list,
        blank=True,
        help_text='Запрещённые команды для этой группы'
    )
    environment_vars = models.JSONField(
        default=dict,
        blank=True,
        help_text='Переменные окружения для группы'
    )

    class Meta:
        unique_together = ['name', 'user']
        ordering = ['name']

    def __str__(self):
        return self.name

    def get_context_for_ai(self) -> str:
        """Get formatted context for AI agents"""
        parts = []

        if self.description:
            parts.append(f"Группа: {self.name}\n{self.description}")

        if self.rules:
            parts.append(f"Правила группы:\n{self.rules}")

        if self.forbidden_commands:
            cmds = ', '.join(self.forbidden_commands)
            parts.append(f"⛔ Запрещено в группе: {cmds}")

        return '\n'.join(parts) if parts else ''


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
    corporate_context = models.TextField(
        blank=True,
        help_text="Корпоративные требования: прокси, VPN, env переменные, условия доступа"
    )
    is_active = models.BooleanField(default=True)
    
    # Network Context для корпоративных сетей
    network_config = models.JSONField(
        default=dict,
        blank=True,
        help_text="Контекст корпоративной сети: прокси, VPN, firewall, env variables"
    )
    
    # Helper fields для UI (заполняются автоматически из network_config)
    has_proxy = models.BooleanField(
        default=False,
        help_text="Сервер работает через прокси"
    )
    requires_vpn = models.BooleanField(
        default=False,
        help_text="Требуется VPN для подключения"
    )
    behind_firewall = models.BooleanField(
        default=True,
        help_text="Сервер за корпоративным файрволлом"
    )
    
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
    
    def get_network_context_summary(self) -> str:
        """Получить описание сетевого контекста для AI"""
        parts = []
        
        # Сначала из corporate_context (приоритет - текстовые заметки)
        if self.corporate_context:
            parts.append(self.corporate_context.strip())
        
        # Дополнительно из network_config если есть
        if self.network_config:
            nc = self.network_config
            
            # Прокси
            if nc.get('proxy', {}).get('http_proxy'):
                parts.append(f"Прокси: {nc['proxy']['http_proxy']}")
            
            # VPN
            if nc.get('vpn', {}).get('required'):
                vpn_type = nc['vpn'].get('type', 'VPN')
                parts.append(f"VPN: {vpn_type}")
            
            # Bastion
            if nc.get('network', {}).get('bastion_host'):
                parts.append(f"Bastion: {nc['network']['bastion_host']}")
            
            # Firewall
            if nc.get('firewall', {}).get('inbound_ports'):
                ports = nc['firewall']['inbound_ports']
                parts.append(f"Порты: {','.join(map(str, ports))}")
        
        return "\n".join(parts) if parts else "Стандартная сеть"
    
    def update_network_flags(self):
        """Обновить helper flags на основе network_config"""
        if not self.network_config:
            return
        
        nc = self.network_config
        
        # Proxy
        self.has_proxy = bool(nc.get('proxy', {}).get('http_proxy'))
        
        # VPN
        self.requires_vpn = bool(nc.get('vpn', {}).get('required'))
        
        # Firewall (по умолчанию True для корпоративных сетей)
        if nc.get('firewall'):
            self.behind_firewall = True


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


class GlobalServerRules(models.Model):
    """
    Global rules for all servers belonging to a user.
    These rules apply to every server unless overridden.
    """
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='global_server_rules'
    )
    rules = models.TextField(
        blank=True,
        help_text='Общие правила для всех серверов: политики безопасности, запрещённые команды, корпоративные требования'
    )
    forbidden_commands = models.JSONField(
        default=list,
        blank=True,
        help_text='Список запрещённых команд/паттернов: ["rm -rf /", "shutdown", ...]'
    )
    required_checks = models.JSONField(
        default=list,
        blank=True,
        help_text='Обязательные проверки перед выполнением: ["df -h", "free -m", ...]'
    )
    environment_vars = models.JSONField(
        default=dict,
        blank=True,
        help_text='Глобальные переменные окружения для всех серверов'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Global Server Rules'
        verbose_name_plural = 'Global Server Rules'

    def __str__(self):
        return f"Global rules for {self.user.username}"

    def get_context_for_ai(self) -> str:
        """Get formatted context for AI agents"""
        parts = []

        if self.rules:
            parts.append(f"=== ГЛОБАЛЬНЫЕ ПРАВИЛА ===\n{self.rules}")

        if self.forbidden_commands:
            cmds = ', '.join(self.forbidden_commands)
            parts.append(f"⛔ Запрещённые команды: {cmds}")

        if self.required_checks:
            checks = ', '.join(self.required_checks)
            parts.append(f"✅ Обязательные проверки: {checks}")

        return '\n\n'.join(parts) if parts else ''


class ServerKnowledge(models.Model):
    """
    AI-generated and manual knowledge about a specific server.
    Accumulated knowledge helps AI work more effectively.
    """
    CATEGORY_CHOICES = [
        ('system', 'Система'),
        ('services', 'Сервисы'),
        ('network', 'Сеть'),
        ('security', 'Безопасность'),
        ('performance', 'Производительность'),
        ('storage', 'Хранилище'),
        ('packages', 'Пакеты/ПО'),
        ('config', 'Конфигурация'),
        ('issues', 'Известные проблемы'),
        ('solutions', 'Решения'),
        ('other', 'Другое'),
    ]

    SOURCE_CHOICES = [
        ('manual', 'Ручной ввод'),
        ('ai_auto', 'AI автоматически'),
        ('ai_task', 'AI после задачи'),
    ]

    server = models.ForeignKey(
        Server,
        on_delete=models.CASCADE,
        related_name='knowledge'
    )
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='other')
    title = models.CharField(max_length=200)
    content = models.TextField(help_text='Содержимое заметки/знания')
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='manual')
    confidence = models.FloatField(
        default=1.0,
        help_text='Уверенность в актуальности (0.0-1.0)'
    )
    is_active = models.BooleanField(default=True)
    task_id = models.IntegerField(
        null=True,
        blank=True,
        help_text='ID задачи, после которой создано знание'
    )
    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    verified_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Когда последний раз проверялось'
    )

    class Meta:
        ordering = ['-updated_at']
        verbose_name = 'Server Knowledge'
        verbose_name_plural = 'Server Knowledge'
        indexes = [
            models.Index(fields=['server', 'category', '-updated_at']),
        ]

    def __str__(self):
        return f"{self.server.name}: {self.title}"


class ServerGroupKnowledge(models.Model):
    """Knowledge applicable to a group of servers"""
    CATEGORY_CHOICES = [
        ('policy', 'Политика'),
        ('access', 'Доступ'),
        ('deployment', 'Деплой'),
        ('monitoring', 'Мониторинг'),
        ('backup', 'Бэкапы'),
        ('network', 'Сеть'),
        ('other', 'Другое'),
    ]

    SOURCE_CHOICES = [
        ('manual', 'Ручной ввод'),
        ('ai_auto', 'AI автоматически'),
    ]

    group = models.ForeignKey(
        ServerGroup,
        on_delete=models.CASCADE,
        related_name='knowledge'
    )
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='other')
    title = models.CharField(max_length=200)
    content = models.TextField()
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='manual')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.group.name}: {self.title}"
