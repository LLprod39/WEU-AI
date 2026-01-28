"""
MCP configuration loader with project and global precedence.
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple


DEFAULT_PROJECT_FILENAMES = ["mcp_config.json", "mcp.json", ".cursor/mcp.json"]
DEFAULT_GLOBAL_FILENAMES = [".cursor/mcp.json", ".config/cursor/mcp.json"]


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _expand_env(value: Any) -> Any:
    if isinstance(value, str):
        return os.path.expandvars(value)
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    return value


def _merge_servers(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for name, cfg in (override or {}).items():
        merged[name] = cfg
    return merged


def _collect_project_configs(base_dir: Path) -> List[Path]:
    found: List[Path] = []
    for root in [base_dir] + list(base_dir.parents):
        for fname in DEFAULT_PROJECT_FILENAMES:
            path = (root / fname)
            if path.exists():
                found.append(path)
    return found


def _collect_global_configs() -> List[Path]:
    home = Path.home()
    found: List[Path] = []
    for fname in DEFAULT_GLOBAL_FILENAMES:
        path = (home / fname)
        if path.exists():
            found.append(path)
    return found


def load_mcp_config(base_dir: Path) -> Tuple[Dict[str, Any], List[str]]:
    """
    Load MCP configuration with precedence:
    global -> project (closest to base_dir wins).
    """
    env_path = os.getenv("MCP_CONFIG_PATH", "").strip()
    if env_path:
        paths = [Path(p) for p in env_path.split(os.pathsep) if p]
        configs = [p for p in paths if p.exists()]
    else:
        configs = _collect_global_configs()
        project_configs = _collect_project_configs(base_dir)
        # Ensure closest project config has highest priority
        configs.extend(reversed(project_configs))

    merged_servers: Dict[str, Any] = {}
    sources: List[str] = []
    for cfg_path in configs:
        cfg = _read_json(cfg_path)
        servers = cfg.get("mcpServers") or {}
        merged_servers = _merge_servers(merged_servers, _expand_env(servers))
        sources.append(str(cfg_path))

    return {"mcpServers": merged_servers}, sources
