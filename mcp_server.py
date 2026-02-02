#!/usr/bin/env python3
"""
Standalone MCP server for WEU AI Platform.
Usage: WEU_USER_ID=<id> python mcp_server.py
"""
import asyncio
import json
import os
import sys

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')

# Delayed Django import to speed up startup
_django_ready = False


def _ensure_django():
    global _django_ready
    if not _django_ready:
        import django
        django.setup()
        _django_ready = True


def _get_user_id():
    uid = os.environ.get("WEU_USER_ID", "")
    try:
        return int(uid) if uid else None
    except ValueError:
        return None


MCP_TOOLS = [
    {
        "name": "servers_list",
        "description": "List servers for the current user from Servers section (id, name, host). Use name in server_execute.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "server_execute",
        "description": "Execute command on a server from Servers section. server_name_or_id - name (e.g. WEU SERVER) or id. command - command to run (e.g. df -h).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "server_name_or_id": {"type": "string", "description": "Server name (WEU SERVER) or id from servers_list"},
                "command": {"type": "string", "description": "Command to execute (e.g. df -h)"},
            },
            "required": ["server_name_or_id", "command"],
        },
    },
]


def handle_initialize(req_id, params):
    """Handle MCP initialize handshake."""
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {
            "protocolVersion": params.get("protocolVersion", "2024-11-05"),
            "serverInfo": {
                "name": "weu-servers",
                "version": "1.0.0",
            },
            "capabilities": {
                "tools": {},
            },
        },
    }


def handle_tools_list(req_id):
    return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": MCP_TOOLS}}


async def run_tool(name: str, arguments: dict, user_id: int):
    _ensure_django()
    from app.tools.server_tools import ServersListTool, ServerExecuteTool
    ctx = {"user_id": user_id}
    if name == "servers_list":
        t = ServersListTool()
        out = await t.execute(_context=ctx)
        return out if isinstance(out, str) else json.dumps(out)
    if name == "server_execute":
        t = ServerExecuteTool()
        out = await t.execute(_context=ctx, **arguments)
        return out if isinstance(out, str) else json.dumps(out)
    raise ValueError(f"Unknown tool: {name}")


def handle_tools_call(req_id, params, user_id):
    if not user_id:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "WEU_USER_ID not set. Run with WEU_USER_ID=<id>."},
        }
    name = (params or {}).get("name")
    arguments = (params or {}).get("arguments") or {}
    if not name:
        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32602, "message": "Missing 'name' in params."}}
    try:
        result = asyncio.run(run_tool(name, arguments, user_id))
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as e:
        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32603, "message": str(e)}}


def main():
    user_id = _get_user_id()
    # Message to stderr (doesn't break MCP stdio: responses go only to stdout)
    print(f"MCP server started, WEU_USER_ID={user_id}", file=sys.stderr, flush=True)

    # Use readline() for unbuffered line-by-line processing
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}) + "\n")
            sys.stdout.flush()
            continue

        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params")

        if method == "initialize":
            out = handle_initialize(req_id, params or {})
        elif method == "notifications/initialized":
            # Client notification after initialize - no response needed
            continue
        elif method == "tools/list":
            out = handle_tools_list(req_id)
        elif method == "tools/call":
            out = handle_tools_call(req_id, params, user_id)
        else:
            out = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}

        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
