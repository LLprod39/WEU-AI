"""
Full ReAct agent engine.

Implements the Reason-Act-Observe loop for autonomous server management.
Connects to servers via SSH, executes tools, and streams events to the
WebSocket live monitor via a callback.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Callable, Coroutine

from asgiref.sync import sync_to_async as _s2a
from django.utils import timezone
from loguru import logger

from app.core.llm import LLMProvider
from app.core.model_utils import resolve_provider_and_model
from servers.agent_sessions import AgentSessionManager
from servers.agent_tools import AGENT_TOOLS, get_enabled_tools, get_tools_description
from servers.mcp_tool_runtime import build_mcp_tools_description, execute_bound_mcp_tool, load_mcp_tool_bindings
from servers.models import AgentRun, Server, ServerAgent


def sync_to_async(func, thread_sensitive=False):
    return _s2a(func, thread_sensitive=thread_sensitive)


_ACTION_NAME_RE = re.compile(r"ACTION:\s*([\w_]+)\s*", re.DOTALL)
_THOUGHT_RE = re.compile(r"THOUGHT:\s*(.+?)(?=ACTION:|$)", re.DOTALL)


def _parse_action(response: str) -> tuple[str | None, dict]:
    """Надёжный парсинг ACTION: tool_name {...}.

    Использует json.JSONDecoder.raw_decode вместо regex {.*?},
    чтобы корректно обрабатывать многострочные JSON-объекты с отступами.
    """
    name_match = _ACTION_NAME_RE.search(response)
    if not name_match:
        return None, {}

    action_name = name_match.group(1).strip()
    json_start = name_match.end()

    # Пропускаем пробелы до '{'
    while json_start < len(response) and response[json_start] in " \t\n\r":
        json_start += 1

    if json_start >= len(response) or response[json_start] != "{":
        return action_name, {}

    try:
        decoder = json.JSONDecoder()
        action_args, _ = decoder.raw_decode(response, json_start)
        if isinstance(action_args, dict):
            return action_name, action_args
    except json.JSONDecodeError:
        pass

    return action_name, {}

SESSION_TIMEOUT_DEFAULT = 600
MAX_ITERATIONS_CAP = 100


class AgentEngine:
    """
    Runs a full ReAct agent against one or more servers.

    Usage::

        engine = AgentEngine(agent, servers, user, event_callback=ws_send)
        run = await engine.run()
    """

    def __init__(
        self,
        agent: ServerAgent,
        servers: list[Server],
        user,
        event_callback: Callable[..., Coroutine] | None = None,
        model_preference: str = "auto",
        specific_model: str | None = None,
        mcp_servers: list | None = None,
    ):
        self.agent = agent
        self.servers = servers
        self.user = user
        self.event_callback = event_callback

        self.max_iterations = min(agent.max_iterations or 20, MAX_ITERATIONS_CAP)
        self.session_timeout = agent.session_timeout_seconds or SESSION_TIMEOUT_DEFAULT
        self.enabled_tools = get_enabled_tools(agent.tools_config or {})

        self._stop_requested = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()

        self.session: AgentSessionManager | None = None
        self.run_record: AgentRun | None = None
        self.mcp_servers = list(mcp_servers or [])
        self.mcp_tools = {}
        self.mcp_tool_errors: list[str] = []
        self.model_preference, self.specific_model = resolve_provider_and_model(
            model_preference,
            specific_model,
            default_provider="auto",
        )

    # ------------------------------------------------------------------
    # Public control methods (called from WebSocket consumer)
    # ------------------------------------------------------------------

    def request_stop(self):
        self._stop_requested = True
        if self.session and self.session.user_reply_future and not self.session.user_reply_future.done():
            self.session.user_reply_future.cancel()

    def request_pause(self):
        self._pause_event.clear()

    def request_resume(self):
        self._pause_event.set()

    def provide_user_reply(self, answer: str):
        if self.session and self.session.user_reply_future and not self.session.user_reply_future.done():
            self.session.user_reply_future.set_result(answer)

    # ------------------------------------------------------------------
    # Main run
    # ------------------------------------------------------------------

    async def run(self) -> AgentRun:
        primary_server = self.servers[0] if self.servers else None
        run = await sync_to_async(AgentRun.objects.create)(
            agent=self.agent if self.agent.pk else None,
            server=primary_server,
            user=self.user,
            status=AgentRun.STATUS_RUNNING,
        )
        self.run_record = run
        t0 = time.monotonic()

        self.session = AgentSessionManager(
            allowed_servers=self.servers,
            max_connections=self.agent.max_connections or 5,
            command_timeout=30,
            event_callback=self.event_callback,
        )

        iterations_log: list[dict] = []
        tool_calls_log: list[dict] = []
        history: list[dict[str, str]] = []

        try:
            await self._emit("agent_status", {"status": "connecting"})

            if self.servers:
                if self.agent.allow_multi_server:
                    for srv in self.servers:
                        try:
                            await self.session.open(srv)
                        except Exception as exc:
                            logger.warning("Failed to connect to {}: {}", srv.name, exc)
                else:
                    await self.session.open(primary_server)

            self.mcp_tools, self.mcp_tool_errors = await load_mcp_tool_bindings(self.mcp_servers)

            connected = self.session.get_connected_info()
            await sync_to_async(self._update_run)(run, connected_servers=[
                {"server_id": c["server_id"], "server_name": c["server_name"]}
                for c in connected
            ])

            if not self.session.connections and not self.mcp_tools:
                raise RuntimeError("No servers connected and no MCP tools available.")

            system_prompt = self._build_system_prompt()
            history.append({"role": "system", "content": system_prompt})

            goal = self.agent.goal or self.agent.ai_prompt or "Analyze the servers."
            history.append({"role": "user", "content": f"Goal: {goal}"})

            await self._emit("agent_status", {"status": "thinking", "iteration": 0})

            iteration = 0
            deadline = time.monotonic() + self.session_timeout

            while iteration < self.max_iterations:
                if self._stop_requested:
                    await self._emit("agent_status", {"status": "stopped"})
                    break

                await self._pause_event.wait()

                if time.monotonic() > deadline:
                    await self._emit("agent_status", {"status": "timeout"})
                    break

                iteration += 1
                await self._emit("agent_status", {"status": "thinking", "iteration": iteration})

                llm_response = await self._call_llm(history)
                if not llm_response:
                    break

                thought, action_name, action_args = self._parse_response(llm_response)

                iter_entry = {
                    "iteration": iteration,
                    "thought": thought,
                    "action": action_name,
                    "args": action_args,
                    "observation": "",
                    "timestamp": timezone.now().isoformat(),
                }

                await self._emit("agent_thought", {"iteration": iteration, "thought": thought})

                if action_name is None:
                    iter_entry["observation"] = "(final answer)"
                    iterations_log.append(iter_entry)
                    history.append({"role": "assistant", "content": llm_response})
                    break

                await self._emit("agent_action", {
                    "iteration": iteration,
                    "tool": action_name,
                    "args": action_args,
                })

                if action_name == "ask_user":
                    await sync_to_async(self._update_run)(
                        run, status=AgentRun.STATUS_WAITING,
                        pending_question=action_args.get("question", ""),
                    )

                observation = await self._execute_tool(action_name, action_args)

                if action_name == "ask_user":
                    await sync_to_async(self._update_run)(
                        run, status=AgentRun.STATUS_RUNNING, pending_question="",
                    )

                tool_calls_log.append({
                    "tool": action_name,
                    "args": action_args,
                    "result": observation[:2000],
                    "duration_ms": 0,
                    "timestamp": timezone.now().isoformat(),
                })

                iter_entry["observation"] = observation[:3000]
                iterations_log.append(iter_entry)

                await self._emit("agent_observation", {
                    "iteration": iteration,
                    "tool": action_name,
                    "observation": observation[:1000],
                })

                history.append({"role": "assistant", "content": llm_response})
                history.append({"role": "user", "content": f"OBSERVATION: {observation[:4000]}"})

            final_status = AgentRun.STATUS_COMPLETED
            if self._stop_requested:
                final_status = AgentRun.STATUS_STOPPED
            elif time.monotonic() > deadline:
                final_status = AgentRun.STATUS_FAILED

            final_report = await self._generate_final_report(history, iterations_log)

            run.status = final_status
            run.iterations_log = iterations_log
            run.tool_calls = tool_calls_log
            run.total_iterations = iteration
            run.final_report = final_report
            run.ai_analysis = final_report
            run.completed_at = timezone.now()
            run.duration_ms = int((time.monotonic() - t0) * 1000)
            await sync_to_async(run.save)()

            await sync_to_async(self._touch_agent_last_run)()

            await self._emit("agent_status", {"status": final_status})
            await self._emit("agent_report", {"text": final_report, "interim": False})

        except Exception as exc:
            logger.error("Agent engine error: {}", exc)
            run.status = AgentRun.STATUS_FAILED
            run.ai_analysis = f"Agent failed: {exc}"
            run.iterations_log = iterations_log
            run.tool_calls = tool_calls_log
            run.total_iterations = len(iterations_log)
            run.completed_at = timezone.now()
            run.duration_ms = int((time.monotonic() - t0) * 1000)
            await sync_to_async(run.save)()
            await self._emit("agent_status", {"status": "failed", "error": str(exc)})
        finally:
            if self.session:
                await self.session.close_all()

        return run

    # ------------------------------------------------------------------
    # LLM interaction
    # ------------------------------------------------------------------

    async def _call_llm(self, history: list[dict]) -> str:
        prompt = self._history_to_prompt(history)
        provider = LLMProvider()
        chunks = []
        try:
            async for chunk in provider.stream_chat(
                prompt,
                model=self.model_preference,
                specific_model=self.specific_model,
                purpose="agent",
            ):
                chunks.append(chunk)
        except Exception as exc:
            logger.error("LLM call failed: {}", exc)
            return ""
        return "".join(chunks)

    @staticmethod
    def _history_to_prompt(history: list[dict]) -> str:
        parts = []
        for msg in history:
            role = msg["role"].upper()
            parts.append(f"[{role}]\n{msg['content']}")
        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_response(response: str) -> tuple[str, str | None, dict]:
        """Extract THOUGHT and ACTION from LLM response."""
        thought = ""
        thought_match = _THOUGHT_RE.search(response)
        if thought_match:
            thought = thought_match.group(1).strip()
        else:
            thought = response.split("ACTION:")[0].strip() if "ACTION:" in response else response.strip()

        action_name, action_args = _parse_action(response)
        if action_name is not None:
            return thought, action_name, action_args

        return thought, None, {}

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------

    async def _execute_tool(self, name: str, args: dict) -> str:
        if name in self.mcp_tools:
            return await execute_bound_mcp_tool(self.mcp_tools, name, args)

        tool_meta = AGENT_TOOLS.get(name)
        if tool_meta is None:
            return f"Unknown tool: {name}"
        if name not in self.enabled_tools:
            return f"Tool '{name}' is disabled for this agent."

        fn = tool_meta["fn"]
        try:
            result = await fn(self.session, **args)
            return result.result
        except Exception as exc:
            return f"Tool error ({name}): {exc}"

    # ------------------------------------------------------------------
    # Prompt building
    # ------------------------------------------------------------------

    def _build_system_prompt(self) -> str:
        connected = self.session.get_connected_info()
        servers_desc = "\n".join(f"- {c['server_name']} (id: {c['server_id']})" for c in connected) or "- Нет активных SSH подключений"
        all_servers_desc = (
            "\n".join(f"- {s.name} (id: {s.id}, host: {s.host})" for s in self.servers) or "- SSH серверы не выбраны"
        )

        custom_system = self.agent.system_prompt or ""
        tools_desc = get_tools_description(self.enabled_tools)
        mcp_tools_desc = build_mcp_tools_description(self.mcp_tools)
        if mcp_tools_desc:
            tools_desc = f"{tools_desc}\n\n{mcp_tools_desc}" if tools_desc else mcp_tools_desc

        stop_conditions = ""
        if self.agent.stop_conditions:
            stop_conditions = "\nStop conditions:\n" + "\n".join(
                f"- {c}" for c in self.agent.stop_conditions
            )

        mcp_errors = ""
        if self.mcp_tool_errors:
            mcp_errors = "\n## MCP подключения с ошибками\n" + "\n".join(f"- {item}" for item in self.mcp_tool_errors)

        return f"""Ты — DevOps / Platform AI-агент, работающий через SSH и MCP-инструменты.
У тебя есть доступ к терминалам серверов и внешним системам, подключённым через MCP.
Всегда отвечай, рассуждай и пиши отчёты на русском языке.

{custom_system}

## Подключённые серверы
{servers_desc}

## Все доступные серверы (можно подключиться через open_connection)
{all_servers_desc}

## Доступные инструменты
{tools_desc}

## Правила
- ВСЕГДА сначала выводи THOUGHT с объяснением логики рассуждений
- Затем выводи ACTION с вызовом инструмента в формате JSON
- После каждой команды анализируй вывод и решай, что делать дальше
- Для внешних систем (Keycloak, GitHub, Docker API, cloud, IAM) используй MCP-инструменты, если они доступны
- Имена MCP-инструментов нужно использовать ТОЧНО как перечислено в секции инструментов
- Если команда выполняется слишком долго (>30с), используй send_ctrl_c для прерывания
- Используй read_console для проверки текущего состояния терминала, если не уверен
- НЕ запускай опасные команды (rm -rf, mkfs, shutdown и т.д.) — они будут заблокированы
- Когда цель полностью достигнута, предоставь итоговый анализ БЕЗ строки ACTION
- Используй ask_user только когда действительно нужен ввод человека для критического решения
- Используй report для отправки промежуточного отчёта пользователю при длительных задачах
- Максимум {self.max_iterations} итераций доступно
{stop_conditions}
{mcp_errors}

## Формат вывода
THOUGHT: <твоё рассуждение о том, что делать дальше>
ACTION: tool_name {{"param1": "value1", "param2": "value2"}}

Когда задача завершена (больше нет действий), выведи итоговый анализ БЕЗ строки ACTION."""

    # ------------------------------------------------------------------
    # Final report
    # ------------------------------------------------------------------

    async def _generate_final_report(self, history: list[dict], iterations: list[dict]) -> str:
        summary_parts = []
        for it in iterations:
            if it.get("action"):
                summary_parts.append(f"Step {it['iteration']}: {it['action']}({json.dumps(it.get('args', {}), ensure_ascii=False)[:100]}) → {it['observation'][:200]}")
            else:
                summary_parts.append(f"Step {it['iteration']}: Final answer")

        steps_summary = "\n".join(summary_parts[-20:])

        prompt = f"""Ты — технический аналитик. Создай профессиональный структурированный отчёт в формате Markdown.
Язык: русский. Стиль: деловой, конкретный, без воды.

Данные для отчёта:
- Агент: {self.agent.name}
- Цель: {self.agent.goal or self.agent.ai_prompt or 'Не указана'}
- Итераций выполнено: {len(iterations)}
- Шаги агента: {steps_summary}
- Итоговый ответ агента: {history[-1]['content'][:3000] if history else 'Нет данных'}

Сгенерируй отчёт СТРОГО в следующем формате — не добавляй лишних секций, не меняй структуру:

# [Краткое название того что было сделано]

> [Одно предложение — главный итог работы агента]

## Результат

[2–4 предложения об общем результате и текущем состоянии системы]

## Выполненные действия

- [Действие 1 — конкретно что сделано и что получено]
- [Действие 2]
- [...]

## Ключевые находки

- [Находка 1 — факт с конкретными данными: цифры, названия, пути]
- [Находка 2]
- [...]

## Рекомендации

- [Рекомендация 1 — конкретное действие]
- [Рекомендация 2]

---

**Статус:** ✅ Успех / ⚠️ Частичный успех / ❌ Ошибка"""

        provider = LLMProvider()
        chunks = []
        try:
            async for chunk in provider.stream_chat(
                prompt,
                model=self.model_preference,
                specific_model=self.specific_model,
                purpose="agent",
            ):
                chunks.append(chunk)
            return "".join(chunks)
        except Exception as exc:
            logger.error("Final report generation failed: {}", exc)
            return f"Report generation failed: {exc}\n\nRaw steps:\n{steps_summary}"

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _update_run(run: AgentRun, **kwargs):
        for k, v in kwargs.items():
            setattr(run, k, v)
        run.save(update_fields=list(kwargs.keys()))

    def _touch_agent_last_run(self):
        if not self.agent.pk:
            return
        self.agent.last_run_at = timezone.now()
        self.agent.save(update_fields=["last_run_at"])

    # ------------------------------------------------------------------
    # Event emission
    # ------------------------------------------------------------------

    async def _emit(self, event_type: str, data: dict):
        if self.event_callback:
            try:
                await self.event_callback(event_type, data)
            except Exception as exc:
                logger.debug("Event callback error: {}", exc)
