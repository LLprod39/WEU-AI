"""
MCP‑сервер по stdio: инструменты servers_list и server_execute.
Запуск: WEU_USER_ID=<id> python manage.py mcp_servers
Подключение из оркестратора или Cursor: stdio, command ["python", "manage.py", "mcp_servers"], env WEU_USER_ID=...
"""
import asyncio
import json
import os
import sys


def _get_user_id():
    uid = os.environ.get("WEU_USER_ID", "")
    try:
        return int(uid) if uid else None
    except ValueError:
        return None


MCP_TOOLS = [
    {
        "name": "servers_list",
        "description": "Список серверов текущего пользователя из раздела Servers (id, name, host). Используй имя в server_execute.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "server_execute",
        "description": "Выполнить команду на сервере из раздела Servers. server_name_or_id — имя (например WEU SERVER) или id. command — команда (например df -h).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "server_name_or_id": {"type": "string", "description": "Имя сервера (WEU SERVER) или id из servers_list"},
                "command": {"type": "string", "description": "Команда для выполнения (например df -h)"},
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
    # Сообщение в stderr (не ломает MCP stdio: ответы идут только в stdout)
    print("MCP server (mcp_servers) started, WEU_USER_ID=%s, waiting for requests..." % (user_id,), file=sys.stderr, flush=True)
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


from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "MCP stdio server: servers_list, server_execute. Set WEU_USER_ID."

    def handle(self, *args, **options):
        main()

