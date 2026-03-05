import json
from datetime import datetime

import pytest
from django.contrib.auth.models import User
from django.utils import timezone

from servers.models import Server
from studio.management.commands.run_scheduled_pipelines import Command
from studio.models import AgentConfig, MCPServerPool, Pipeline, PipelineRun, PipelineTrigger


def _llm_node(node_id: str) -> dict:
    return {
        "id": node_id,
        "type": "agent/llm_query",
        "position": {"x": 0, "y": 0},
        "data": {
            "prompt": "Summarize the previous step.",
            "provider": "gemini",
        },
    }


@pytest.mark.django_db
def test_api_pipeline_run_rejects_non_object_context(client):
    user = User.objects.create_user(username="studio-run-user", password="x")
    pipeline = Pipeline.objects.create(name="Manual Run Validation", owner=user, nodes=[_llm_node("n1")], edges=[])

    client.force_login(user)
    response = client.post(
        f"/api/studio/pipelines/{pipeline.id}/run/",
        data=json.dumps({"context": ["bad"]}),
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["error"] == "context must be a JSON object"


@pytest.mark.django_db
def test_api_trigger_receive_rejects_non_object_payload(client):
    user = User.objects.create_user(username="studio-webhook-user", password="x")
    pipeline = Pipeline.objects.create(
        name="Webhook Validation",
        owner=user,
        nodes=[
            {
                "id": "trigger_webhook",
                "type": "trigger/webhook",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Webhook Start"},
            },
            _llm_node("n1"),
        ],
        edges=[{"id": "e1", "source": "trigger_webhook", "target": "n1"}],
    )
    pipeline.sync_triggers_from_nodes()
    trigger = pipeline.triggers.get(node_id="trigger_webhook")

    response = client.post(
        f"/api/studio/triggers/{trigger.webhook_token}/receive/",
        data="[]",
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["error"] == "Webhook payload must be a JSON object"


@pytest.mark.django_db
def test_api_runs_list_detail_and_stop_include_webhook_runs_for_pipeline_owner(client):
    user = User.objects.create_user(username="studio-runs-user", password="x")
    pipeline = Pipeline.objects.create(name="Run Visibility", owner=user, nodes=[_llm_node("n1")], edges=[])
    run = PipelineRun.objects.create(
        pipeline=pipeline,
        status=PipelineRun.STATUS_RUNNING,
        context={},
        trigger_data={"source": "webhook"},
    )

    client.force_login(user)

    list_response = client.get("/api/studio/runs/")
    assert list_response.status_code == 200
    listed_ids = {item["id"] for item in list_response.json()}
    assert run.id in listed_ids

    detail_response = client.get(f"/api/studio/runs/{run.id}/")
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == run.id

    stop_response = client.post(f"/api/studio/runs/{run.id}/stop/")
    assert stop_response.status_code == 200

    run.refresh_from_db()
    assert run.status == PipelineRun.STATUS_STOPPED


@pytest.mark.django_db
def test_api_pipeline_create_rejects_cycle(client):
    user = User.objects.create_user(username="studio-cycle-user", password="x")
    client.force_login(user)

    response = client.post(
        "/api/studio/pipelines/",
        data=json.dumps(
            {
                "name": "Cycle",
                "nodes": [_llm_node("a"), _llm_node("b")],
                "edges": [
                    {"id": "ab", "source": "a", "target": "b"},
                    {"id": "ba", "source": "b", "target": "a"},
                ],
            }
        ),
        content_type="application/json",
    )

    assert response.status_code == 400
    assert "cycle" in response.json()["error"].lower()


@pytest.mark.django_db
def test_api_pipeline_create_rejects_inaccessible_refs(client):
    owner = User.objects.create_user(username="studio-owner", password="x")
    other = User.objects.create_user(username="studio-other", password="x")
    alien_server = Server.objects.create(
        user=other,
        name="Alien server",
        host="10.0.0.9",
        username="root",
    )
    alien_agent = AgentConfig.objects.create(name="Alien agent", owner=other)
    alien_mcp = MCPServerPool.objects.create(name="Alien MCP", owner=other, transport=MCPServerPool.TRANSPORT_STDIO)

    client.force_login(owner)
    response = client.post(
        "/api/studio/pipelines/",
        data=json.dumps(
            {
                "name": "Bad refs",
                "nodes": [
                    {
                        "id": "react_1",
                        "type": "agent/react",
                        "position": {"x": 0, "y": 0},
                        "data": {
                            "goal": "Inspect environment",
                            "agent_config_id": alien_agent.id,
                            "server_ids": [alien_server.id],
                            "mcp_server_ids": [alien_mcp.id],
                        },
                    }
                ],
                "edges": [],
            }
        ),
        content_type="application/json",
    )

    assert response.status_code == 400
    error_text = response.json()["error"]
    assert "agent config" in error_text.lower()
    assert "servers" in error_text.lower()
    assert "mcp" in error_text.lower()


@pytest.mark.django_db
def test_scheduler_fires_new_trigger_when_due(monkeypatch):
    import studio.management.commands.run_scheduled_pipelines as scheduler_module

    user = User.objects.create_user(username="studio-schedule-user", password="x")
    pipeline = Pipeline.objects.create(name="Scheduled Pipeline", owner=user, nodes=[_llm_node("n1")], edges=[])
    trigger = PipelineTrigger.objects.create(
        pipeline=pipeline,
        node_id="schedule_start",
        trigger_type=PipelineTrigger.TYPE_SCHEDULE,
        cron_expression="0 * * * *",
        is_active=True,
    )

    now = timezone.make_aware(datetime(2026, 3, 4, 10, 0, 0))

    class FakeCroniter:
        def __init__(self, expression, base):
            assert expression == "0 * * * *"
            assert base == now

        def get_prev(self, _kind):
            return now.timestamp()

    monkeypatch.setattr(scheduler_module, "croniter", FakeCroniter)
    monkeypatch.setattr(scheduler_module.timezone, "now", lambda: now)

    fired: list[int] = []
    command = Command()
    command._fire_trigger = lambda scheduled_trigger: fired.append(scheduled_trigger.pk)
    command._tick(interval_seconds=60)

    assert fired == [trigger.pk]
