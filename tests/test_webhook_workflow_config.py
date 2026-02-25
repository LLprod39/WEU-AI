import json


def test_normalize_workflow_script_accepts_valid_steps():
    from agent_hub.webhooks import _normalize_workflow_script

    normalized = _normalize_workflow_script(
        {
            "name": "Incident flow",
            "runtime": "claude",
            "steps": [
                {"title": "Triage", "prompt": "Check host", "max_iterations": 2},
                {"title": "Fix", "prompt": "Apply patch", "verify_prompt": "Verify service"},
            ],
        }
    )

    assert normalized is not None
    assert normalized["name"] == "Incident flow"
    assert len(normalized["steps"]) == 2
    assert normalized["steps"][0]["max_iterations"] == 2
    assert normalized["steps"][1]["verify_promise"] == "PASS"


def test_normalize_webhook_config_parses_workflow_script_json_string():
    from agent_hub.webhooks import _normalize_webhook_config

    script = {
        "name": "Flow {{event_name}}",
        "steps": [{"title": "S1", "prompt": "Do {{host.name}}"}],
    }
    cfg = _normalize_webhook_config(
        {
            "runtime": "claude",
            "workflow_script": json.dumps(script),
            "skill_ids": [1, "2", "x"],
            "target_server_id": "42",
        }
    )

    assert cfg["runtime"] == "claude"
    assert cfg["target_server_id"] == 42
    assert cfg["skill_ids"] == [1, 2]
    assert cfg["workflow_template"] == "custom"
    assert cfg["workflow_script"]["steps"][0]["prompt"] == "Do {{host.name}}"


def test_normalize_webhook_config_includes_notify_and_templates():
    from agent_hub.webhooks import _normalize_webhook_config

    cfg = _normalize_webhook_config(
        {
            "workflow_name_template": "WF: {{event_name}}",
            "workflow_description_template": "Desc {{source}}",
            "notify_emails": "ops@example.com, devops@example.com",
            "notify_on_success": False,
            "notify_on_failure": True,
        }
    )

    assert cfg["workflow_name_template"] == "WF: {{event_name}}"
    assert cfg["workflow_description_template"] == "Desc {{source}}"
    assert cfg["notify_emails"] == "ops@example.com, devops@example.com"
    assert cfg["notify_on_success"] is False
    assert cfg["notify_on_failure"] is True


def test_apply_workflow_script_overrides_merges_notify_and_templates():
    from agent_hub.webhooks import _apply_workflow_script_overrides

    payload = {"event_name": "Disk full", "source": "generic"}
    extra = {"event_name": "Disk full", "source": "generic", "webhook_name": "Infra Hook"}
    script = {
        "steps": [{"title": "S1", "prompt": "Do things"}],
        "notify": {"emails": ["team@example.com"], "on_success": True},
    }
    config = {
        "workflow_name_template": "WF {{event_name}}",
        "workflow_description_template": "Auto {{source}}",
        "notify_emails": "ops@example.com",
        "notify_on_failure": True,
    }

    out = _apply_workflow_script_overrides(
        script=script,
        config=config,
        payload=payload,
        extra=extra,
        target_server=None,
        default_name="Fallback",
        default_description="Fallback desc",
    )

    assert out["name"] == "WF Disk full"
    assert out["description"] == "Auto generic"
    assert out["task_type"] == "code"
    assert set(out["notify"]["emails"]) == {"team@example.com", "ops@example.com"}
    assert out["notify"]["on_success"] is True
    assert out["notify"]["on_failure"] is True


def test_render_template_tree_renders_nested_strings():
    from agent_hub.webhooks import _render_template_tree

    payload = {"host": {"name": "srv-01"}, "event_name": "Disk full"}
    extra = {"event_name": "Disk full", "webhook_name": "Infra Hook"}
    tree = {
        "name": "Flow {{event_name}}",
        "steps": [
            {"title": "S1", "prompt": "Inspect {{host.name}}"},
            {"title": "S2", "prompt": "Notify {{webhook_name}}"},
        ],
    }

    rendered = _render_template_tree(tree, payload, extra)
    assert rendered["name"] == "Flow Disk full"
    assert rendered["steps"][0]["prompt"] == "Inspect srv-01"
    assert rendered["steps"][1]["prompt"] == "Notify Infra Hook"
