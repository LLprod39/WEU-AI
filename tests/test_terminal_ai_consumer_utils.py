import asyncio
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync

from servers.consumers import SSHTerminalConsumer


def _consumer() -> SSHTerminalConsumer:
    c = SSHTerminalConsumer()
    c._marker_suppress = {"stdout": False, "stderr": False}
    c._marker_line_buf = {"stdout": "", "stderr": ""}
    c._ai_marker_token = "abc123def0"
    c._ai_run_id = "run_test_1"
    return c


def test_with_ai_run_id_attaches_to_ai_messages_only():
    c = _consumer()
    ai_payload = c._with_ai_run_id({"type": "ai_status", "status": "thinking"})
    plain_payload = c._with_ai_run_id({"type": "status", "status": "connected"})

    assert ai_payload.get("run_id") == "run_test_1"
    assert "run_id" not in plain_payload


def test_filter_internal_markers_uses_current_token_prefix():
    c = _consumer()
    data = "line1\n__WEUAI_EXIT_abc123def0_7:0__\nline2\n"
    filtered, markers = c._filter_internal_markers("stdout", data)

    assert markers == [(7, 0)]
    assert "line1" in filtered
    assert "line2" in filtered
    assert "__WEUAI_EXIT_" not in filtered


def test_matches_forbidden_supports_regex_and_token_sequence():
    assert SSHTerminalConsumer._matches_forbidden(
        "sudo systemctl stop nginx",
        ["re:\\bsystemctl\\s+stop\\b"],
    )
    assert SSHTerminalConsumer._matches_forbidden(
        "docker rm my-container",
        ["docker rm"],
    )
    assert not SSHTerminalConsumer._matches_forbidden(
        "echo hello",
        ["docker rm"],
    )


def test_strip_ansi_and_controls():
    raw = "ok\x1b[31mERR\x1b[0m\x07\n"
    clean = SSHTerminalConsumer._strip_ansi_and_controls(raw)
    assert "\x1b" not in clean
    assert "\x07" not in clean
    assert "okERR" in clean


def test_build_exports_quotes_values_and_ignores_invalid_keys():
    exports = SSHTerminalConsumer._build_exports(
        {
            "OK_KEY": "value with spaces",
            "BAD-KEY": "x",
            "HOME": "/tmp/test",
        }
    )

    assert "export OK_KEY='value with spaces'" in exports
    assert "export HOME=/tmp/test" in exports
    assert "BAD-KEY" not in exports


def test_build_plan_item_reuses_safety_checks():
    c = _consumer()
    item = c._build_plan_item(item_id=1, cmd="rm -rf /tmp/x", why="", forbidden_patterns=[])
    assert item["requires_confirm"] is True
    assert item["reason"] in ("dangerous", "forbidden")


def test_normalize_command_text_allows_multiline():
    cmd = "cat > /tmp/x << 'EOF'\nhello\nEOF"
    out = SSHTerminalConsumer._normalize_command_text(cmd)
    assert "\n" in out
    assert out.startswith("cat > /tmp/x")


def test_normalize_command_text_rejects_too_long():
    too_long = "a" * 12001
    try:
        SSHTerminalConsumer._normalize_command_text(too_long)
        assert False, "Expected ValueError for oversized command"
    except ValueError as e:
        assert "слишком длинная" in str(e)


def test_normalize_execution_mode_aliases():
    assert SSHTerminalConsumer._normalize_execution_mode("auto") == "auto"
    assert SSHTerminalConsumer._normalize_execution_mode("step") == "step"
    assert SSHTerminalConsumer._normalize_execution_mode("STEP_BY_STEP") == "step"
    assert SSHTerminalConsumer._normalize_execution_mode("fast") == "fast"
    assert SSHTerminalConsumer._normalize_execution_mode("batch") == "fast"
    assert SSHTerminalConsumer._normalize_execution_mode("unknown") == "step"


def test_resolve_auto_execution_mode_prefers_planner_mode():
    c = _consumer()
    assert c._resolve_auto_execution_mode({"execution_mode": "fast"}, [{"cmd": "echo ok"}], "check") == "fast"
    assert c._resolve_auto_execution_mode({"execution_mode": "step"}, [{"cmd": "echo ok"}], "check") == "step"


def test_handle_ai_request_defaults_to_step_mode_when_not_provided():
    c = _consumer()
    c._ai_lock = asyncio.Lock()
    c._cancel_ai_locked = AsyncMock()
    c._ssh_proc = object()
    c._user_id = 1
    c.server = type("S", (), {"id": 7, "name": "srv"})()
    c._ai_history = []
    c._terminal_tail = ""
    c._unavailable_cmds = set()
    c._ai_reply_futures = {}
    c._send_ai_event = AsyncMock()
    c._get_ai_rules_and_forbidden = AsyncMock(return_value=([], "", [], {}))
    c._ai_plan_commands = AsyncMock(
        return_value={"mode": "answer", "assistant_text": "ok", "commands": []}
    )

    with patch("servers.consumers.log_user_activity_async", new=AsyncMock()):
        async_to_sync(c._handle_ai_request)({"message": "check server"})

    assert c._ai_plan_commands.call_count == 1
    kwargs = c._ai_plan_commands.call_args.kwargs
    assert kwargs["execution_mode"] == "step"
    assert c._ai_execution_mode == "step"


def test_handle_ai_request_auto_mode_uses_planner_selected_mode():
    c = _consumer()
    c._ai_lock = asyncio.Lock()
    c._cancel_ai_locked = AsyncMock()
    c._ssh_proc = object()
    c._user_id = 1
    c.server = type("S", (), {"id": 7, "name": "srv"})()
    c._ai_history = []
    c._terminal_tail = ""
    c._unavailable_cmds = set()
    c._ai_reply_futures = {}
    c._send_ai_event = AsyncMock()
    c._get_ai_rules_and_forbidden = AsyncMock(return_value=([], "", [], {}))
    c._ai_plan_commands = AsyncMock(
        return_value={"mode": "answer", "assistant_text": "ok", "commands": [], "execution_mode": "fast"}
    )

    with patch("servers.consumers.log_user_activity_async", new=AsyncMock()):
        async_to_sync(c._handle_ai_request)({"message": "check server", "execution_mode": "auto"})

    payloads = [call.args[0] for call in c._send_ai_event.await_args_list if call.args]
    ai_response = next((p for p in payloads if p.get("type") == "ai_response"), {})
    assert ai_response.get("execution_mode") == "fast"
    assert ai_response.get("requested_execution_mode") == "auto"
    assert c._ai_execution_mode == "fast"


def test_ai_process_queue_step_mode_rechecks_after_command():
    c = _consumer()
    c._ai_lock = asyncio.Lock()
    c._ssh_proc = object()
    c.server = type("S", (), {"id": 11})()
    c._user_id = 1
    c._ai_execution_mode = "step"
    c._ai_user_message = ""
    c._ai_forbidden_patterns = []
    c._ai_reply_futures = {}
    c._ai_error_retries = {}
    c._unavailable_cmds = set()
    c._ai_next_id = 2
    c._ai_step_extra_count = 0
    c._ai_plan = [
        {
            "id": 1,
            "cmd": "echo ok",
            "why": "",
            "requires_confirm": False,
            "blocked": False,
            "reason": "",
            "status": "pending",
            "streaming": False,
        }
    ]
    c._ai_plan_index = 0
    c._send_ai_event = AsyncMock()
    c._ai_execute_command = AsyncMock(return_value=(0, "ok"))
    c._log_ai_command_history = AsyncMock()
    c._ai_step_decide_next = AsyncMock(return_value={"action": "continue"})

    async_to_sync(c._ai_process_queue)()

    c._ai_step_decide_next.assert_awaited_once()


def test_ai_process_queue_step_limit_sends_soft_notice_not_error():
    c = _consumer()
    c._ai_lock = asyncio.Lock()
    c._ssh_proc = object()
    c.server = type("S", (), {"id": 11})()
    c._user_id = 1
    c._ai_execution_mode = "step"
    c._ai_user_message = "do task"
    c._ai_forbidden_patterns = []
    c._ai_reply_futures = {}
    c._ai_error_retries = {}
    c._unavailable_cmds = set()
    c._ai_next_id = 2
    c._ai_step_extra_count = 20
    c._ai_plan = [
        {
            "id": 1,
            "cmd": "echo ok",
            "why": "",
            "requires_confirm": False,
            "blocked": False,
            "reason": "",
            "status": "pending",
            "streaming": False,
        }
    ]
    c._ai_plan_index = 0
    c._send_ai_event = AsyncMock()
    c._ai_execute_command = AsyncMock(return_value=(0, "ok"))
    c._log_ai_command_history = AsyncMock()
    c._ai_step_decide_next = AsyncMock(return_value={"action": "next", "next_cmd": "echo next"})

    async_to_sync(c._ai_process_queue)()

    payloads = [call.args[0] for call in c._send_ai_event.await_args_list if call.args]
    assert any(p.get("type") == "ai_response" and "защитный лимит" in str(p.get("assistant_text", "")) for p in payloads)
    assert not any(p.get("type") == "ai_error" for p in payloads)
