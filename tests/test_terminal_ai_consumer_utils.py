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
