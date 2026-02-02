"""
Сбор метрик сервера по SSH: RAM, диск, нагрузка (load average), CPU.
Использует app.tools.ssh_tools (ssh_manager) и логику расшифровки пароля из app.tools.server_tools.
Возвращает единую структуру dict, парсинг без зависимости от локали (LANG=C).
"""
import os
import re
from typing import Any, Dict, List, Optional

from loguru import logger

from app.tools.ssh_tools import ssh_manager


# --- Парсеры вывода команд (locale-independent, LANG=C) ---


def _parse_free_b(stdout: str) -> Dict[str, Any]:
    """Парсит вывод 'LANG=C free -b'. Строка Mem: total used free ..."""
    ram = {"total": 0, "used": 0, "free": 0, "percent_used": 0.0}
    for line in stdout.strip().splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0] == "Mem:":
            try:
                total = int(parts[1])
                used = int(parts[2])
                free = int(parts[3])
                ram["total"] = total
                ram["used"] = used
                ram["free"] = free
                ram["percent_used"] = round(100.0 * used / total, 2) if total else 0.0
            except (ValueError, IndexError):
                pass
            break
    return ram


def _parse_df_b1(stdout: str) -> List[Dict[str, Any]]:
    """Парсит вывод 'LANG=C df -B1'. Строки: Filesystem 1B-blocks Used Available Use% Mounted on."""
    disk: List[Dict[str, Any]] = []
    lines = stdout.strip().splitlines()
    if not lines:
        return disk
    # Пропускаем заголовок (Filesystem 1B-blocks Used Available Use% Mounted on)
    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue
        try:
            # Колонки: 0=Filesystem, 1=1B-blocks, 2=Used, 3=Available, 4=Use%, 5+=Mounted on (path)
            total = int(parts[1])
            used = int(parts[2])
            avail = int(parts[3])
            use_pct_str = parts[4].replace("%", "")
            use_pct = float(use_pct_str)
            path = " ".join(parts[5:]) if len(parts) > 5 else parts[5]
            disk.append({
                "path": path,
                "total": total,
                "used": used,
                "free": avail,
                "percent_used": round(use_pct, 2),
            })
        except (ValueError, IndexError):
            continue
    return disk


def _parse_loadavg(stdout: str) -> Dict[str, float]:
    """Парсит /proc/loadavg: 'load1 load5 load15 ...'"""
    load = {"load1": 0.0, "load5": 0.0, "load15": 0.0}
    line = (stdout.strip().splitlines() or [""])[0]
    parts = line.split()
    if len(parts) >= 3:
        try:
            load["load1"] = round(float(parts[0]), 2)
            load["load5"] = round(float(parts[1]), 2)
            load["load15"] = round(float(parts[2]), 2)
        except ValueError:
            pass
    return load


def _parse_nproc(stdout: str) -> int:
    """Парсит вывод nproc — одно число."""
    try:
        return int(stdout.strip().splitlines()[0].strip())
    except (ValueError, IndexError):
        return 0


def _parse_cpu_usage_top(stdout: str) -> Optional[float]:
    """Парсит 'LANG=C top -bn1' — строка Cpu(s): X.X%us ... или %Cpu(s): ..."""
    for line in stdout.strip().splitlines():
        if "Cpu(s):" in line or "%Cpu(s):" in line:
            # Формат: "Cpu(s):  0.0 us,  0.0 sy,  0.0 ni, 100.0 id, ..." -> id = idle
            # или "%Cpu(s):  0.0 us,  0.0 sy, ..."
            match = re.search(r"(\d+\.?\d*)\s*id", line)
            if match:
                idle = float(match.group(1))
                return round(100.0 - idle, 2)
            # альтернатива: us+sy+ni
            us = re.search(r"(\d+\.?\d*)\s*us", line)
            sy = re.search(r"(\d+\.?\d*)\s*sy", line)
            if us and sy:
                return round(float(us.group(1)) + float(sy.group(1)), 2)
    return None


def _resolve_password(server: Any, master_password: Optional[str]) -> Optional[str]:
    """Получить пароль для Server: расшифровка или _plain_password."""
    mp = master_password or os.environ.get("MASTER_PASSWORD")
    if server.auth_method not in ("password", "key_password"):
        return None
    if server.encrypted_password:
        if not mp:
            return None
        from passwords.encryption import PasswordEncryption
        return PasswordEncryption.decrypt_password(
            server.encrypted_password, mp, bytes(server.salt or b"")
        )
    return getattr(server, "_plain_password", None)


def _server_to_connection_params(
    server: Any,
    master_password: Optional[str] = None,
) -> tuple:
    """
    Извлекает (host, username, password, key_path, port, network_config) из Server
    или из dict с полями host, username, password, key_path, port, network_config.
    """
    if hasattr(server, "host"):
        password = _resolve_password(server, master_password)
        if server.auth_method in ("password", "key_password") and server.encrypted_password and not password:
            return None, None, None, None, None, None, "Требуется master_password для расшифровки пароля сервера."
        key_path = (server.key_path or None) if server.auth_method in ("key", "key_password") else None
        return (
            server.host,
            server.username,
            password,
            key_path,
            getattr(server, "port", 22),
            getattr(server, "network_config", None) or {},
            None,
        )
    if isinstance(server, dict):
        return (
            server.get("host"),
            server.get("username"),
            server.get("password"),
            server.get("key_path"),
            server.get("port", 22),
            server.get("network_config") or {},
            None,
        )
    return None, None, None, None, None, None, "server должен быть объект Server или dict с host, username, ..."


async def collect_metrics(
    server: Any,
    master_password: Optional[str] = None,
    include_cpu_usage: bool = False,
) -> Dict[str, Any]:
    """
    Собирает метрики с сервера по SSH.

    Args:
        server: объект Server (Django model) с полями host, username, port,
                auth_method, encrypted_password, salt, key_path, network_config;
                либо dict с ключами host, username, password (или encrypted_password+salt+master_password),
                key_path, port, network_config.
        master_password: мастер-пароль для расшифровки (или MASTER_PASSWORD в env).
        include_cpu_usage: при True выполнять top -bn1 для процента использования CPU.

    Returns:
        dict:
            - ram: { total, used, free, percent_used } (байты)
            - disk: [ { path, total, used, free, percent_used }, ... ] (байты)
            - load: { load1, load5, load15 }
            - cpu: { cores: int, usage_percent: float | None }
            - error: строка при ошибке (остальные поля могут быть частично заполнены)
    """
    result: Dict[str, Any] = {
        "ram": {"total": 0, "used": 0, "free": 0, "percent_used": 0.0},
        "disk": [],
        "load": {"load1": 0.0, "load5": 0.0, "load15": 0.0},
        "cpu": {"cores": 0, "usage_percent": None},
    }
    host, username, password, key_path, port, network_config, err = _server_to_connection_params(
        server, master_password
    )
    if err:
        result["error"] = err
        return result
    if not host or not username:
        result["error"] = "Не указаны host и username."
        return result

    conn_id = None
    try:
        conn_id = await ssh_manager.connect(
            host=host,
            username=username,
            password=password,
            key_path=key_path,
            port=port,
            network_config=network_config,
        )
    except Exception as e:
        logger.exception("server_metrics: SSH connect failed")
        result["error"] = str(e)
        return result

    env_prefix = "LANG=C "
    try:
        # RAM
        r = await ssh_manager.execute(conn_id, f"{env_prefix}free -b 2>/dev/null")
        if r.get("success") and r.get("stdout"):
            result["ram"] = _parse_free_b(r["stdout"])

        # Disk
        r = await ssh_manager.execute(conn_id, f"{env_prefix}df -B1 2>/dev/null")
        if r.get("success") and r.get("stdout"):
            result["disk"] = _parse_df_b1(r["stdout"])

        # Load average
        r = await ssh_manager.execute(conn_id, "cat /proc/loadavg 2>/dev/null")
        if r.get("success") and r.get("stdout"):
            result["load"] = _parse_loadavg(r["stdout"])

        # CPU cores
        r = await ssh_manager.execute(conn_id, "nproc 2>/dev/null")
        if r.get("success") and r.get("stdout"):
            result["cpu"]["cores"] = _parse_nproc(r["stdout"])

        # CPU usage (опционально)
        if include_cpu_usage:
            r = await ssh_manager.execute(conn_id, f"{env_prefix}top -bn1 2>/dev/null")
            if r.get("success") and r.get("stdout"):
                usage = _parse_cpu_usage_top(r["stdout"])
                if usage is not None:
                    result["cpu"]["usage_percent"] = usage
    finally:
        if conn_id:
            try:
                await ssh_manager.disconnect(conn_id)
            except Exception:
                pass

    return result
