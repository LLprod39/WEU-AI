"""
Enhanced Model Context Protocol (MCP) Client
Provides real MCP server integration and tool discovery
"""
import asyncio
import httpx
import json
from loguru import logger
from typing import List, Dict, Any, Optional
from app.tools.base import BaseTool, ToolMetadata, ToolParameter


class MCPTool(BaseTool):
    """Wrapper for MCP server tools"""
    
    def __init__(self, tool_data: Dict[str, Any], server_name: str, client: 'MCPClient'):
        self.tool_data = tool_data
        self.server_name = server_name
        self.client = client
        super().__init__()
    
    def get_metadata(self) -> ToolMetadata:
        # Convert MCP tool format to our ToolMetadata
        params = []
        if 'inputSchema' in self.tool_data:
            schema = self.tool_data['inputSchema']
            if 'properties' in schema:
                required_fields = schema.get('required', [])
                for param_name, param_info in schema['properties'].items():
                    params.append(ToolParameter(
                        name=param_name,
                        type=param_info.get('type', 'string'),
                        description=param_info.get('description', ''),
                        required=param_name in required_fields
                    ))
        
        return ToolMetadata(
            name=self.tool_data['name'],
            description=self.tool_data.get('description', ''),
            category='mcp',
            parameters=params
        )
    
    async def execute(self, **kwargs) -> Any:
        """Execute MCP tool"""
        return await self.client.call_tool(self.server_name, self.tool_data['name'], kwargs)


class MCPClient:
    """
    Model Context Protocol Client
    Connects to MCP servers and exposes their tools
    """
    
    def __init__(self):
        self.servers: Dict[str, Dict] = {}
        self.tools: List[MCPTool] = []
        self.tools_by_server: Dict[str, List[MCPTool]] = {}
    
    async def connect_stdio_server(self, name: str, command: List[str]):
        """
        Connect to an MCP server via stdio
        This is for servers that run as subprocesses
        """
        logger.info(f"Connecting to MCP server '{name}' via stdio: {' '.join(command)}")
        
        try:
            # Start subprocess
            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            self.servers[name] = {
                "type": "stdio",
                "process": process,
                "status": "connected",
                "error": None,
            }
            
            # Reset tools for this server before discovery
            self.tools_by_server[name] = []
            self.tools = [t for t in self.tools if t.server_name != name]
            # Discover tools
            await self._discover_tools_stdio(name)
            
            logger.success(f"Connected to MCP server: {name}")
            
        except Exception as e:
            logger.error(f"Failed to connect to MCP server {name}: {e}")
            self.servers[name] = {"type": "stdio", "status": "error", "error": str(e)}
    
    async def connect_sse_server(self, name: str, url: str):
        """
        Connect to an MCP server via Server-Sent Events (SSE)
        This is for HTTP-based MCP servers
        """
        logger.info(f"Connecting to MCP server '{name}' at {url}")
        
        try:
            # Test connection
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{url}/health", timeout=5.0)
                
                if response.status_code == 200:
                    self.servers[name] = {
                        "type": "sse",
                        "url": url,
                        "status": "connected",
                        "error": None,
                    }
                    
                    # Reset tools for this server before discovery
                    self.tools_by_server[name] = []
                    self.tools = [t for t in self.tools if t.server_name != name]
                    # Discover tools
                    await self._discover_tools_sse(name, url)
                    
                    logger.success(f"Connected to MCP server: {name}")
                else:
                    raise Exception(f"Server returned status {response.status_code}")
                    
        except Exception as e:
            logger.error(f"Failed to connect to MCP server {name}: {e}")
            self.servers[name] = {"type": "sse", "url": url, "status": "error", "error": str(e)}
    
    async def _discover_tools_stdio(self, server_name: str):
        """Discover tools from stdio MCP server"""
        try:
            server = self.servers[server_name]
            process = server['process']
            
            # Send tools/list request (MCP protocol)
            request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list"
            }
            
            process.stdin.write((json.dumps(request) + '\n').encode())
            await process.stdin.drain()
            
            # Read response
            response_line = await process.stdout.readline()
            response = json.loads(response_line.decode())
            
            if 'result' in response and 'tools' in response['result']:
                for tool_data in response['result']['tools']:
                    mcp_tool = MCPTool(tool_data, server_name, self)
                    self.tools.append(mcp_tool)
                    self.tools_by_server.setdefault(server_name, []).append(mcp_tool)
                    logger.info(f"Discovered MCP tool: {tool_data['name']}")
                    
        except Exception as e:
            logger.error(f"Tool discovery failed for {server_name}: {e}")
    
    async def _discover_tools_sse(self, server_name: str, url: str):
        """Discover tools from SSE MCP server"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{url}/rpc",
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/list"
                    },
                    timeout=10.0
                )
                
                result = response.json()
                
                if 'result' in result and 'tools' in result['result']:
                    for tool_data in result['result']['tools']:
                        mcp_tool = MCPTool(tool_data, server_name, self)
                        self.tools.append(mcp_tool)
                        self.tools_by_server.setdefault(server_name, []).append(mcp_tool)
                        logger.info(f"Discovered MCP tool: {tool_data['name']}")
                        
        except Exception as e:
            logger.error(f"Tool discovery failed for {server_name}: {e}")
    
    async def call_tool(self, server_name: str, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """Call a tool on an MCP server"""
        logger.info(f"Calling MCP tool {tool_name} on {server_name}")
        
        if server_name not in self.servers:
            raise ValueError(f"Not connected to server: {server_name}")
        
        server = self.servers[server_name]
        
        try:
            if server['type'] == 'stdio':
                return await self._call_tool_stdio(server, tool_name, arguments)
            elif server['type'] == 'sse':
                return await self._call_tool_sse(server, tool_name, arguments)
        except Exception as e:
            logger.error(f"Tool call failed: {e}")
            return {"error": str(e)}
    
    async def _call_tool_stdio(self, server: Dict, tool_name: str, arguments: Dict) -> Any:
        """Call tool via stdio"""
        process = server['process']
        
        request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        }
        
        process.stdin.write((json.dumps(request) + '\n').encode())
        await process.stdin.drain()
        
        response_line = await process.stdout.readline()
        response = json.loads(response_line.decode())
        
        if 'result' in response:
            return response['result']
        elif 'error' in response:
            raise Exception(response['error']['message'])
        else:
            raise Exception("Unknown response format")
    
    async def _call_tool_sse(self, server: Dict, tool_name: str, arguments: Dict) -> Any:
        """Call tool via SSE"""
        url = server['url']
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{url}/rpc",
                json={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments
                    }
                },
                timeout=30.0
            )
            
            result = response.json()
            
            if 'result' in result:
                return result['result']
            elif 'error' in result:
                raise Exception(result['error']['message'])
            else:
                raise Exception("Unknown response format")
    
    def get_all_tools(self) -> List[MCPTool]:
        """Get all discovered MCP tools"""
        return self.tools

    def get_tools_for_server(self, server_name: str) -> List[MCPTool]:
        """Get tools for a specific server"""
        return self.tools_by_server.get(server_name, [])

    def get_server_statuses(self) -> Dict[str, Dict[str, Any]]:
        """Get statuses for all servers"""
        return self.servers

    async def disconnect_server(self, server_name: str) -> bool:
        """Disconnect an MCP server"""
        server = self.servers.get(server_name)
        if not server:
            return False
        try:
            if server.get("type") == "stdio" and server.get("process"):
                server["process"].terminate()
                await server["process"].wait()
            server["status"] = "disconnected"
            return True
        except Exception as e:
            logger.error(f"Failed to disconnect MCP server {server_name}: {e}")
            server["status"] = "error"
            server["error"] = str(e)
            return False
    
    def get_tools_dict(self) -> List[Dict]:
        """Get tools as dictionaries"""
        return [tool.to_dict() for tool in self.tools]
