from types import SimpleNamespace

import pytest
from django.contrib.auth.models import User

from servers.mcp_tool_runtime import (
    MCPBoundTool,
    build_mcp_tools_description,
    execute_bound_mcp_tool,
    load_mcp_tool_bindings,
)
from studio.models import Pipeline, PipelineTrigger
from studio.pipeline_executor import _coerce_mcp_arguments
from studio.views import _normalise_related_ids


@pytest.mark.django_db
def test_pipeline_sync_triggers_from_nodes_creates_updates_and_removes_triggers():
    user = User.objects.create_user(username="pipeline-user", password="x")
    pipeline = Pipeline.objects.create(
        name="Trigger Sync",
        owner=user,
        nodes=[
            {
                "id": "node_webhook",
                "type": "trigger/webhook",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "Webhook Start",
                    "is_active": True,
                    "webhook_payload_map": {"branch": "ref"},
                },
            },
            {
                "id": "node_schedule",
                "type": "trigger/schedule",
                "position": {"x": 100, "y": 0},
                "data": {
                    "label": "Nightly",
                    "is_active": False,
                    "cron_expression": "0 4 * * *",
                },
            },
        ],
        edges=[],
    )

    pipeline.sync_triggers_from_nodes()

    triggers = {trigger.node_id: trigger for trigger in pipeline.triggers.all()}
    assert set(triggers) == {"node_webhook", "node_schedule"}
    assert triggers["node_webhook"].trigger_type == PipelineTrigger.TYPE_WEBHOOK
    assert triggers["node_webhook"].webhook_payload_map == {"branch": "ref"}
    assert triggers["node_schedule"].cron_expression == "0 4 * * *"
    assert triggers["node_schedule"].is_active is False

    pipeline.nodes = [
        {
            "id": "node_schedule",
            "type": "trigger/schedule",
            "position": {"x": 100, "y": 0},
            "data": {
                "label": "Hourly",
                "is_active": True,
                "cron_expression": "0 * * * *",
            },
        }
    ]
    pipeline.save(update_fields=["nodes"])
    pipeline.sync_triggers_from_nodes()

    schedule_trigger = pipeline.triggers.get(node_id="node_schedule")
    assert pipeline.triggers.count() == 1
    assert schedule_trigger.name == "Hourly"
    assert schedule_trigger.cron_expression == "0 * * * *"
    assert schedule_trigger.is_active is True


def test_coerce_mcp_arguments_prefers_arguments_text_over_stale_arguments_dict():
    arguments, error = _coerce_mcp_arguments(
        {
            "arguments": {"stale": True},
            "arguments_text": '{"path": "{repo_path}"}',
        }
    )

    assert error is None
    assert arguments == {"path": "{repo_path}"}


def test_coerce_mcp_arguments_requires_json_object():
    arguments, error = _coerce_mcp_arguments({"arguments_text": "[]"})

    assert arguments is None
    assert error == "MCP arguments must be a JSON object"


def test_normalise_related_ids_accepts_ints_and_object_payloads():
    assert _normalise_related_ids([1, "2", {"id": 3}, {"id": "4"}, None, {"id": "bad"}]) == [1, 2, 3, 4]


@pytest.mark.asyncio
async def test_load_mcp_tool_bindings_builds_safe_aliases_and_collects_errors(monkeypatch):
    good_server = SimpleNamespace(id=1, name="Keycloak Admin")
    bad_server = SimpleNamespace(id=2, name="Broken MCP")

    async def fake_list_mcp_tools(server):
        if server.id == 2:
            raise RuntimeError("offline")
        return [
            {
                "name": "create_user",
                "description": "Create a Keycloak user",
                "inputSchema": {
                    "type": "object",
                    "properties": {"username": {"type": "string", "description": "Login name"}},
                    "required": ["username"],
                },
            },
            {"name": "assign-client-roles", "description": "Assign client roles"},
        ]

    monkeypatch.setattr("servers.mcp_tool_runtime.list_mcp_tools", fake_list_mcp_tools)

    bindings, errors = await load_mcp_tool_bindings([good_server, bad_server])  # type: ignore[arg-type]

    assert set(bindings) == {"mcp_keycloak_admin_create_user", "mcp_keycloak_admin_assign_client_roles"}
    assert errors == ["Broken MCP: offline"]
    description = build_mcp_tools_description(bindings)
    assert "Original MCP tool: create_user" in description
    assert "username: string (required)" in description


@pytest.mark.asyncio
async def test_execute_bound_mcp_tool_returns_error_text(monkeypatch):
    async def fake_call_mcp_tool(server, tool_name, arguments):
        assert server.name == "Keycloak Admin"
        assert tool_name == "create_user"
        assert arguments == {"username": "alice"}
        return {"isError": True, "content": [{"type": "text", "text": "User already exists"}]}

    monkeypatch.setattr("servers.mcp_tool_runtime.call_mcp_tool", fake_call_mcp_tool)

    bindings = {
        "mcp_keycloak_admin_create_user": MCPBoundTool(
            action_name="mcp_keycloak_admin_create_user",
            server=SimpleNamespace(id=1, name="Keycloak Admin"),  # type: ignore[arg-type]
            tool_name="create_user",
            description="Create a Keycloak user",
            input_schema={"type": "object"},
        )
    }

    result = await execute_bound_mcp_tool(bindings, "mcp_keycloak_admin_create_user", {"username": "alice"})

    assert "User already exists" in result
