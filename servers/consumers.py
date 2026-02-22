"""
WebSocket consumers for interactive SSH terminal sessions.
"""

from __future__ import annotations

import asyncio
import json
import re
import shlex
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import asyncssh
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from loguru import logger

from app.tools.safety import is_dangerous_command
from core_ui.context_processors import user_can_feature
from passwords.encryption import PasswordEncryption
from servers.models import Server


@dataclass(frozen=True)
class _TermSize:
    cols: int
    rows: int


_WEUAI_MARKER_PREFIX = "__WEUAI_EXIT_"

# Regex to detect commands that produce infinite/continuous output or need user input
_STREAMING_CMD_RE = re.compile(
    r"(?:"
    r"\btail\s+.*-[a-zA-Z]*[fF]\b"                              # tail -f / -F / -fq
    r"|\btail\s+--follow\b"
    r"|\bjournalctl\s+.*(?:-[a-zA-Z]*[fF]\b|--follow\b)"        # journalctl -f/-fu/--follow
    r"|\bdocker\s+logs?\s+.*(?:-[a-zA-Z]*[fF]\b|--follow\b)"   # docker logs -f/--follow
    r"|\bkubectl\s+logs?\s+.*-[a-zA-Z]*[fF]\b"                  # kubectl logs -f
    r"|\bpodman\s+logs?\s+.*(?:-[a-zA-Z]*[fF]\b|--follow\b)"
    r"|\bwatch\s+"                                               # watch anything
    r"|\btcpdump\b"
    r"|\bstrace\b"
    r"|\bping\s+(?!.*-c\s*\d)"                                   # ping without -c count
    r")",
    re.IGNORECASE,
)
_INTERACTIVE_CMDS = {"top", "htop", "iotop", "iftop", "nethogs", "vim", "vi", "nano", "less", "more", "man", "pstree", "glances"}

# Regex to detect long-running install/build commands that should be monitored
_INSTALL_CMD_RE = re.compile(
    r"(?:"
    r"\bapt(?:-get)?\s+(?:install|upgrade|dist-upgrade)\b"
    r"|\byum\s+(?:install|update)\b"
    r"|\bdnf\s+(?:install|upgrade)\b"
    r"|\bpip[23]?\s+install\b"
    r"|\bnpm\s+(?:install|ci|i\b)"
    r"|\byarn\s+(?:install|add)\b"
    r"|\bdocker\s+(?:pull|build)\b"
    r"|\bcomposer\s+(?:install|update)\b"
    r"|\bcargo\s+(?:install|build)\b"
    r"|\bgo\s+(?:get|install|build)\b"
    r"|\bmake\s+(?:install|all|build)\b"
    r")",
    re.IGNORECASE,
)

# Patterns that clearly indicate a failed install
_INSTALL_ERROR_RE = re.compile(
    r"(?:"
    r"E: Unable to locate package"
    r"|No such package|could not find package"
    r"|npm ERR!"
    r"|ERROR: Could not install"
    r"|error: could not"
    r"|Failed to fetch"
    r"|dpkg: error"
    r")",
    re.IGNORECASE,
)


class SSHTerminalConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket protocol (JSON):
      - server -> client:
          {type: "ready", server_id, server_name, auth_method, has_encrypted_secret}
          {type: "status", status: "connecting"|"connected"|"disconnected"}
          {type: "output", stream: "stdout"|"stderr", data: "<chunk>"}
          {type: "error", message: "<text>"}
          {type: "exit", exit_status: int|null, exit_signal: any|null}
          {type: "ai_status", status: "thinking"|"running"|"waiting_confirm"|"idle", ...}
          {type: "ai_response", assistant_text: str, commands: [{id, cmd, why, requires_confirm, reason}]}
          {type: "ai_command_status", id: int, status: "running"|"done"|"skipped", exit_code?, reason?}
          {type: "ai_report", report: str, status: "ok"|"warning"|"error"}
          {type: "ai_error", message: "<text>"}
          {type: "ai_recovery", original_cmd, new_cmd, new_id, why}
          {type: "ai_question", q_id, question, cmd, exit_code}
          {type: "ai_install_progress", cmd, elapsed, output_tail}
      - client -> server:
          {type: "connect", master_password?, password?, cols?, rows?, term_type?}
          {type: "input", data: "<keystrokes>"}
          {type: "resize", cols, rows}
          {type: "disconnect"}
          {type: "ai_request", message: "<text>"}
          {type: "ai_confirm", id: <int>}
          {type: "ai_cancel", id: <int>}
          {type: "ai_reply", q_id: str, text: str}
    """

    server: Optional[Server] = None
    _user_id: Optional[int] = None

    _ssh_conn: Optional[asyncssh.SSHClientConnection] = None
    _ssh_proc: Optional[asyncssh.SSHClientProcess[str]] = None
    _stdout_task: Optional[asyncio.Task[None]] = None
    _stderr_task: Optional[asyncio.Task[None]] = None
    _wait_task: Optional[asyncio.Task[None]] = None
    _connect_lock: asyncio.Lock

    _ai_lock: asyncio.Lock
    _ai_task: Optional[asyncio.Task[None]] = None
    _ai_plan: list[dict[str, Any]]
    _ai_plan_index: int
    _ai_next_id: int
    _ai_forbidden_patterns: list[str]
    _ai_exit_futures: dict[int, asyncio.Future[int]]
    _ai_active_cmd_id: Optional[int]
    _ai_active_output: str
    _ai_user_message: str

    _terminal_tail: str
    _ai_history: list[dict]
    _unavailable_cmds: set[str]    # commands that returned exit=127 this session
    _ai_reply_futures: dict[str, "asyncio.Future[str]"]  # q_id → future waiting for user reply
    _ai_error_retries: dict[int, int]   # cmd_id → retry count (max 2)
    _ai_run_id: str
    _ai_marker_token: str
    _ai_stop_requested: bool

    _marker_suppress: dict[str, bool]
    _marker_line_buf: dict[str, str]

    async def connect(self):
        self._connect_lock = asyncio.Lock()

        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            await self.close(code=4401)
            return

        self._user_id = int(user.id)
        self._ai_lock = asyncio.Lock()
        self._ai_task = None
        self._ai_plan = []
        self._ai_plan_index = 0
        self._ai_next_id = 1
        self._ai_forbidden_patterns = []
        self._ai_exit_futures = {}
        self._ai_active_cmd_id = None
        self._ai_active_output = ""
        self._ai_user_message = ""
        self._terminal_tail = ""
        self._ai_history = []
        self._unavailable_cmds: set[str] = set()
        self._ai_reply_futures: dict[str, asyncio.Future] = {}
        self._ai_error_retries: dict[int, int] = {}
        self._ai_run_id = ""
        self._ai_marker_token = ""
        self._ai_stop_requested = False
        self._marker_suppress = {"stdout": False, "stderr": False}
        self._marker_line_buf = {"stdout": "", "stderr": ""}

        can_servers = await self._user_can_servers(user.id)
        if not can_servers:
            await self.close(code=4403)
            return

        server_id = self.scope.get("url_route", {}).get("kwargs", {}).get("server_id")
        if not server_id:
            await self.close(code=4400)
            return

        try:
            self.server = await self._get_server(user.id, int(server_id))
        except Server.DoesNotExist:
            await self.close(code=4404)
            return

        await self.accept()
        await self.send_json(
            {
                "type": "ready",
                "server_id": self.server.id,
                "server_name": self.server.name,
                "auth_method": self.server.auth_method,
                "has_encrypted_secret": bool(self.server.encrypted_password),
            }
        )

    async def disconnect(self, code):
        await self._cancel_ai()
        await self._disconnect_ssh()

    async def receive_json(self, content: Any, **kwargs):
        msg_type = (content or {}).get("type")
        if msg_type == "connect":
            await self._handle_connect(content or {})
            return
        if msg_type == "input":
            await self._handle_input((content or {}).get("data", ""))
            return
        if msg_type == "resize":
            await self._handle_resize(content or {})
            return
        if msg_type == "disconnect":
            await self._disconnect_ssh()
            return
        if msg_type == "ai_request":
            await self._handle_ai_request((content or {}).get("message", ""))
            return
        if msg_type == "ai_confirm":
            await self._handle_ai_confirm(content or {})
            return
        if msg_type == "ai_cancel":
            await self._handle_ai_cancel(content or {})
            return
        if msg_type == "ai_stop":
            await self._handle_ai_stop()
            return
        if msg_type == "ai_reply":
            # User replied to an ai_question card
            q_id = str((content or {}).get("q_id") or "")
            text = str((content or {}).get("text") or "").strip()
            fut = self._ai_reply_futures.get(q_id)
            if fut and not fut.done():
                fut.set_result(text)
            return
        if msg_type == "ping":
            await self.send_json({"type": "pong"})
            return

        await self.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})

    @staticmethod
    def _new_run_id() -> str:
        return f"run_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def _new_marker_token() -> str:
        return uuid.uuid4().hex[:10]

    def _marker_prefix(self) -> str:
        token = (self._ai_marker_token or "").strip()
        if token:
            return f"{_WEUAI_MARKER_PREFIX}{token}_"
        return _WEUAI_MARKER_PREFIX

    def _with_ai_run_id(self, payload: dict[str, Any]) -> dict[str, Any]:
        msg_type = str((payload or {}).get("type") or "")
        if msg_type.startswith("ai_") and self._ai_run_id:
            out = dict(payload)
            out.setdefault("run_id", self._ai_run_id)
            return out
        return payload

    async def _send_ai_event(self, payload: dict[str, Any]) -> None:
        await self.send_json(self._with_ai_run_id(payload))

    async def _handle_connect(self, content: dict[str, Any]):
        if not self.server:
            await self.send_json({"type": "error", "message": "Server not loaded"})
            return

        async with self._connect_lock:
            if self._ssh_conn and self._ssh_proc:
                # Already connected
                return

            await self.send_json({"type": "status", "status": "connecting"})

            master_password = (content.get("master_password") or "").strip()
            # Auto-connect: if master_password not provided, try to get from session
            if not master_password:
                master_password = await self._get_session_master_password()
            plain_password = (content.get("password") or "").strip()
            term_type = (content.get("term_type") or "xterm-256color").strip() or "xterm-256color"
            term_size = self._parse_term_size(content)

            try:
                secret = await self._resolve_server_secret(
                    server_id=self.server.id,
                    master_password=master_password,
                    plain_password=plain_password,
                )
            except Exception as e:
                await self.send_json({"type": "error", "message": f"Ошибка секретов SSH: {e}"})
                await self.send_json({"type": "status", "status": "disconnected"})
                return

            try:
                connect_kwargs: dict[str, Any] = {
                    "host": self.server.host,
                    "port": int(self.server.port or 22),
                    "username": self.server.username,
                    "known_hosts": None,  # WARNING: skip host key verification
                    "connect_timeout": 10,
                    "login_timeout": 20,
                    "keepalive_interval": 20,
                    "keepalive_count_max": 3,
                }

                # Bastion host via AsyncSSH tunnel option
                network_config = self.server.network_config or {}
                bastion = (
                    (network_config.get("network") or {}).get("bastion_host")
                    if isinstance(network_config, dict)
                    else None
                )
                if bastion:
                    connect_kwargs["tunnel"] = str(bastion).strip()

                if self.server.auth_method == "password":
                    if not secret:
                        raise ValueError(
                            "Для входа по паролю укажите в панели учётных данных терминала: "
                            "мастер-пароль (если пароль сервера сохранён зашифрованным) или пароль сервера, затем нажмите Connect."
                        )
                    connect_kwargs["password"] = secret
                elif self.server.auth_method == "key":
                    if not (self.server.key_path or "").strip():
                        raise ValueError("Не указан путь к SSH ключу (key auth)")
                    connect_kwargs["client_keys"] = [self.server.key_path]
                elif self.server.auth_method == "key_password":
                    if not (self.server.key_path or "").strip():
                        raise ValueError("Не указан путь к SSH ключу (key+password auth)")
                    if not secret:
                        raise ValueError(
                            "Для ключа с пасфразой укажите в панели учётных данных: "
                            "мастер-пароль или пасфразу ключа, затем нажмите Connect."
                        )
                    connect_kwargs["client_keys"] = [self.server.key_path]
                    # For encrypted private keys, AsyncSSH expects passphrase
                    connect_kwargs["passphrase"] = secret
                else:
                    raise ValueError(f"Неизвестный auth_method: {self.server.auth_method}")

                self._ssh_conn = await asyncssh.connect(**connect_kwargs)
                self._ssh_proc = await self._ssh_conn.create_process(
                    term_type=term_type,
                    # AsyncSSH TermSize = (cols, rows, pixwidth, pixheight)
                    term_size=(term_size.cols, term_size.rows, 0, 0),
                    encoding="utf-8",
                    errors="replace",
                )

                # Apply environment variables (if any) into the interactive session
                if isinstance(network_config, dict) and network_config.get("environment"):
                    exports = self._build_exports(network_config.get("environment") or {})
                    if exports:
                        self._ssh_proc.stdin.write(exports + "\n")

                await self.send_json({"type": "status", "status": "connected"})

                self._stdout_task = asyncio.create_task(self._stream_reader(self._ssh_proc.stdout, "stdout"))
                self._stderr_task = asyncio.create_task(self._stream_reader(self._ssh_proc.stderr, "stderr"))
                self._wait_task = asyncio.create_task(self._wait_for_process_exit())

            except Exception as e:
                logger.exception("SSH terminal connect failed")
                await self.send_json({"type": "error", "message": f"SSH connect failed: {e}"})
                await self.send_json({"type": "status", "status": "disconnected"})
                await self._disconnect_ssh()

    async def _handle_input(self, data: str):
        if not data:
            return
        if not self._ssh_proc:
            return
        try:
            self._ssh_proc.stdin.write(data)
        except Exception as e:
            await self.send_json({"type": "error", "message": f"stdin write failed: {e}"})

    async def _handle_resize(self, content: dict[str, Any]):
        if not self._ssh_proc:
            return
        try:
            term_size = self._parse_term_size(content)
            if term_size.cols > 0 and term_size.rows > 0:
                self._ssh_proc.change_terminal_size(term_size.cols, term_size.rows)
        except Exception as e:
            await self.send_json({"type": "error", "message": f"resize failed: {e}"})

    async def _interrupt_active_command(self) -> Optional[int]:
        """
        Try to interrupt active command with Ctrl+C and unblock waiter with exit=130.
        Returns active cmd_id if interrupted.
        """
        async with self._ai_lock:
            cmd_id = self._ai_active_cmd_id
            fut = (self._ai_exit_futures or {}).get(cmd_id) if cmd_id is not None else None

        if cmd_id is None:
            return None

        try:
            if self._ssh_proc:
                self._ssh_proc.stdin.write("\x03")
        except Exception:
            pass

        async with self._ai_lock:
            if fut and not fut.done():
                try:
                    fut.set_result(130)
                except Exception:
                    pass
        return cmd_id

    async def _handle_ai_stop(self):
        active_cmd_id = await self._interrupt_active_command()

        pending_to_skip: list[int] = []
        async with self._ai_lock:
            self._ai_stop_requested = True
            for item in self._ai_plan[self._ai_plan_index :]:
                iid = int(item.get("id") or 0)
                status = str(item.get("status") or "pending")
                if iid and iid != active_cmd_id and status not in ("done", "skipped", "cancelled"):
                    pending_to_skip.append(iid)

        if active_cmd_id is not None:
            await self._send_ai_event(
                {
                    "type": "ai_command_status",
                    "id": active_cmd_id,
                    "status": "cancelled",
                    "reason": "stopped",
                }
            )
        for cmd_id in pending_to_skip:
            await self._send_ai_event(
                {
                    "type": "ai_command_status",
                    "id": cmd_id,
                    "status": "skipped",
                    "reason": "stopped",
                }
            )

        await self._cancel_ai()
        await self._send_ai_event({"type": "ai_status", "status": "idle"})

    async def _cancel_ai(self):
        # Can be called from disconnect/cleanup paths
        if not hasattr(self, "_ai_lock"):
            return
        async with self._ai_lock:
            await self._cancel_ai_locked()

    async def _cancel_ai_locked(self):
        current = asyncio.current_task()
        if self._ai_task and not self._ai_task.done():
            if current is None or self._ai_task is not current:
                self._ai_task.cancel()
        self._ai_task = None

        for fut in (self._ai_exit_futures or {}).values():
            if not fut.done():
                fut.cancel()
        self._ai_exit_futures = {}

        for fut in (getattr(self, "_ai_reply_futures", None) or {}).values():
            if not fut.done():
                fut.cancel()
        if hasattr(self, "_ai_reply_futures"):
            self._ai_reply_futures = {}

        self._ai_plan = []
        self._ai_plan_index = 0
        self._ai_forbidden_patterns = []
        self._ai_active_cmd_id = None
        self._ai_active_output = ""
        self._ai_stop_requested = False

    async def _handle_ai_request(self, message: str):
        msg = (message or "").strip()
        if not msg:
            return

        async with self._ai_lock:
            await self._cancel_ai_locked()
            self._ai_run_id = self._new_run_id()
            self._ai_marker_token = self._new_marker_token()
            self._ai_plan = []
            self._ai_plan_index = 0
            self._ai_next_id = 1
            self._ai_user_message = msg

        if not self._ssh_proc:
            await self._send_ai_event({"type": "ai_error", "message": "SSH не подключён. Сначала нажмите Connect."})
            return
        if not self.server or not self._user_id:
            await self._send_ai_event({"type": "ai_error", "message": "Server not loaded"})
            return

        # Save user message to history
        self._add_to_history("user", msg)
        await self._send_ai_event({"type": "ai_status", "status": "thinking"})

        try:
            forbidden_patterns, rules_context = await self._get_ai_rules_and_forbidden(self._user_id, self.server.id)
            plan_obj = await self._ai_plan_commands(
                user_message=msg,
                rules_context=rules_context,
                terminal_tail=(self._terminal_tail or "")[-2000:],
                history=list(self._ai_history),
                unavailable_cmds=set(getattr(self, "_unavailable_cmds", set())),
            )
        except Exception as e:
            await self._send_ai_event({"type": "ai_error", "message": str(e)})
            await self._send_ai_event({"type": "ai_status", "status": "idle"})
            return

        mode = str(plan_obj.get("mode") or "execute").lower().strip()
        assistant_text = str(plan_obj.get("assistant_text") or "").strip()
        commands_raw = plan_obj.get("commands") or []

        # --- answer / ask mode: just reply, no commands needed ---
        if mode in ("answer", "ask"):
            self._add_to_history("assistant", assistant_text or "(ответ)")
            await self._send_ai_event({
                "type": "ai_response",
                "mode": mode,
                "assistant_text": assistant_text,
                "commands": [],
            })
            await self._send_ai_event({"type": "ai_status", "status": "idle"})
            return

        # --- execute mode ---
        commands: list[dict[str, str]] = []
        if isinstance(commands_raw, list):
            for it in commands_raw:
                if not isinstance(it, dict):
                    continue
                cmd = str(it.get("cmd") or "").strip()
                if not cmd:
                    continue
                why = str(it.get("why") or "").strip()
                commands.append({"cmd": cmd, "why": why})
        commands = commands[:10]

        plan_items: list[dict[str, Any]] = []
        next_id = 1
        for c in commands:
            cmd = c["cmd"]
            why = c.get("why") or ""
            item_id = next_id
            next_id += 1
            plan_items.append(self._build_plan_item(item_id=item_id, cmd=cmd, why=why, forbidden_patterns=forbidden_patterns))

        async with self._ai_lock:
            self._ai_plan = plan_items
            self._ai_plan_index = 0
            self._ai_next_id = next_id
            self._ai_forbidden_patterns = forbidden_patterns or []

        await self._send_ai_event({
            "type": "ai_response",
            "mode": "execute",
            "assistant_text": assistant_text,
            "commands": plan_items,
        })

        if not plan_items:
            self._add_to_history("assistant", assistant_text or "Команды не нужны")
            await self._send_ai_event({"type": "ai_status", "status": "idle"})
            return

        await self._send_ai_event({"type": "ai_status", "status": "running"})
        async with self._ai_lock:
            self._ai_task = asyncio.create_task(self._ai_process_queue())

    async def _handle_ai_confirm(self, content: dict[str, Any]):
        try:
            cmd_id = int(content.get("id"))
        except Exception:
            await self._send_ai_event({"type": "ai_error", "message": "Некорректный id для подтверждения"})
            return

        should_start = False
        async with self._ai_lock:
            if not self._ai_plan or self._ai_plan_index >= len(self._ai_plan):
                return
            item = self._ai_plan[self._ai_plan_index]
            if int(item.get("id") or 0) != cmd_id:
                await self._send_ai_event({"type": "ai_error", "message": "Подтверждать можно только текущую ожидающую команду"})
                return
            if not item.get("requires_confirm"):
                return
            item["requires_confirm"] = False
            item["confirmed"] = True
            item["status"] = "pending"
            if not self._ai_task or self._ai_task.done():
                should_start = True

        await self._send_ai_event({"type": "ai_command_status", "id": cmd_id, "status": "confirmed"})
        if should_start:
            await self._send_ai_event({"type": "ai_status", "status": "running"})
            async with self._ai_lock:
                self._ai_task = asyncio.create_task(self._ai_process_queue())

    async def _handle_ai_cancel(self, content: dict[str, Any]):
        try:
            cmd_id = int(content.get("id"))
        except Exception:
            await self._send_ai_event({"type": "ai_error", "message": "Некорректный id для отмены"})
            return

        should_start = False
        async with self._ai_lock:
            if not self._ai_plan or self._ai_plan_index >= len(self._ai_plan):
                return
            item = self._ai_plan[self._ai_plan_index]
            if int(item.get("id") or 0) != cmd_id:
                await self._send_ai_event({"type": "ai_error", "message": "Отменять можно только текущую ожидающую команду"})
                return
            item["status"] = "skipped"
            self._ai_plan_index += 1
            if not self._ai_task or self._ai_task.done():
                should_start = True

        await self._send_ai_event({"type": "ai_command_status", "id": cmd_id, "status": "skipped"})
        if should_start:
            await self._send_ai_event({"type": "ai_status", "status": "running"})
            async with self._ai_lock:
                self._ai_task = asyncio.create_task(self._ai_process_queue())

    def _add_to_history(self, role: str, text: str) -> None:
        """Append a message to the conversation history (max 20 entries)."""
        entry = {"role": role, "text": (text or "")[:800]}
        if not hasattr(self, "_ai_history"):
            self._ai_history = []
        self._ai_history.append(entry)
        if len(self._ai_history) > 20:
            self._ai_history = self._ai_history[-20:]

    def _build_plan_item(
        self,
        item_id: int,
        cmd: str,
        why: str,
        forbidden_patterns: list[str] | None = None,
    ) -> dict[str, Any]:
        clean_cmd = str(cmd or "").strip()
        reason = self._compute_confirm_reason(clean_cmd, forbidden_patterns or [])
        return {
            "id": int(item_id),
            "cmd": clean_cmd,
            "why": str(why or "").strip(),
            "requires_confirm": bool(reason),
            "reason": reason,
            "status": "pending",
            "streaming": self._is_streaming_command(clean_cmd),
        }

    @staticmethod
    def _normalize_command_text(cmd: str) -> str:
        clean_cmd = (cmd or "").strip()
        if not clean_cmd:
            return ""
        if "\x00" in clean_cmd:
            raise ValueError("Команда содержит недопустимый нулевой байт")
        # Allow multiline heredoc/script commands from planner.
        if len(clean_cmd) > 12000:
            raise ValueError("Команда слишком длинная (лимит 12000 символов)")
        return clean_cmd

    async def _ai_process_queue(self):
        """
        Execute queued AI commands sequentially.
        Pauses when a command requires confirmation.
        """
        send_idle = True
        try:
            while True:
                if not self._ssh_proc:
                    break
                if not self.server or not self._user_id:
                    break

                async with self._ai_lock:
                    if not self._ai_plan or self._ai_plan_index >= len(self._ai_plan):
                        break
                    item = self._ai_plan[self._ai_plan_index]
                    item_id = int(item.get("id") or 0)
                    cmd = str(item.get("cmd") or "").strip()
                    reason = str(item.get("reason") or "").strip()
                    requires_confirm = bool(item.get("requires_confirm"))
                    status = str(item.get("status") or "pending")

                    if status in ("done", "skipped", "cancelled"):
                        self._ai_plan_index += 1
                        continue

                    if requires_confirm:
                        item["status"] = "pending_confirm"
                        # Pause until user confirms/cancels current command
                        await self._send_ai_event(
                            {
                                "type": "ai_status",
                                "status": "waiting_confirm",
                                "id": item_id,
                                "reason": reason or "dangerous",
                            }
                        )
                        send_idle = False
                        return

                    item["status"] = "running"

                await self._send_ai_event({"type": "ai_command_status", "id": item_id, "status": "running"})

                try:
                    exit_code, output_snippet = await self._ai_execute_command(cmd, item_id)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning("AI command execution failed (id=%s): %s", item_id, e)
                    # Do not crash the whole queue on one bad command; let recovery logic decide.
                    exit_code = 1
                    output_snippet = f"WEUAI_EXECUTION_ERROR: {type(e).__name__}: {e}"
                await self._log_ai_command_history(
                    user_id=self._user_id,
                    server_id=self.server.id,
                    command=cmd,
                    output_snippet=output_snippet,
                    exit_code=exit_code,
                )

                # Track unavailable commands (exit=127 = "command not found")
                if exit_code == 127:
                    base_cmd = cmd.strip().split()[0].split("/")[-1] if cmd.strip() else ""
                    if base_cmd:
                        self._unavailable_cmds.add(base_cmd)

                # ── Adaptive error recovery ─────────────────────────────────
                # For non-trivial failures (not success, not interrupted, not skipped):
                # call the LLM to decide: retry / skip / ask user / abort
                recovery_action = None
                if exit_code not in (0, 130, None) and not item.get("_no_recovery"):
                    retries = self._ai_error_retries.get(item_id, 0)
                    if retries < 2:
                        await self._send_ai_event({
                            "type": "ai_status",
                            "status": "analyzing_error",
                            "cmd": cmd,
                            "exit_code": exit_code,
                        })
                        try:
                            async with self._ai_lock:
                                remaining_cmds = [
                                    it.get("cmd", "") for it in self._ai_plan[self._ai_plan_index + 1:]
                                    if it.get("status") not in ("done", "skipped")
                                ]
                            decision = await self._ai_handle_error(cmd, exit_code, output_snippet, remaining_cmds)
                            recovery_action = decision.get("action", "skip")

                            if recovery_action == "retry":
                                new_cmd = str(decision.get("cmd") or "").strip()
                                why = str(decision.get("why") or "Retry after error")
                                if new_cmd and new_cmd != cmd:
                                    next_id = self._ai_next_id
                                    self._ai_next_id += 1
                                    self._ai_error_retries[next_id] = retries + 1
                                    async with self._ai_lock:
                                        forbidden_patterns = list(self._ai_forbidden_patterns or [])
                                    new_item = self._build_plan_item(
                                        item_id=next_id,
                                        cmd=new_cmd,
                                        why=why,
                                        forbidden_patterns=forbidden_patterns,
                                    )
                                    new_item["_no_recovery"] = False
                                    async with self._ai_lock:
                                        # Insert right after current position
                                        self._ai_plan.insert(self._ai_plan_index + 1, new_item)
                                    await self._send_ai_event({
                                        "type": "ai_recovery",
                                        "original_cmd": cmd,
                                        "new_cmd": new_cmd,
                                        "new_id": next_id,
                                        "why": why,
                                        "requires_confirm": bool(new_item.get("requires_confirm")),
                                        "reason": str(new_item.get("reason") or ""),
                                        "streaming": bool(new_item.get("streaming")),
                                    })

                            elif recovery_action == "ask":
                                question = str(decision.get("question") or "Как лучше продолжить?")
                                q_id = f"q_{item_id}_{self._ai_next_id}"
                                self._ai_next_id += 1
                                loop = asyncio.get_event_loop()
                                reply_fut: asyncio.Future = loop.create_future()
                                self._ai_reply_futures[q_id] = reply_fut
                                await self._send_ai_event({
                                    "type": "ai_question",
                                    "q_id": q_id,
                                    "question": question,
                                    "cmd": cmd,
                                    "exit_code": exit_code,
                                })
                                try:
                                    user_reply = await asyncio.wait_for(reply_fut, timeout=300)
                                    self._add_to_history("user", f"[Ответ агенту]: {user_reply}")
                                    # Re-evaluate with user's answer
                                    decision2 = await self._ai_handle_error(
                                        cmd, exit_code, output_snippet, remaining_cmds,
                                        user_reply=user_reply
                                    )
                                    if decision2.get("action") == "retry":
                                        new_cmd2 = str(decision2.get("cmd") or "").strip()
                                        why2 = str(decision2.get("why") or "")
                                        if new_cmd2 and new_cmd2 != cmd:
                                            next_id2 = self._ai_next_id
                                            self._ai_next_id += 1
                                            self._ai_error_retries[next_id2] = retries + 1
                                            async with self._ai_lock:
                                                forbidden_patterns = list(self._ai_forbidden_patterns or [])
                                            new_item2 = self._build_plan_item(
                                                item_id=next_id2,
                                                cmd=new_cmd2,
                                                why=why2,
                                                forbidden_patterns=forbidden_patterns,
                                            )
                                            new_item2["_no_recovery"] = False
                                            async with self._ai_lock:
                                                self._ai_plan.insert(self._ai_plan_index + 1, new_item2)
                                            await self._send_ai_event({
                                                "type": "ai_recovery",
                                                "original_cmd": cmd,
                                                "new_cmd": new_cmd2,
                                                "new_id": next_id2,
                                                "why": why2,
                                                "requires_confirm": bool(new_item2.get("requires_confirm")),
                                                "reason": str(new_item2.get("reason") or ""),
                                                "streaming": bool(new_item2.get("streaming")),
                                            })
                                            recovery_action = "retry"
                                    elif decision2.get("action") == "abort":
                                        recovery_action = "abort"
                                        await self._send_ai_event({
                                            "type": "ai_error",
                                            "message": str(decision2.get("why") or "Выполнение прервано"),
                                        })
                                except asyncio.TimeoutError:
                                    # User didn't reply in time → skip
                                    logger.info("ai_question timeout, skipping command")
                                    recovery_action = "skip"
                                finally:
                                    self._ai_reply_futures.pop(q_id, None)

                            elif recovery_action == "abort":
                                await self._send_ai_event({
                                    "type": "ai_error",
                                    "message": str(decision.get("why") or "Выполнение прервано из-за критической ошибки"),
                                })

                        except asyncio.CancelledError:
                            raise
                        except Exception as e:
                            logger.warning("Error recovery LLM failed: %s", e)
                            recovery_action = "skip"

                if recovery_action == "abort":
                    break
                # ── End adaptive error recovery ─────────────────────────────

                async with self._ai_lock:
                    if self._ai_plan_index < len(self._ai_plan) and int(self._ai_plan[self._ai_plan_index].get("id") or 0) == item_id:
                        self._ai_plan[self._ai_plan_index]["status"] = "done"
                        self._ai_plan[self._ai_plan_index]["exit_code"] = exit_code
                        self._ai_plan[self._ai_plan_index]["output_snippet"] = output_snippet or ""
                        self._ai_plan_index += 1

                is_stream = bool(item.get("streaming", False))
                await self._send_ai_event({"type": "ai_command_status", "id": item_id, "status": "done", "exit_code": exit_code, "streaming": is_stream})

            # После выполнения всех команд — сформировать отчёт по выводу (анализ логов, проблем и т.д.)
            if send_idle:
                user_msg = getattr(self, "_ai_user_message", "") or ""
                async with self._ai_lock:
                    plan_snapshot = list(self._ai_plan) if self._ai_plan else []
                done_items = [
                    {
                        "cmd": str(it.get("cmd") or "").strip(),
                        "exit_code": it.get("exit_code"),
                        "output": (str(it.get("output_snippet") or "").strip())[:4000],
                    }
                    for it in plan_snapshot
                    if str(it.get("status") or "") == "done"
                ]
                done_with_output = [x for x in done_items if (x.get("output") or "").strip()]
                if user_msg and done_items:
                    report = ""
                    if done_with_output:
                        try:
                            await self._send_ai_event({"type": "ai_status", "status": "generating_report"})
                            report = (await self._ai_make_report(user_msg, done_with_output)).strip()
                        except Exception as e:
                            logger.warning("AI report generation failed: %s", e)
                    if not report:
                        # Всегда дать обратную связь: если вывод не сохранился или LLM не ответил
                        codes = [x.get("exit_code") for x in done_items]
                        all_ok = all(c == 0 for c in codes if c is not None)
                        if all_ok:
                            report = "Команды выполнены успешно (код выхода 0). Вывод смотрите в консоли слева. Краткий анализ по выводу сформировать не удалось — попробуйте запрос ещё раз или проверьте логи вручную."
                        else:
                            report = "Команды выполнены. Коды выхода: " + ", ".join(str(c) for c in codes) + ". Вывод в консоли слева. Для анализа проверьте вывод вручную."
                    if report:
                        # Compute overall status from exit codes for color-coding on frontend
                        codes = [x.get("exit_code") for x in done_items]
                        non_captured = [c for c in codes if c != 130]
                        if non_captured and all(c == 0 for c in non_captured if c is not None):
                            rep_status = "ok"
                        elif any(c not in (None, 0, 130) for c in codes):
                            # If majority succeeded (>= half), downgrade to warning not error
                            ok_count = sum(1 for c in codes if c in (0, 130))
                            rep_status = "error" if ok_count < len(codes) / 2 else "warning"
                        else:
                            rep_status = "warning"
                        await self._send_ai_event({"type": "ai_report", "report": report, "status": rep_status})
                        # Save structured execution summary to history (for next planning call)
                        exec_summary_parts = []
                        for it in done_items:
                            c = it.get("exit_code")
                            mark = "✓" if c == 0 else ("⏹" if c == 130 else f"✗(exit={c})")
                            exec_summary_parts.append(f"  {mark} {it['cmd']}")
                        exec_summary = "Выполнено:\n" + "\n".join(exec_summary_parts)
                        self._add_to_history("assistant", exec_summary)
                        self._add_to_history("assistant", f"[Отчёт]\n{report[:400]}")

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("AI processing failed")
            try:
                await self._send_ai_event({"type": "ai_error", "message": str(e)})
            except Exception:
                pass
        finally:
            if send_idle:
                try:
                    await self._send_ai_event({"type": "ai_status", "status": "idle"})
                except Exception:
                    pass

    async def _ai_execute_command(self, cmd: str, cmd_id: int) -> tuple[int, str]:
        """
        Type and execute a command in the interactive PTY and wait for an internal marker.
        For streaming/interactive commands: auto-interrupts with Ctrl+C after 8 s.
        Returns (exit_code, output_snippet).
        """
        if not self._ssh_proc:
            raise RuntimeError("SSH process not connected")

        clean_cmd = self._normalize_command_text(cmd)
        if not clean_cmd:
            return -1, ""

        is_streaming = self._is_streaming_command(clean_cmd)
        is_install = self._is_install_command(clean_cmd)

        loop = asyncio.get_running_loop()
        fut: asyncio.Future[int] = loop.create_future()
        async with self._ai_lock:
            self._ai_exit_futures[cmd_id] = fut
            self._ai_active_cmd_id = cmd_id
            self._ai_active_output = ""

        await self._ai_type_text(clean_cmd)
        self._ssh_proc.stdin.write("\n")

        # Marker line to capture exit status (filtered from UI output)
        marker_prefix = self._marker_prefix()
        marker_var = f"{marker_prefix}{cmd_id}"
        marker_cmd = (
            f"{marker_var}=$?; echo \"{marker_prefix}{cmd_id}:${{{marker_var}}}__\""
        )
        self._ssh_proc.stdin.write(marker_cmd + "\n")

        # For streaming commands: schedule Ctrl+C after 8 s to allow output capture
        interrupt_task: Optional[asyncio.Task] = None
        if is_streaming:
            interrupt_task = asyncio.create_task(self._interrupt_streaming_after(8.0))

        # For install commands: start periodic monitoring
        monitor_task: Optional[asyncio.Task] = None
        if is_install and not is_streaming:
            monitor_task = asyncio.create_task(self._monitor_install(cmd_id, clean_cmd))

        exit_code = -1
        timeout = 30 if is_streaming else 600  # installs may take up to 10 min
        try:
            exit_code = int(await asyncio.wait_for(fut, timeout=timeout))
        except asyncio.TimeoutError:
            if is_streaming:
                # Force Ctrl+C as last resort
                try:
                    if self._ssh_proc:
                        self._ssh_proc.stdin.write("\x03")
                except Exception:
                    pass
                exit_code = 130
            else:
                raise TimeoutError("Timeout waiting for command completion marker")
        finally:
            # Always cancel the interrupt/monitor tasks if still pending
            if interrupt_task and not interrupt_task.done():
                interrupt_task.cancel()
                try:
                    await interrupt_task
                except asyncio.CancelledError:
                    pass
            if monitor_task and not monitor_task.done():
                monitor_task.cancel()
                try:
                    await monitor_task
                except asyncio.CancelledError:
                    pass
            async with self._ai_lock:
                self._ai_exit_futures.pop(cmd_id, None)

        # Short delay so buffered output arrives in _ai_active_output
        await asyncio.sleep(0.4)
        output_snippet = (self._ai_active_output or "")[-6000:]
        async with self._ai_lock:
            self._ai_active_cmd_id = None
        return exit_code, output_snippet

    async def _interrupt_streaming_after(self, delay: float) -> None:
        """Send Ctrl+C after `delay` seconds to interrupt a streaming command."""
        await asyncio.sleep(delay)
        if self._ssh_proc:
            try:
                self._ssh_proc.stdin.write("\x03")
            except Exception:
                pass

    @staticmethod
    def _is_streaming_command(cmd: str) -> bool:
        """Return True if cmd would produce continuous output or need user input."""
        c = (cmd or "").strip()
        if not c:
            return False
        if _STREAMING_CMD_RE.search(c):
            return True
        # Check bare interactive command names
        cmd_name = c.split()[0].split("/")[-1].lower()
        return cmd_name in _INTERACTIVE_CMDS

    @staticmethod
    def _is_install_command(cmd: str) -> bool:
        """Return True if cmd is a package/dependency install (potentially long-running)."""
        return bool(_INSTALL_CMD_RE.search(cmd or ""))

    @staticmethod
    def _detect_install_error(output: str) -> bool:
        """Return True if output clearly shows an install failure."""
        return bool(_INSTALL_ERROR_RE.search(output or ""))

    async def _monitor_install(self, cmd_id: int, cmd: str, interval: float = 30.0) -> None:
        """
        Periodically send install progress updates to the frontend.
        If a clear error is detected, sends Ctrl+C to interrupt the install.
        """
        start = asyncio.get_event_loop().time()
        try:
            while True:
                await asyncio.sleep(interval)
                # Check if command already finished
                fut = (self._ai_exit_futures or {}).get(cmd_id)
                if not fut or fut.done():
                    return

                output_so_far = (self._ai_active_output or "")[-3000:]
                elapsed = int(asyncio.get_event_loop().time() - start)

                # Send progress notification to frontend
                last_line = (output_so_far.strip().split("\n")[-1] or "").strip()
                try:
                    await self._send_ai_event({
                        "type": "ai_install_progress",
                        "cmd": cmd,
                        "elapsed": elapsed,
                        "output_tail": last_line[:200],
                    })
                except Exception:
                    return

                # Abort if a clear error is detected in output
                if self._detect_install_error(output_so_far):
                    logger.warning("Install error detected in output, sending Ctrl+C: %s", cmd)
                    try:
                        if self._ssh_proc:
                            self._ssh_proc.stdin.write("\x03")
                    except Exception:
                        pass
                    return
        except asyncio.CancelledError:
            pass

    async def _ai_handle_error(
        self,
        cmd: str,
        exit_code: int,
        output: str,
        remaining_cmds: list[str],
        user_reply: str | None = None,
    ) -> dict[str, Any]:
        """
        Ask LLM to decide what to do after a command failed.
        Returns {"action": "retry"|"skip"|"ask"|"abort", "cmd"?, "why"?, "question"?}
        """
        from app.core.llm import LLMProvider

        remaining_text = (
            "\n".join(f"  {i + 1}. {c}" for i, c in enumerate(remaining_cmds[:5]))
            or "(нет следующих команд)"
        )
        user_block = f"\n\nОтвет пользователя: «{user_reply}»" if user_reply else ""

        prompt = f"""Ты DevOps-агент. Команда завершилась с ошибкой. Реши, что делать дальше.

КОМАНДА: {cmd}
КОД ВЫХОДА: {exit_code}
ВЫВОД:
{(output or '(нет вывода)')[:2000]}

СЛЕДУЮЩИЕ КОМАНДЫ В ПЛАНЕ:
{remaining_text}{user_block}

ПРАВИЛА ПРИНЯТИЯ РЕШЕНИЯ:
- exit=127 → команда не найдена → action=retry с альтернативой (ss вместо netstat, ip addr вместо ifconfig, etc.)
- Ошибка прав доступа ("Permission denied", "sudo required", exit=1/126) → action=ask (спросить пользователя нужен ли sudo)
- Явная опечатка или неправильные флаги → action=retry с исправленной командой
- Критическая ошибка, делающая следующие команды бессмысленными → action=abort
- Незначительная ошибка, остальные команды независимы → action=skip
- Неоднозначная ситуация — нужна информация от пользователя → action=ask

ФОРМАТ ОТВЕТА (только JSON, без markdown):
{{
  "action": "retry" | "skip" | "ask" | "abort",
  "cmd": "новая_команда (только для action=retry)",
  "why": "краткое объяснение решения (1-2 предложения)",
  "question": "вопрос пользователю (только для action=ask)"
}}

Верни только JSON."""

        llm = LLMProvider()
        out = ""
        async for chunk in llm.stream_chat(prompt, model="auto"):
            out += chunk
            if len(out) > 3000:
                break

        try:
            result = self._extract_json_object(out)
            action = str(result.get("action") or "skip").lower().strip()
            if action not in ("retry", "skip", "ask", "abort"):
                action = "skip"
            result["action"] = action
            return result
        except Exception as e:
            logger.warning("_ai_handle_error JSON parse failed: %s, output: %.200s", e, out)
            return {"action": "skip", "why": "Не удалось разобрать ответ LLM — пропускаю команду"}

    async def _ai_type_text(self, text: str):
        if not self._ssh_proc or not text:
            return
        step = 1 if len(text) <= 80 else 4
        delay = 0.01 if step == 1 else 0.006
        for i in range(0, len(text), step):
            self._ssh_proc.stdin.write(text[i : i + step])
            await asyncio.sleep(delay)

    async def _ai_plan_commands(
        self,
        user_message: str,
        rules_context: str,
        terminal_tail: str,
        history: list[dict] | None = None,
        unavailable_cmds: set[str] | None = None,
    ) -> dict[str, Any]:
        """
        Ask internal LLM to decide mode and return JSON:
          mode=answer → just reply, no commands
          mode=ask    → ask a clarifying question
          mode=execute → run commands on the server
        """
        from app.core.llm import LLMProvider

        # Build history context (exclude last entry = current user message)
        history_lines: list[str] = []
        for h in (history or [])[:-1]:
            role = str(h.get("role") or "user")
            text = str(h.get("text") or "")[:600]
            prefix = "Пользователь" if role == "user" else "Ассистент"
            history_lines.append(f"[{prefix}]: {text}")
        history_text = "\n".join(history_lines) if history_lines else "(начало диалога)"

        # Build unavailable tools warning
        unavail = sorted(unavailable_cmds or set())
        unavail_block = ""
        if unavail:
            tools_list = ", ".join(f"`{t}`" for t in unavail)
            unavail_block = f"""
═══ НЕДОСТУПНЫЕ ИНСТРУМЕНТЫ (НЕ ИСПОЛЬЗОВАТЬ) ═══
На этом сервере НЕ установлены (exit=127 при попытке): {tools_list}
→ Используй ТОЛЬКО доступные альтернативы:
   • вместо `netstat` → `ss`
   • вместо `ufw` → `iptables` (если есть права) или просто сообщи что не установлен
   • вместо `ifconfig` → `ip addr`
   • вместо `service` → `systemctl`
"""

        prompt = f"""Ты умный DevOps/SSH ассистент в составе платформы управления серверами.
Ты ведёшь диалог с пользователем и имеешь доступ к SSH-терминалу сервера.

═══ ТВОЯ ЗАДАЧА ═══
Самостоятельно решить, что делать с запросом пользователя, выбрав один из режимов:
  • mode=answer  — ответить, объяснить, проконсультировать (БЕЗ команд)
  • mode=execute — выполнить команды на сервере
  • mode=ask     — задать уточняющий вопрос пользователю

═══ ПРАВИЛА ВЫБОРА РЕЖИМА ═══
→ Общие вопросы, "что такое X", "как работает Y", теория → mode=answer
→ Приветствия, благодарности, короткие реплики → mode=answer (кратко)
→ Нужно что-то проверить/сделать/настроить на сервере → mode=execute
→ Пользователь хочет одновременно объяснения и действий → mode=execute (объяснение в assistant_text)
→ Запрос слишком неоднозначен, нужна конкретика → mode=ask
{unavail_block}
═══ КРИТИЧЕСКИЕ ПРАВИЛА ДЛЯ КОМАНД (только mode=execute) ═══
1. НИКОГДА не используй команды с бесконечным выводом — они зависнут:
   ✗ tail -f   → ✓ tail -n 100
   ✗ journalctl -f   → ✓ journalctl -n 100 --no-pager
   ✗ docker logs -f  → ✓ docker logs --tail=100
   ✗ watch cmd       → ✓ разовая команда
   ✗ top/htop        → ✓ ps aux --sort=-%cpu | head -20
   ✗ ping host       → ✓ ping -c 4 host
2. Используй --no-pager для journalctl, systemctl show, git log и т.д.
3. Максимум 6 команд. Начинай с диагностики, потом действия.
4. Разрушительные команды (rm -rf, drop, truncate) — только если явно попросили + нужно подтверждение.
5. Для редактирования файлов: используй sed -i, awk, tee или heredoc (cat > file << 'EOF').

═══ ФОРМАТ ОТВЕТА (ТОЛЬКО JSON, без markdown вокруг) ═══
{{
  "mode": "answer" | "execute" | "ask",
  "assistant_text": "текст пользователю (Markdown, всегда заполнен)",
  "commands": [{{"cmd": "команда", "why": "зачем эта команда"}}]
}}
Поле commands — только для mode=execute. Для остальных режимов — [].

═══ КОНТЕКСТ СЕРВЕРА/ПОЛИТИКИ ═══
{rules_context or "(нет)"}

═══ ИСТОРИЯ ДИАЛОГА ═══
{history_text}

═══ ПОСЛЕДНИЙ ВЫВОД ТЕРМИНАЛА ═══
{terminal_tail or "(пусто)"}

═══ ТЕКУЩИЙ ЗАПРОС ПОЛЬЗОВАТЕЛЯ ═══
{user_message}

Верни только JSON."""

        llm = LLMProvider()
        out = ""
        async for chunk in llm.stream_chat(prompt, model="auto"):
            out += chunk
            if len(out) > 20000:
                break

        if (out or "").strip().lower().startswith("error:"):
            raise ValueError(out.strip())

        return self._extract_json_object(out)

    async def _ai_make_report(self, user_message: str, commands_with_output: list[dict[str, Any]]) -> str:
        """
        По выводу выполненных команд и запросу пользователя формирует краткий отчёт:
        какие проблемы обнаружены или что проблем нет.
        """
        from app.core.llm import LLMProvider

        # Build a summary header (makes it easy for the LLM to reference commands by exact text)
        summary_lines = []
        for i, row in enumerate(commands_with_output[:10], 1):
            cmd_text = str(row.get("cmd") or "").strip() or f"cmd_{i}"
            code = row.get("exit_code")
            mark = "OK" if code == 0 else ("CAPTURED" if code == 130 else f"FAIL(exit={code})")
            summary_lines.append(f"  {i}. [{mark}] {cmd_text}")
        summary = "\n".join(summary_lines)

        # Detailed blocks — use COMMAND:/EXIT_CODE:/OUTPUT: labels, no brackets that confuse the LLM
        parts = []
        for i, row in enumerate(commands_with_output[:10], 1):
            cmd_text = str(row.get("cmd") or "").strip() or f"cmd_{i}"
            code = row.get("exit_code")
            out = (str(row.get("output") or "")).strip() or "(no output)"
            parts.append(
                f"COMMAND: {cmd_text}\n"
                f"EXIT_CODE: {code}\n"
                f"OUTPUT:\n{out[:1200]}"
            )
        context = "\n\n---\n\n".join(parts)

        prompt = f"""Ты старший DevOps-инженер. Напиши отчёт по результатам выполнения команд.

Список выполненных команд:
{summary}

ПРАВИЛА ДЛИНЫ:
- Если вывод содержит список объектов (контейнеры, образы, процессы, файлы, порты, пользователи) — покажи ПОЛНЫЙ список в таблице. Не обрезай.
- Если вывод короткий или числовой — будь кратким (до 15 строк).
- Цель: отчёт должен содержать всю полезную информацию из вывода, но без воды.

СТРУКТУРА (только актуальные секции):
**Статус**: ✅ OK / ⚠️ Предупреждение / ❌ Ошибка + одна фраза-итог.

**Контейнеры / Образы / Процессы / Порты** (нужный заголовок):
Таблица со ВСЕМИ найденными объектами. Колонки подбери по содержимому.
Для docker ps: Имя | Образ | Статус | Порты
Для docker images: Репозиторий | Тег | Размер | Создан
Для процессов: PID | Команда | CPU% | MEM%
Для портов: Протокол | Адрес | Порт | Сервис (если известен)

**Проблемы** (если есть):
Список ≤3 пунктов. Формат: `точная-команда` — что случилось — последствие.
Команда exit=127 = "не установлена" (не критическая ошибка). Не пиши "ошибка сервера".
Если основные команды выполнились — Статус ✅ OK, отсутствие утилит упомяни только в Проблемах.

**Действия** (только если есть реальные проблемы): ≤2 конкретных команды.

ПРИМЕР формата Проблем:
- `ufw status verbose` — утилита не установлена (exit 127) — рекомендуется `apt install ufw`
- `iptables -L -v -n` — требуются права root (exit 4) — выполни с sudo

Начинай сразу с **Статус**. Без заголовка "Отчёт:" и преамбулы.
Ссылайся на команды по ТОЧНОМУ тексту из списка выше (в обратных кавычках).

ЗАПРОС ПОЛЬЗОВАТЕЛЯ: {user_message[:300]}

ВЫВОД КОМАНД:
{context[:8000]}

Отчёт:"""

        llm = LLMProvider()
        out = ""
        async for chunk in llm.stream_chat(prompt, model="auto"):
            out += chunk
            if len(out) > 12000:
                break
        return (out or "").strip()

    @staticmethod
    def _extract_json_object(text: str) -> dict[str, Any]:
        t = (text or "").strip()
        # Strip common code fences if any
        if "```" in t:
            t = re.sub(r"```(?:json)?", "", t, flags=re.IGNORECASE).replace("```", "").strip()
        start = t.find("{")
        if start < 0:
            raise ValueError(f"AI не вернул JSON: {t[:400]}")
        decoder = json.JSONDecoder()
        obj, _ = decoder.raw_decode(t[start:])
        if not isinstance(obj, dict):
            raise ValueError("AI JSON должен быть объектом")
        return obj

    def _compute_confirm_reason(self, cmd: str, forbidden_patterns: list[str]) -> str:
        text = (cmd or "").strip()
        if not text:
            return ""
        if self._matches_forbidden(text, forbidden_patterns or []):
            return "forbidden"
        if is_dangerous_command(text):
            return "dangerous"
        return ""

    @staticmethod
    def _matches_forbidden(cmd: str, patterns: list[str]) -> bool:
        cmd_l = (cmd or "").lower()
        for p in patterns or []:
            pat = (str(p or "")).strip()
            if not pat:
                continue
            pl = pat.lower()
            if pl.startswith("re:"):
                expr = pat[3:].strip()
                if not expr:
                    continue
                try:
                    if re.search(expr, cmd, flags=re.IGNORECASE):
                        return True
                except re.error:
                    continue
                continue

            pat_tokens = re.findall(r"[a-z0-9_./:-]+", pl)
            cmd_tokens = re.findall(r"[a-z0-9_./:-]+", cmd_l)
            if pat_tokens and cmd_tokens:
                plen = len(pat_tokens)
                for i in range(0, len(cmd_tokens) - plen + 1):
                    if cmd_tokens[i : i + plen] == pat_tokens:
                        return True

            if pl in cmd_l:
                return True
        return False

    async def _disconnect_ssh(self):
        # Cancel streaming tasks first to avoid sending on closed socket
        await self._cancel_ai()
        current = asyncio.current_task()
        for t in (self._stdout_task, self._stderr_task, self._wait_task):
            if t and not t.done():
                if current is not None and t is current:
                    continue
                t.cancel()

        self._stdout_task = None
        self._stderr_task = None
        self._wait_task = None

        try:
            if self._ssh_proc:
                try:
                    self._ssh_proc.close()
                    await asyncio.wait_for(self._ssh_proc.wait_closed(), timeout=5)
                except Exception:
                    pass
        finally:
            self._ssh_proc = None

        try:
            if self._ssh_conn:
                try:
                    self._ssh_conn.close()
                    await asyncio.wait_for(self._ssh_conn.wait_closed(), timeout=5)
                except Exception:
                    pass
        finally:
            self._ssh_conn = None

        if self.scope.get("user") and getattr(self.scope["user"], "is_authenticated", False):
            try:
                await self.send_json({"type": "status", "status": "disconnected"})
            except Exception:
                # Socket already closed
                pass

    async def _stream_reader(self, reader: asyncssh.SSHReader[str], stream: str):
        try:
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                filtered, markers = self._filter_internal_markers(stream, chunk)
                if markers:
                    for cmd_id, exit_code in markers:
                        self._set_ai_exit_code(cmd_id, exit_code)

                if filtered:
                    self._append_terminal_tail(filtered)
                    self._append_ai_output(filtered)
                    await self.send_json({"type": "output", "stream": stream, "data": filtered})
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("SSH stream reader failed")
            try:
                await self.send_json({"type": "error", "message": f"stream {stream} failed: {e}"})
            except Exception:
                pass

    def _filter_internal_markers(self, stream: str, data: str) -> tuple[str, list[tuple[int, int]]]:
        """
        Hide internal marker lines (used by AI to capture exit codes) from terminal output,
        but keep newline(s) to preserve terminal layout. Returns (filtered_text, markers).
        """
        if not data:
            return "", []

        markers: list[tuple[int, int]] = []
        out: list[str] = []
        i = 0

        # Ensure state exists (older instances)
        if not hasattr(self, "_marker_suppress"):
            self._marker_suppress = {"stdout": False, "stderr": False}
        if not hasattr(self, "_marker_line_buf"):
            self._marker_line_buf = {"stdout": "", "stderr": ""}

        suppress = bool(self._marker_suppress.get(stream, False))
        buf = self._marker_line_buf.get(stream, "")
        marker_prefix = self._marker_prefix()
        marker_re = re.compile(rf"^{re.escape(marker_prefix)}(\d+):(-?\d+)__\s*$")

        while i < len(data):
            if suppress:
                nl = data.find("\n", i)
                if nl == -1:
                    buf += data[i:]
                    i = len(data)
                    break
                buf += data[i:nl]
                # Try parse marker output line: __WEUAI_EXIT_<token>_<id>:<code>__
                m = marker_re.match(buf.strip())
                if m:
                    try:
                        markers.append((int(m.group(1)), int(m.group(2))))
                    except Exception:
                        pass
                buf = ""
                suppress = False
                # Preserve the newline which ended the suppressed line
                out.append("\n")
                i = nl + 1
                continue

            idx = data.find(marker_prefix, i)
            if idx == -1:
                out.append(data[i:])
                i = len(data)
                break

            out.append(data[i:idx])
            suppress = True
            buf = ""
            i = idx

        self._marker_suppress[stream] = suppress
        self._marker_line_buf[stream] = buf
        return "".join(out), markers

    def _set_ai_exit_code(self, cmd_id: int, exit_code: int):
        try:
            fut = (self._ai_exit_futures or {}).get(int(cmd_id))
            if fut and not fut.done():
                fut.set_result(int(exit_code))
        except Exception:
            return

    def _append_terminal_tail(self, text: str):
        if not text:
            return
        clean = self._strip_ansi_and_controls(text)
        if not clean:
            return
        self._terminal_tail = (self._terminal_tail or "") + clean
        # keep last ~8k chars
        if len(self._terminal_tail) > 8000:
            self._terminal_tail = self._terminal_tail[-8000:]

    def _append_ai_output(self, text: str):
        if not text:
            return
        if getattr(self, "_ai_active_cmd_id", None) is None:
            return
        clean = self._strip_ansi_and_controls(text)
        if not clean:
            return
        self._ai_active_output = (self._ai_active_output or "") + clean
        if len(self._ai_active_output) > 6000:
            self._ai_active_output = self._ai_active_output[-6000:]

    @staticmethod
    def _strip_ansi_and_controls(text: str) -> str:
        if not text:
            return ""
        # ANSI escape sequences
        out = re.sub(r"\x1B[@-_][0-?]*[ -/]*[@-~]", "", text)
        # C0 controls except line breaks and tab
        out = re.sub(r"[\x00-\x08\x0B-\x1F\x7F]", "", out)
        return out

    async def _wait_for_process_exit(self):
        proc = self._ssh_proc
        if not proc:
            return
        try:
            await proc.wait_closed()
            await self.send_json(
                {
                    "type": "exit",
                    "exit_status": proc.exit_status,
                    "exit_signal": proc.exit_signal,
                }
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("SSH wait task failed")
            try:
                await self.send_json({"type": "error", "message": f"wait failed: {e}"})
            except Exception:
                pass
        finally:
            await self._disconnect_ssh()

    @staticmethod
    def _parse_term_size(content: dict[str, Any]) -> _TermSize:
        try:
            cols = int(content.get("cols") or 80)
        except Exception:
            cols = 80
        try:
            rows = int(content.get("rows") or 24)
        except Exception:
            rows = 24
        cols = max(10, min(cols, 400))
        rows = max(5, min(rows, 200))
        return _TermSize(cols=cols, rows=rows)

    @staticmethod
    def _build_exports(env_vars: dict[str, Any]) -> str:
        exports: list[str] = []
        for k, v in (env_vars or {}).items():
            key = str(k or "").strip()
            if not key:
                continue
            if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
                continue
            # Avoid newlines which would break the shell
            value = str(v if v is not None else "").replace("\n", " ").replace("\r", " ").strip()
            exports.append(f"export {key}={shlex.quote(value)}")
        return "; ".join(exports)

    async def _get_session_master_password(self) -> str:
        """Get master password from session for auto-connect."""
        session = self.scope.get("session")
        if not session:
            return ""
        try:
            # Use database_sync_to_async for safe session access
            mp = await database_sync_to_async(lambda: session.get("_mp", ""))()
            return (mp or "").strip()
        except Exception:
            return ""

    @database_sync_to_async
    def _user_can_servers(self, user_id: int) -> bool:
        from django.contrib.auth.models import User

        user = User.objects.filter(id=user_id).first()
        return bool(user and user_can_feature(user, "servers"))

    @database_sync_to_async
    def _get_server(self, user_id: int, server_id: int) -> Server:
        return Server.objects.select_related("group").get(id=server_id, user_id=user_id, is_active=True)

    @database_sync_to_async
    def _resolve_server_secret(self, server_id: int, master_password: str, plain_password: str) -> str:
        """
        Resolve password/passphrase for server authentication.

        - If server has encrypted_password and master_password provided -> decrypt.
        - Else fallback to plain_password provided by user (not stored).
        """
        server = Server.objects.only("id", "encrypted_password", "salt", "auth_method").get(id=server_id)
        if server.auth_method not in ("password", "key_password"):
            return ""

        if server.encrypted_password:
            if not master_password:
                # Allow user-provided plaintext secret as fallback
                return plain_password or ""
            if not server.salt:
                raise ValueError("У сервера есть encrypted_password, но отсутствует salt — расшифровка невозможна")
            try:
                return PasswordEncryption.decrypt_password(
                    server.encrypted_password,
                    master_password,
                    bytes(server.salt),
                )
            except Exception as e:
                # If user also provided a plaintext secret, fall back to it
                if plain_password:
                    logger.warning(
                        f"Secret decryption failed for server_id={server_id}, falling back to plaintext secret: {type(e).__name__}"
                    )
                    return plain_password
                # Surface a user-friendly message
                msg = (str(e) or "").strip() or "Неверный мастер‑пароль или повреждённый секрет"
                raise ValueError(msg) from e

        return plain_password or ""

    @database_sync_to_async
    def _get_ai_rules_and_forbidden(self, user_id: int, server_id: int) -> tuple[list[str], str]:
        """
        Returns (forbidden_patterns, rules_context_text) for AI prompt and gating.
        """
        from servers.models import GlobalServerRules

        server = (
            Server.objects.select_related("group")
            .filter(id=server_id, user_id=user_id, is_active=True)
            .first()
        )
        if not server:
            return [], ""

        global_rules = GlobalServerRules.objects.filter(user_id=user_id).first()

        forbidden: list[str] = []
        parts: list[str] = []

        if global_rules:
            ctx = global_rules.get_context_for_ai()
            if ctx:
                parts.append(ctx)
            if global_rules.forbidden_commands:
                forbidden.extend([str(x) for x in global_rules.forbidden_commands if x])

        if server.group:
            gctx = server.group.get_context_for_ai()
            if gctx:
                parts.append(gctx)
            if server.group.forbidden_commands:
                forbidden.extend([str(x) for x in server.group.forbidden_commands if x])

        try:
            server_ctx = server.get_network_context_summary()
            if server_ctx:
                parts.append("=== КОНТЕКСТ СЕРВЕРА ===\n" + server_ctx)
        except Exception:
            pass

        # De-duplicate forbidden patterns (case-insensitive)
        seen: set[str] = set()
        uniq: list[str] = []
        for p in forbidden:
            s = (p or "").strip()
            if not s:
                continue
            k = s.lower()
            if k in seen:
                continue
            seen.add(k)
            uniq.append(s)

        return uniq, "\n\n".join([p for p in parts if p]).strip()

    @database_sync_to_async
    def _log_ai_command_history(
        self,
        user_id: int,
        server_id: int,
        command: str,
        output_snippet: str,
        exit_code: int,
    ) -> None:
        from servers.models import ServerCommandHistory

        ServerCommandHistory.objects.create(
            server_id=server_id,
            user_id=user_id,
            command=command,
            output=output_snippet or "",
            exit_code=exit_code,
        )
