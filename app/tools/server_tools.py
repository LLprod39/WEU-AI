"""
Инструменты для работы с серверами из вкладки Servers.
Используют серверы текущего пользователя (user_id из _context) и SSH.
"""
from typing import Any, Dict, Optional
from loguru import logger
from app.tools.base import BaseTool, ToolMetadata, ToolParameter
from app.tools.ssh_tools import ssh_manager


def _get_user_id(kwargs: Dict[str, Any]) -> Optional[int]:
    ctx = kwargs.get("_context") or {}
    return ctx.get("user_id")


def _get_master_password(kwargs: Dict[str, Any]) -> Optional[str]:
    ctx = kwargs.get("_context") or {}
    return ctx.get("master_password")


class ServersListTool(BaseTool):
    """Список серверов пользователя из вкладки Servers (по имени можно вызывать server_execute)."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="servers_list",
            description="Список серверов текущего пользователя из раздела Servers. Возвращает id, name, host, port. Используй имя (name) или id в server_execute.",
            category="ssh",
            parameters=[],
        )

    async def execute(self, **kwargs) -> Any:
        user_id = _get_user_id(kwargs)
        if not user_id:
            return "Требуется контекст пользователя (user_id). Используй только в чате WEU AI."
        from servers.models import Server
        qs = Server.objects.filter(user_id=user_id).order_by("name").values("id", "name", "host", "port")
        rows = list(qs)
        if not rows:
            return "Нет настроенных серверов. Добавь серверы в разделе Servers."
        lines = ["id | name | host:port"]
        for r in rows:
            lines.append(f"{r['id']} | {r['name']} | {r['host']}:{r['port']}")
        return "\n".join(lines)


class ServerExecuteTool(BaseTool):
    """Выполнить команду на сервере из раздела Servers по имени или id."""

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="server_execute",
            description="Выполнить команду на сервере из раздела Servers. server_name_or_id — имя (например WEU SERVER) или числовой id. command — команда, например df -h.",
            category="ssh",
            parameters=[
                ToolParameter(name="server_name_or_id", type="string", description="Имя сервера (например WEU SERVER) или его id из servers_list"),
                ToolParameter(name="command", type="string", description="Команда для выполнения (например df -h)"),
            ],
        )

    async def execute(self, **kwargs) -> Any:
        user_id = _get_user_id(kwargs)
        if not user_id:
            return "Требуется контекст пользователя. Используй только в чате WEU AI."
        server_name_or_id = (kwargs.get("server_name_or_id") or "").strip()
        command = (kwargs.get("command") or "").strip()
        if not server_name_or_id or not command:
            return "Нужны server_name_or_id и command."
        from servers.models import Server
        try:
            sid = int(server_name_or_id)
            server = Server.objects.filter(user_id=user_id, id=sid).first()
        except ValueError:
            server = Server.objects.filter(user_id=user_id, name__iexact=server_name_or_id).first()
        if not server:
            return f"Сервер не найден: «{server_name_or_id}». Вызови servers_list, чтобы увидеть доступные серверы."
        password = None
        if server.auth_method in ("password", "key_password"):
            if server.encrypted_password:
                mp = _get_master_password(kwargs)
                if mp:
                    from passwords.encryption import PasswordEncryption
                    password = PasswordEncryption.decrypt_password(
                        server.encrypted_password, mp, bytes(server.salt or b"")
                    )
                else:
                    return "Сервер требует мастер-пароль для расшифровки. Выполни команду через Servers → Execute в интерфейсе или передай master_password в контексте."
            else:
                password = getattr(server, "_plain_password", None)
        key_path = server.key_path if server.auth_method in ("key", "key_password") else None
        try:
            conn_id = await ssh_manager.connect(
                host=server.host,
                username=server.username,
                password=password,
                key_path=key_path or None,
                port=server.port,
            )
            result = await ssh_manager.execute(conn_id, command)
            await ssh_manager.disconnect(conn_id)
            out = (result.get("stdout") or "") + ("\n" + (result.get("stderr") or "") if result.get("stderr") else "")
            if not out:
                out = str(result)
            code = result.get("exit_code", -1)
            return f"Exit code: {code}\n{out}"
        except Exception as e:
            logger.exception("server_execute failed")
            return f"Ошибка выполнения на {server.name}: {e}"
