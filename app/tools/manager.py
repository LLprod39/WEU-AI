"""
Tool Manager - Central registry for all agent tools
"""
from typing import List, Dict, Any, Optional
import os
from loguru import logger
from app.tools.base import BaseTool
from app.tools.ssh_tools import SSHConnectTool, SSHExecuteTool, SSHDisconnectTool
from app.tools.server_tools import ServersListTool, ServerExecuteTool
from app.tools.filesystem_tools import (
    ReadFileTool, WriteFileTool, ListDirectoryTool,
    CreateDirectoryTool, DeleteFileTool
)
from app.tools.web_tools import WebSearchTool, FetchWebpageTool
from app.tools.tasks_tools import TasksListTool, TaskDetailTool
from app.mcp.client import MCPClient
from app.mcp.config import load_mcp_config
from django.conf import settings


class ToolManager:
    """
    Manages all available tools for the agent system
    Combines built-in tools and MCP tools
    """
    
    def __init__(self):
        self.tools: Dict[str, BaseTool] = {}
        self.mcp_client = MCPClient()
        self._mcp_tool_names = set()
        self.mcp_config, self.mcp_config_sources = load_mcp_config(settings.BASE_DIR)
        self._register_builtin_tools()
    
    def _register_builtin_tools(self):
        """Register all built-in tools"""
        builtin_tools = [
            # SSH Tools
            SSHConnectTool(),
            SSHExecuteTool(),
            SSHDisconnectTool(),
            # Servers (из вкладки Servers — по имени/id)
            ServersListTool(),
            ServerExecuteTool(),
            # Filesystem Tools
            ReadFileTool(),
            WriteFileTool(),
            ListDirectoryTool(),
            CreateDirectoryTool(),
            DeleteFileTool(),
            
            # Web Tools
            WebSearchTool(),
            FetchWebpageTool(),
            # Tasks Tools
            TasksListTool(),
            TaskDetailTool(),
        ]
        
        for tool in builtin_tools:
            self.register_tool(tool)
    
    def register_tool(self, tool: BaseTool):
        """Register a single tool"""
        name = tool._metadata.name
        self.tools[name] = tool
        logger.info(f"Registered tool: {name} (category: {tool._metadata.category})")
    
    async def connect_mcp_server_stdio(self, name: str, command: List[str]):
        """Connect to MCP server via stdio and register its tools"""
        await self.mcp_client.connect_stdio_server(name, command)
        self._register_mcp_tools(name)
    
    async def connect_mcp_server_sse(self, name: str, url: str):
        """Connect to MCP server via SSE and register its tools"""
        await self.mcp_client.connect_sse_server(name, url)
        self._register_mcp_tools(name)

    def _register_mcp_tools(self, server_name: str):
        for mcp_tool in self.mcp_client.get_tools_for_server(server_name):
            original_name = mcp_tool._metadata.name
            if not original_name.startswith(server_name):
                original_name = f"{server_name}_{original_name}"
                mcp_tool._metadata.name = original_name
            if original_name in self._mcp_tool_names:
                continue
            self._mcp_tool_names.add(original_name)
            self.register_tool(mcp_tool)

    def refresh_mcp_config(self):
        self.mcp_config, self.mcp_config_sources = load_mcp_config(settings.BASE_DIR)
        return self.mcp_config

    def get_mcp_servers(self) -> Dict[str, Any]:
        servers_cfg = (self.mcp_config or {}).get("mcpServers") or {}
        statuses = self.mcp_client.get_server_statuses()
        result = {}
        for name, cfg in servers_cfg.items():
            status = statuses.get(name, {})
            result[name] = {
                "name": name,
                "type": cfg.get("type", "stdio"),
                "status": status.get("status", "disconnected"),
                "error": status.get("error"),
                "description": cfg.get("description", ""),
                "config": cfg,
            }
        return result

    async def connect_mcp_server(self, name: str) -> Dict[str, Any]:
        servers_cfg = (self.mcp_config or {}).get("mcpServers") or {}
        cfg = servers_cfg.get(name)
        if not cfg:
            raise ValueError(f"MCP server '{name}' not found in config")
        if cfg.get("type") == "sse":
            url = cfg.get("url")
            if not url:
                raise ValueError(f"MCP server '{name}' missing url")
            await self.connect_mcp_server_sse(name, url)
        else:
            command_bin = cfg.get("command")
            if not command_bin:
                raise ValueError(f"MCP server '{name}' missing command")
            command = [command_bin] + (cfg.get("args") or [])
            if cfg.get("env"):
                os.environ.update(cfg.get("env"))
            await self.connect_mcp_server_stdio(name, command)
        return self.mcp_client.get_server_statuses().get(name, {})

    async def disconnect_mcp_server(self, name: str) -> bool:
        return await self.mcp_client.disconnect_server(name)

    def get_mcp_tools(self, name: str) -> List[Dict[str, Any]]:
        tools = self.mcp_client.get_tools_for_server(name)
        return [t.to_dict() for t in tools]
    
    def get_tool(self, name: str) -> Optional[BaseTool]:
        """Get a specific tool by name"""
        return self.tools.get(name)
    
    def get_all_tools(self) -> List[BaseTool]:
        """Get all registered tools"""
        return list(self.tools.values())
    
    def get_tools_by_category(self, category: str) -> List[BaseTool]:
        """Get tools filtered by category"""
        return [tool for tool in self.tools.values() if tool._metadata.category == category]
    
    def get_tools_description(self, exclude_tools: Optional[List[str]] = None) -> str:
        """Get formatted description of all tools for the LLM. exclude_tools: skip these (e.g. ssh_connect for delegated tasks)."""
        exclude = set(exclude_tools or [])
        categories = {}

        for tool in self.tools.values():
            if tool._metadata.name in exclude:
                continue
            cat = tool._metadata.category
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(tool)
        
        description = "AVAILABLE TOOLS:\n\n"
        
        for category, tools in sorted(categories.items()):
            description += f"## {category.upper()}\n"
            for tool in tools:
                description += f"- **{tool._metadata.name}**: {tool._metadata.description}\n"
                if tool._metadata.parameters:
                    description += "  Parameters:\n"
                    for param in tool._metadata.parameters:
                        req = "required" if param.required else "optional"
                        description += f"    - {param.name} ({param.type}, {req}): {param.description}\n"
            description += "\n"
        
        return description
    
    async def execute_tool(self, tool_name: str, _context: Optional[Dict[str, Any]] = None, **kwargs) -> Any:
        """Execute a tool by name. _context (user_id, master_password) передаётся инструментам servers_*."""
        tool = self.get_tool(tool_name)
        
        if not tool:
            raise ValueError(f"Unknown tool: {tool_name}")
        
        if _context is not None:
            kwargs["_context"] = _context
        logger.info(f"Executing tool: {tool_name} with args: {list(kwargs.keys())}")
        
        try:
            result = await tool.execute(**kwargs)
            logger.success(f"Tool {tool_name} executed successfully")
            return result
        except Exception as e:
            logger.error(f"Tool execution failed: {e}")
            raise


# Global tool manager instance
_tool_manager = None


def get_tool_manager() -> ToolManager:
    """Get or create global tool manager instance"""
    global _tool_manager
    if _tool_manager is None:
        _tool_manager = ToolManager()
    return _tool_manager
