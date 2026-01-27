"""
Encryption utilities for password manager
"""
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend
import base64
from loguru import logger


class PasswordEncryption:
    """Handle encryption/decryption of passwords"""
    
    @staticmethod
    def _get_key_from_password(password: str, salt: bytes) -> bytes:
        """Derive encryption key from password"""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        return key
    
    @staticmethod
    def encrypt_password(password: str, master_password: str, salt: bytes) -> str:
        """
        Encrypt a password using master password.
        
        Args:
            password: Password to encrypt
            master_password: Master password for encryption
            salt: Salt bytes (should be unique per credential)
            
        Returns:
            Encrypted password as base64 string
        """
        try:
            key = PasswordEncryption._get_key_from_password(master_password, salt)
            fernet = Fernet(key)
            encrypted = fernet.encrypt(password.encode())
            return base64.urlsafe_b64encode(encrypted).decode()
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            raise
    
    @staticmethod
    def decrypt_password(encrypted_password: str, master_password: str, salt: bytes) -> str:
        """
        Decrypt a password using master password.
        
        Args:
            encrypted_password: Encrypted password (base64 string)
            master_password: Master password for decryption
            salt: Salt bytes (must match encryption salt)
            
        Returns:
            Decrypted password
        """
        try:
            key = PasswordEncryption._get_key_from_password(master_password, salt)
            fernet = Fernet(key)
            encrypted_bytes = base64.urlsafe_b64decode(encrypted_password.encode())
            decrypted = fernet.decrypt(encrypted_bytes)
            return decrypted.decode()
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            raise
    
    @staticmethod
    def generate_salt() -> bytes:
        """Generate a random salt"""
        return os.urandom(16)
    
    @staticmethod
    def generate_password(length: int = 16, include_symbols: bool = True) -> str:
        """Generate a random password"""
        import secrets
        import string
        
        alphabet = string.ascii_letters + string.digits
        if include_symbols:
            alphabet += "!@#$%^&*()_+-=[]{}|;:,.<>?"
        
        return ''.join(secrets.choice(alphabet) for _ in range(length))
