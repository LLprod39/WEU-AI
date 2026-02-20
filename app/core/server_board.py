"""
Helpers for server board payloads in chat responses (card-style display like task board).
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _parse_tool_payload(tool_result: Any) -> Optional[Dict[str, Any]]:
    if isinstance(tool_result, dict):
        return tool_result
    if isinstance(tool_result, str):
        try:
            parsed = json.loads(tool_result)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def build_server_board_payload(
    tool_name: str,
    tool_result: Any,
    query: str = "",
) -> Optional[Dict[str, Any]]:
    if tool_name != "servers_list":
        return None

    payload = _parse_tool_payload(tool_result)
    if not payload:
        return None

    raw_servers = payload.get("servers")
    if not isinstance(raw_servers, list):
        return None

    servers: List[Dict[str, Any]] = []
    for s in raw_servers:
        if not isinstance(s, dict):
            continue
        try:
            sid = int(s.get("id"))
        except (TypeError, ValueError):
            continue
        name = str(s.get("name") or f"Server #{sid}")
        host = str(s.get("host") or "")
        port = int(s.get("port") or 22)
        servers.append({
            "id": sid,
            "name": name,
            "host": host,
            "port": port,
            "host_port": f"{host}:{port}",
            "actions": {
                "terminal": f"/servers/{sid}/terminal/",
                "details": f"/servers/",
            },
        })

    return {
        "type": "server_board",
        "schema_version": 1,
        "source_tool": tool_name,
        "query": query,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {"total": len(servers)},
        "servers": servers,
    }
