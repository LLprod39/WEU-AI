"""
WebSocket consumers for interactive SSH terminal sessions.
"""

from __future__ import annotations

import asyncio
import json
import re
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
          {type: "ai_error", message: "<text>"}
      - client -> server:
          {type: "connect", master_password?, password?, cols?, rows?, term_type?}
          {type: "input", data: "<keystrokes>"}
          {type: "resize", cols, rows}
          {type: "disconnect"}
          {type: "ai_request", message: "<text>"}
          {type: "ai_confirm", id: <int>}
          {type: "ai_cancel", id: <int>}
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

    _terminal_tail: str

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
        self._terminal_tail = ""
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

        await self.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})

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
                        raise ValueError("Требуется пароль (password auth)")
                    connect_kwargs["password"] = secret
                elif self.server.auth_method == "key":
                    if not (self.server.key_path or "").strip():
                        raise ValueError("Не указан путь к SSH ключу (key auth)")
                    connect_kwargs["client_keys"] = [self.server.key_path]
                elif self.server.auth_method == "key_password":
                    if not (self.server.key_path or "").strip():
                        raise ValueError("Не указан путь к SSH ключу (key+password auth)")
                    if not secret:
                        raise ValueError("Требуется пароль/пасфраза для SSH ключа")
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

        self._ai_plan = []
        self._ai_plan_index = 0
        self._ai_forbidden_patterns = []
        self._ai_active_cmd_id = None
        self._ai_active_output = ""

    async def _handle_ai_request(self, message: str):
        msg = (message or "").strip()
        if not msg:
            return
        if not self._ssh_proc:
            await self.send_json({"type": "ai_error", "message": "SSH не подключён. Сначала нажмите Connect."})
            return
        if not self.server or not self._user_id:
            await self.send_json({"type": "ai_error", "message": "Server not loaded"})
            return

        async with self._ai_lock:
            await self._cancel_ai_locked()
            # reset counters
            self._ai_plan = []
            self._ai_plan_index = 0
            self._ai_next_id = 1

        await self.send_json({"type": "ai_status", "status": "thinking"})

        try:
            forbidden_patterns, rules_context = await self._get_ai_rules_and_forbidden(self._user_id, self.server.id)
            plan_obj = await self._ai_plan_commands(
                user_message=msg,
                rules_context=rules_context,
                terminal_tail=(self._terminal_tail or "")[-2000:],
            )
        except Exception as e:
            await self.send_json({"type": "ai_error", "message": str(e)})
            await self.send_json({"type": "ai_status", "status": "idle"})
            return

        assistant_text = str(plan_obj.get("assistant_text") or "").strip()
        commands_raw = plan_obj.get("commands") or []
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
            reason = self._compute_confirm_reason(cmd, forbidden_patterns)
            requires_confirm = bool(reason)
            plan_items.append(
                {
                    "id": item_id,
                    "cmd": cmd,
                    "why": why,
                    "requires_confirm": requires_confirm,
                    "reason": reason,
                    "status": "pending",
                }
            )

        async with self._ai_lock:
            self._ai_plan = plan_items
            self._ai_plan_index = 0
            self._ai_next_id = next_id
            self._ai_forbidden_patterns = forbidden_patterns or []

        await self.send_json({"type": "ai_response", "assistant_text": assistant_text, "commands": plan_items})

        if not plan_items:
            await self.send_json({"type": "ai_status", "status": "idle"})
            return

        await self.send_json({"type": "ai_status", "status": "running"})
        async with self._ai_lock:
            self._ai_task = asyncio.create_task(self._ai_process_queue())

    async def _handle_ai_confirm(self, content: dict[str, Any]):
        try:
            cmd_id = int(content.get("id"))
        except Exception:
            await self.send_json({"type": "ai_error", "message": "Некорректный id для подтверждения"})
            return

        should_start = False
        async with self._ai_lock:
            if not self._ai_plan or self._ai_plan_index >= len(self._ai_plan):
                return
            item = self._ai_plan[self._ai_plan_index]
            if int(item.get("id") or 0) != cmd_id:
                await self.send_json({"type": "ai_error", "message": "Подтверждать можно только текущую ожидающую команду"})
                return
            if not item.get("requires_confirm"):
                return
            item["requires_confirm"] = False
            item["confirmed"] = True
            item["status"] = "pending"
            if not self._ai_task or self._ai_task.done():
                should_start = True

        await self.send_json({"type": "ai_command_status", "id": cmd_id, "status": "confirmed"})
        if should_start:
            await self.send_json({"type": "ai_status", "status": "running"})
            async with self._ai_lock:
                self._ai_task = asyncio.create_task(self._ai_process_queue())

    async def _handle_ai_cancel(self, content: dict[str, Any]):
        try:
            cmd_id = int(content.get("id"))
        except Exception:
            await self.send_json({"type": "ai_error", "message": "Некорректный id для отмены"})
            return

        should_start = False
        async with self._ai_lock:
            if not self._ai_plan or self._ai_plan_index >= len(self._ai_plan):
                return
            item = self._ai_plan[self._ai_plan_index]
            if int(item.get("id") or 0) != cmd_id:
                await self.send_json({"type": "ai_error", "message": "Отменять можно только текущую ожидающую команду"})
                return
            item["status"] = "skipped"
            self._ai_plan_index += 1
            if not self._ai_task or self._ai_task.done():
                should_start = True

        await self.send_json({"type": "ai_command_status", "id": cmd_id, "status": "skipped"})
        if should_start:
            await self.send_json({"type": "ai_status", "status": "running"})
            async with self._ai_lock:
                self._ai_task = asyncio.create_task(self._ai_process_queue())

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

                    if status in ("done", "skipped"):
                        self._ai_plan_index += 1
                        continue

                    if requires_confirm:
                        item["status"] = "pending_confirm"
                        # Pause until user confirms/cancels current command
                        await self.send_json(
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

                await self.send_json({"type": "ai_command_status", "id": item_id, "status": "running"})

                exit_code, output_snippet = await self._ai_execute_command(cmd, item_id)
                await self._log_ai_command_history(
                    user_id=self._user_id,
                    server_id=self.server.id,
                    command=cmd,
                    output_snippet=output_snippet,
                    exit_code=exit_code,
                )

                async with self._ai_lock:
                    if self._ai_plan_index < len(self._ai_plan) and int(self._ai_plan[self._ai_plan_index].get("id") or 0) == item_id:
                        self._ai_plan[self._ai_plan_index]["status"] = "done"
                        self._ai_plan[self._ai_plan_index]["exit_code"] = exit_code
                        self._ai_plan_index += 1

                await self.send_json({"type": "ai_command_status", "id": item_id, "status": "done", "exit_code": exit_code})

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("AI processing failed")
            try:
                await self.send_json({"type": "ai_error", "message": str(e)})
            except Exception:
                pass
        finally:
            if send_idle:
                try:
                    await self.send_json({"type": "ai_status", "status": "idle"})
                except Exception:
                    pass

    async def _ai_execute_command(self, cmd: str, cmd_id: int) -> tuple[int, str]:
        """
        Type and execute a command in the interactive PTY and wait for an internal marker.
        Returns (exit_code, output_snippet).
        """
        if not self._ssh_proc:
            raise RuntimeError("SSH process not connected")

        clean_cmd = (cmd or "").strip()
        if not clean_cmd:
            return -1, ""

        # Basic hard limits
        if "\n" in clean_cmd or "\r" in clean_cmd:
            raise ValueError("Команда должна быть однострочной")
        if len(clean_cmd) > 400:
            raise ValueError("Команда слишком длинная")

        loop = asyncio.get_running_loop()
        fut: asyncio.Future[int] = loop.create_future()
        async with self._ai_lock:
            self._ai_exit_futures[cmd_id] = fut
            self._ai_active_cmd_id = cmd_id
            self._ai_active_output = ""

        await self._ai_type_text(clean_cmd)
        self._ssh_proc.stdin.write("\n")

        # Marker line to capture exit status (filtered from UI output)
        marker_var = f"{_WEUAI_MARKER_PREFIX}{cmd_id}"
        marker_cmd = (
            f"{marker_var}=$?; echo \"{_WEUAI_MARKER_PREFIX}{cmd_id}:${{{marker_var}}}__\""
        )
        self._ssh_proc.stdin.write(marker_cmd + "\n")

        exit_code = -1
        try:
            exit_code = int(await asyncio.wait_for(fut, timeout=180))
        except asyncio.TimeoutError:
            raise TimeoutError("Timeout waiting for command completion marker")
        finally:
            async with self._ai_lock:
                self._ai_exit_futures.pop(cmd_id, None)
                self._ai_active_cmd_id = None

        output_snippet = (self._ai_active_output or "")[-2000:]
        return exit_code, output_snippet

    async def _ai_type_text(self, text: str):
        if not self._ssh_proc or not text:
            return
        step = 1 if len(text) <= 80 else 4
        delay = 0.01 if step == 1 else 0.006
        for i in range(0, len(text), step):
            self._ssh_proc.stdin.write(text[i : i + step])
            await asyncio.sleep(delay)

    async def _ai_plan_commands(self, user_message: str, rules_context: str, terminal_tail: str) -> dict[str, Any]:
        """
        Ask internal LLM to return a strict JSON with assistant_text + commands[].
        """
        from app.core.llm import LLMProvider

        prompt = f"""Ты DevOps/SSH ассистент.

ПРАВИЛА:
- Отвечай ТОЛЬКО валидным JSON (без markdown, без пояснений вне JSON).
- Предлагай только команды для Linux shell.
- Сначала безопасные проверки (df, free, uptime, systemctl status, tail).
- Не предлагай разрушительные команды. Если без них нельзя — предложи безопасную диагностику и остановись.

ФОРМАТ JSON:
{{
  "assistant_text": "...",
  "commands": [{{"cmd": "...", "why": "..."}}]
}}

КОНТЕКСТ СЕРВЕРА/ПОЛИТИКИ:
{rules_context}

ПОСЛЕДНИЙ ВЫВОД ТЕРМИНАЛА (может быть пустым):
{terminal_tail}

ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
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
            if pat.lower() in cmd_l:
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

        while i < len(data):
            if suppress:
                nl = data.find("\n", i)
                if nl == -1:
                    buf += data[i:]
                    i = len(data)
                    break
                buf += data[i:nl]
                # Try parse marker output line: __WEUAI_EXIT_<id>:<code>__
                m = re.match(r"^__WEUAI_EXIT_(\d+):(-?\d+)__\s*$", buf.strip())
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

            idx = data.find(_WEUAI_MARKER_PREFIX, i)
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
        self._terminal_tail = (self._terminal_tail or "") + text
        # keep last ~8k chars
        if len(self._terminal_tail) > 8000:
            self._terminal_tail = self._terminal_tail[-8000:]

    def _append_ai_output(self, text: str):
        if not text:
            return
        if getattr(self, "_ai_active_cmd_id", None) is None:
            return
        self._ai_active_output = (self._ai_active_output or "") + text
        if len(self._ai_active_output) > 6000:
            self._ai_active_output = self._ai_active_output[-6000:]

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
            # Avoid newlines which would break the shell
            value = str(v if v is not None else "").replace("\n", " ").replace("\r", " ").strip()
            exports.append(f"export {key}={value}")
        return "; ".join(exports)

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

