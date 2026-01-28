"""
SSH Agent Tool for Remote Operations
Allows the agent to connect to SSH servers and execute commands
"""
import asyncssh
from loguru import logger
from typing import Optional, Dict, Any
from app.tools.base import BaseTool, ToolMetadata, ToolParameter
from app.tools.safety import is_dangerous_command


class SSHConnectionManager:
    """Manages SSH connections"""
    
    def __init__(self):
        self.connections: Dict[str, asyncssh.SSHClientConnection] = {}
    
    async def connect(
        self,
        host: str,
        username: str,
        password: Optional[str] = None,
        key_path: Optional[str] = None,
        port: int = 22,
    ) -> str:
        """
        Establish SSH connection
        Returns connection ID
        """
        conn_id = f"{username}@{host}:{port}"
        
        try:
            if conn_id in self.connections:
                logger.info(f"Reusing existing connection: {conn_id}")
                return conn_id
            
            logger.info(f"Connecting to {conn_id}...")
            
            # Prepare connection options
            options = {
                "known_hosts": None,  # Skip host key verification (use with caution!)
                "connect_timeout": 10,
                "login_timeout": 10,
                "keepalive_interval": 20,
                "keepalive_count_max": 3,
            }
            
            if password:
                options['password'] = password
            elif key_path:
                options['client_keys'] = [key_path]
            
            conn = await asyncssh.connect(
                host=host,
                port=port,
                username=username,
                **options,
            )
            
            self.connections[conn_id] = conn
            logger.success(f"Connected to {conn_id}")
            return conn_id
            
        except Exception as e:
            logger.error(f"SSH connection failed: {e}")
            raise
    
    async def disconnect(self, conn_id: str):
        """Close SSH connection"""
        if conn_id in self.connections:
            self.connections[conn_id].close()
            await self.connections[conn_id].wait_closed()
            del self.connections[conn_id]
            logger.info(f"Disconnected from {conn_id}")
    
    async def execute(self, conn_id: str, command: str) -> Dict[str, Any]:
        """Execute command on remote host"""
        if conn_id not in self.connections:
            raise ValueError(f"No active connection: {conn_id}")
        
        try:
            conn = self.connections[conn_id]
            result = await conn.run(command, check=False)
            
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.exit_status,
                "success": result.exit_status == 0
            }
        except Exception as e:
            logger.error(f"Command execution failed: {e}")
            return {
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1,
                "success": False
            }


# Global SSH manager instance
ssh_manager = SSHConnectionManager()


class SSHConnectTool(BaseTool):
    """Tool for establishing SSH connections"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="ssh_connect",
            description="Connect to a remote server via SSH",
            category="ssh",
            parameters=[
                ToolParameter(name="host", type="string", description="SSH host address"),
                ToolParameter(name="username", type="string", description="SSH username"),
                ToolParameter(name="password", type="string", description="SSH password (optional)", required=False),
                ToolParameter(name="key_path", type="string", description="Path to SSH private key (optional)", required=False),
                ToolParameter(name="port", type="number", description="SSH port", required=False, default=22),
            ]
        )
    
    async def execute(self, host: str, username: str, password: Optional[str] = None,
                     key_path: Optional[str] = None, port: int = 22) -> str:
        """Execute SSH connection"""
        conn_id = await ssh_manager.connect(host, username, password, key_path, port)
        return f"Successfully connected to {conn_id}. Use this ID for subsequent SSH commands."


class SSHExecuteTool(BaseTool):
    """Tool for executing commands over SSH"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="ssh_execute",
            description="Execute a command on a remote SSH server",
            category="ssh",
            parameters=[
                ToolParameter(name="conn_id", type="string", description="SSH connection ID (from ssh_connect)"),
                ToolParameter(name="command", type="string", description="Command to execute"),
                ToolParameter(
                    name="allow_destructive",
                    type="boolean",
                    description="Allow potentially destructive commands (explicit user confirmation required)",
                    required=False,
                ),
            ]
        )
    
    async def execute(self, conn_id: str, command: str, allow_destructive: bool = False) -> Dict[str, Any]:
        """Execute command over SSH"""
        if is_dangerous_command(command) and not allow_destructive:
            return {"success": False, "stderr": "Команда выглядит опасной. Нужен явный допуск allow_destructive=true.", "stdout": "", "exit_code": -1}
        result = await ssh_manager.execute(conn_id, command)
        return result


class SSHDisconnectTool(BaseTool):
    """Tool for closing SSH connections"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="ssh_disconnect",
            description="Close an active SSH connection",
            category="ssh",
            parameters=[
                ToolParameter(name="conn_id", type="string", description="SSH connection ID to close"),
            ]
        )
    
    async def execute(self, conn_id: str) -> str:
        """Close SSH connection"""
        await ssh_manager.disconnect(conn_id)
        return f"Disconnected from {conn_id}"
