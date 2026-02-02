"""
MCP Manager - управление MCP конфигурацией per-agent
"""
import os
import json
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional
from loguru import logger


class MCPManager:
    """
    Управление MCP серверами для агентов
    
    Поддерживает:
    - Per-agent MCP конфигурация
    - Динамическая генерация mcp_config.json для CLI
    - Валидация MCP серверов
    """
    
    def __init__(self):
        pass
    
    def create_mcp_config_file(self, mcp_servers: Dict[str, Any]) -> Optional[str]:
        """
        Создать временный mcp_config.json для CLI агента
        
        Args:
            mcp_servers: Словарь с MCP серверами агента
        
        Returns:
            str: Путь к созданному файлу или None
        """
        if not mcp_servers:
            return None
        
        try:
            # Фильтруем только enabled серверы
            enabled_servers = {}
            for name, config in mcp_servers.items():
                if config.get('enabled', True):
                    server_config = {
                        "command": config.get('command'),
                        "args": config.get('args', []),
                    }
                    
                    # Env variables
                    if config.get('env'):
                        server_config['env'] = config['env']
                    
                    # Description
                    if config.get('description'):
                        server_config['description'] = config['description']
                    
                    enabled_servers[name] = server_config
            
            if not enabled_servers:
                return None
            
            # Создаём временный файл
            config_data = {"mcpServers": enabled_servers}
            
            fd, path = tempfile.mkstemp(suffix='.json', prefix='mcp_config_')
            os.close(fd)
            
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, indent=2)
            
            logger.info(f"Created MCP config file: {path}")
            return path
        
        except Exception as e:
            logger.error(f"Failed to create MCP config file: {e}")
            return None
    
    def parse_mcp_servers(self, mcp_servers: Dict[str, Any]) -> List[str]:
        """
        Парсинг MCP серверов в список команд для CLI
        
        Для Claude Code CLI:
            claude mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /path
        
        Returns:
            List[str]: Список команд для настройки MCP
        """
        commands = []
        
        for name, config in mcp_servers.items():
            if not config.get('enabled', True):
                continue
            
            command = config.get('command')
            args = config.get('args', [])
            
            if command and args:
                # Для Claude CLI
                mcp_command = f"claude mcp add {name} {command} {' '.join(args)}"
                commands.append(mcp_command)
        
        return commands
    
    def get_allowed_tools(self, mcp_servers: Dict[str, Any]) -> List[str]:
        """
        Получить список разрешённых инструментов из MCP конфигурации
        
        Returns:
            List[str]: Список tool names
        """
        allowed_tools = []
        
        for name, config in mcp_servers.items():
            if not config.get('enabled', True):
                continue
            
            tools = config.get('allowed_tools', [])
            if tools:
                # Добавляем prefix сервера к tool names
                for tool in tools:
                    allowed_tools.append(f"{name}_{tool}")
        
        return allowed_tools
    
    def validate_mcp_config(self, mcp_servers: Dict[str, Any]) -> Dict[str, Any]:
        """
        Валидация MCP конфигурации
        
        Returns:
            Dict with 'valid' bool and 'errors' list
        """
        errors = []
        
        for name, config in mcp_servers.items():
            # Проверка обязательных полей
            if not config.get('command'):
                errors.append(f"Server '{name}': missing 'command'")
            
            # Проверка типа
            if config.get('type') and config['type'] not in ['stdio', 'sse']:
                errors.append(f"Server '{name}': invalid type '{config['type']}'")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors
        }
    
    def get_default_mcp_servers(self) -> Dict[str, Any]:
        """
        Получить базовую конфигурацию MCP серверов
        
        Returns:
            Dict: Базовая конфигурация для новых агентов
        """
        return {
            "filesystem": {
                "enabled": False,
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
                "description": "File system operations",
                "allowed_tools": ["read_file", "write_file", "list_directory"]
            },
            "github": {
                "enabled": False,
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": ""},
                "description": "GitHub repository operations",
                "allowed_tools": ["create_repository", "search_repositories"]
            },
            "postgres": {
                "enabled": False,
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/db"],
                "description": "PostgreSQL database operations",
                "allowed_tools": ["query", "list_tables"]
            }
        }


# Global MCP manager instance
_mcp_manager = None


def get_mcp_manager() -> MCPManager:
    """Get or create global MCP manager instance"""
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = MCPManager()
    return _mcp_manager
