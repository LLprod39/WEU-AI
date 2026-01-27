"""
Tool Manager - Central registry for all agent tools
"""
from typing import List, Dict, Any, Optional
from loguru import logger
from app.tools.base import BaseTool
from app.tools.ssh_tools import SSHConnectTool, SSHExecuteTool, SSHDisconnectTool
from app.tools.filesystem_tools import (
    ReadFileTool, WriteFileTool, ListDirectoryTool,
    CreateDirectoryTool, DeleteFileTool
)
from app.tools.web_tools import WebSearchTool, FetchWebpageTool
from app.mcp.client import MCPClient


class ToolManager:
    """
    Manages all available tools for the agent system
    Combines built-in tools and MCP tools
    """
    
    def __init__(self):
        self.tools: Dict[str, BaseTool] = {}
        self.mcp_client = MCPClient()
        self._register_builtin_tools()
    
    def _register_builtin_tools(self):
        """Register all built-in tools"""
        builtin_tools = [
            # SSH Tools
            SSHConnectTool(),
            SSHExecuteTool(),
            SSHDisconnectTool(),
            
            # Filesystem Tools
            ReadFileTool(),
            WriteFileTool(),
            ListDirectoryTool(),
            CreateDirectoryTool(),
            DeleteFileTool(),
            
            # Web Tools
            WebSearchTool(),
            FetchWebpageTool(),
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
        
        # Register MCP tools
        for mcp_tool in self.mcp_client.get_all_tools():
            if mcp_tool._metadata.name.startswith(name):
                # Avoid duplicate names
                self.register_tool(mcp_tool)
            else:
                # Add server prefix
                prefixed_name = f"{name}_{mcp_tool._metadata.name}"
                mcp_tool._metadata.name = prefixed_name
                self.register_tool(mcp_tool)
    
    async def connect_mcp_server_sse(self, name: str, url: str):
        """Connect to MCP server via SSE and register its tools"""
        await self.mcp_client.connect_sse_server(name, url)
        
        # Register MCP tools
        for mcp_tool in self.mcp_client.get_all_tools():
            if mcp_tool._metadata.name.startswith(name):
                self.register_tool(mcp_tool)
            else:
                prefixed_name = f"{name}_{mcp_tool._metadata.name}"
                mcp_tool._metadata.name = prefixed_name
                self.register_tool(mcp_tool)
    
    def get_tool(self, name: str) -> Optional[BaseTool]:
        """Get a specific tool by name"""
        return self.tools.get(name)
    
    def get_all_tools(self) -> List[BaseTool]:
        """Get all registered tools"""
        return list(self.tools.values())
    
    def get_tools_by_category(self, category: str) -> List[BaseTool]:
        """Get tools filtered by category"""
        return [tool for tool in self.tools.values() if tool._metadata.category == category]
    
    def get_tools_description(self) -> str:
        """Get formatted description of all tools for the LLM"""
        categories = {}
        
        for tool in self.tools.values():
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
    
    async def execute_tool(self, tool_name: str, **kwargs) -> Any:
        """Execute a tool by name"""
        tool = self.get_tool(tool_name)
        
        if not tool:
            raise ValueError(f"Unknown tool: {tool_name}")
        
        logger.info(f"Executing tool: {tool_name} with args: {kwargs}")
        
        try:
            result = await tool.execute(**kwargs)
            logger.success(f"Tool {tool_name} executed successfully")
            return result
        except Exception as e:
            logger.error(f"Tool execution failed: {e}")
            raise
