"""
Password Manager Models
"""
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from .encryption import PasswordEncryption


class CredentialCategory(models.Model):
    """Categories for organizing credentials"""
    name = models.CharField(max_length=100, unique=True)
    color = models.CharField(max_length=7, default='#3b82f6')  # Hex color
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        verbose_name_plural = "Credential Categories"
        ordering = ['name']
    
    def __str__(self):
        return self.name


class CredentialTag(models.Model):
    """Tags for credentials"""
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(max_length=7, default='#6b7280')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['name']
    
    def __str__(self):
        return self.name


class Credential(models.Model):
    """Stored credential (account/password)"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='credentials')
    category = models.ForeignKey(
        CredentialCategory, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='credentials'
    )
    
    # Credential data
    name = models.CharField(max_length=200)  # Display name
    username = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    url = models.URLField(blank=True)
    encrypted_password = models.TextField()  # Encrypted password
    salt = models.BinaryField()  # Salt for encryption
    
    # Additional info
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_accessed = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['user', '-updated_at']),
            models.Index(fields=['category', 'user']),
        ]
    
    def __str__(self):
        return self.name
    
    def decrypt_password(self, master_password: str) -> str:
        """Decrypt password using master password"""
        try:
            return PasswordEncryption.decrypt_password(
                self.encrypted_password,
                master_password,
                bytes(self.salt)
            )
        except Exception as e:
            raise ValueError(f"Failed to decrypt password: {e}")
    
    def encrypt_and_save_password(self, password: str, master_password: str):
        """Encrypt and save password"""
        if not self.salt:
            self.salt = PasswordEncryption.generate_salt()
        
        self.encrypted_password = PasswordEncryption.encrypt_password(
            password,
            master_password,
            bytes(self.salt)
        )
        self.save()
    
    def update_last_accessed(self):
        """Update last accessed timestamp"""
        self.last_accessed = timezone.now()
        self.save(update_fields=['last_accessed'])


class CredentialTagRelation(models.Model):
    """Many-to-many relationship between Credential and CredentialTag"""
    credential = models.ForeignKey(Credential, on_delete=models.CASCADE, related_name='tag_relations')
    tag = models.ForeignKey(CredentialTag, on_delete=models.CASCADE, related_name='credential_relations')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['credential', 'tag']


class CredentialAccessLog(models.Model):
    """Audit log for credential access"""
    credential = models.ForeignKey(Credential, on_delete=models.CASCADE, related_name='access_logs')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=50)  # 'viewed', 'decrypted', 'updated', etc.
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['credential', '-created_at']),
        ]
    
    def __str__(self):
        return f"{self.action} on {self.credential.name} at {self.created_at}"
