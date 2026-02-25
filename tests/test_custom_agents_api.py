import json

import pytest


@pytest.mark.django_db
def test_custom_agent_create_saves_skills_servers_and_mcp(authenticated_client, user):
    from agent_hub.models import CustomAgent
    from skills.models import Skill

    skill = Skill.objects.create(owner=user, name="Ops Skill", slug="ops-skill")
    payload = {
        "name": "Infra Agent",
        "description": "handles infra",
        "system_prompt": "infra",
        "instructions": "do it carefully",
        "knowledge_base": "kb text",
        "runtime": "invalid-runtime",
        "model": "auto",
        "orchestrator_mode": "invalid-mode",
        "allowed_tools": ["server_execute", "server_execute", "", "tasks_list"],
        "allowed_servers": [101, "202", "bad", -1],
        "max_iterations": 999,
        "temperature": 5.0,
        "completion_promise": "DONE",
        "mcp_auto_approve": True,
        "skill_ids": [skill.id, skill.id, "x"],
        "mcp_servers": {
            "zabbix": {
                "enabled": True,
                "command": "uvx",
                "args": ["mcp-zabbix"],
                "env": {"ZABBIX_URL": "https://zabbix.local", "ZABBIX_API_TOKEN": "token"},
                "description": "zabbix integration",
            },
            "broken": {
                "enabled": True
            },
        },
    }
    response = authenticated_client.post(
        "/agents/api/custom-agents/",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert response.status_code == 200, response.content
    data = response.json()
    assert data["success"] is True

    agent = CustomAgent.objects.get(id=data["agent_id"], owner=user)
    assert agent.runtime == "claude"  # fallback for invalid runtime
    assert agent.orchestrator_mode == "ralph_internal"  # fallback
    assert agent.knowledge_base == "kb text"
    assert set(agent.allowed_tools) == {"server_execute", "tasks_list"}
    assert agent.allowed_servers == [101, 202]
    assert agent.max_iterations == 100
    assert agent.temperature == 1.0
    assert agent.completion_promise == "DONE"
    assert agent.mcp_auto_approve is True
    assert list(agent.skills.values_list("id", flat=True)) == [skill.id]
    assert "zabbix" in (agent.mcp_servers or {})
    assert "broken" not in (agent.mcp_servers or {})

    detail = authenticated_client.get(f"/agents/api/custom-agents/{agent.id}/")
    assert detail.status_code == 200
    detail_data = detail.json()["agent"]
    assert detail_data["knowledge_base"] == "kb text"
    assert detail_data["skill_ids"] == [skill.id]
    assert detail_data["allowed_servers"] == [101, 202]


@pytest.mark.django_db
def test_custom_agent_update_saves_skill_ids_and_allowed_servers(authenticated_client, user):
    from agent_hub.models import CustomAgent
    from skills.models import Skill

    skill = Skill.objects.create(owner=user, name="Deploy Skill", slug="deploy-skill")
    agent = CustomAgent.objects.create(
        owner=user,
        name="A1",
        runtime="claude",
        orchestrator_mode="ralph_internal",
        allowed_tools=[],
        mcp_servers={},
    )
    response = authenticated_client.put(
        f"/agents/api/custom-agents/{agent.id}/",
        data=json.dumps(
            {
                "name": "A2",
                "runtime": "cursor",
                "orchestrator_mode": "react",
                "allowed_servers": "all",
                "allowed_tools": ["servers_list", "server_execute"],
                "skill_ids": [skill.id],
                "mcp_auto_approve": True,
                "mcp_servers": {
                    "zbx-sse": {
                        "type": "sse",
                        "url": "https://mcp.example.local/rpc",
                        "description": "remote zabbix mcp",
                    }
                },
            }
        ),
        content_type="application/json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["success"] is True

    agent.refresh_from_db()
    assert agent.name == "A2"
    assert agent.runtime == "cursor"
    assert agent.orchestrator_mode == "react"
    assert agent.allowed_servers is None
    assert set(agent.allowed_tools) == {"servers_list", "server_execute"}
    assert agent.mcp_auto_approve is True
    assert set(agent.skills.values_list("id", flat=True)) == {skill.id}
    assert "zbx-sse" in (agent.mcp_servers or {})
    assert agent.mcp_servers["zbx-sse"]["type"] == "sse"

    clear_resp = authenticated_client.put(
        f"/agents/api/custom-agents/{agent.id}/",
        data=json.dumps({"skill_ids": []}),
        content_type="application/json",
    )
    assert clear_resp.status_code == 200
    agent.refresh_from_db()
    assert list(agent.skills.values_list("id", flat=True)) == []


def test_ensure_mcp_servers_config_merges_extra_servers(tmp_path):
    from agent_hub.views import _ensure_mcp_servers_config

    cfg_path = _ensure_mcp_servers_config(
        workspace=str(tmp_path),
        user_id=77,
        extra_mcp_servers={
            "zabbix-mcp": {
                "enabled": True,
                "command": "uvx",
                "args": ["mcp-zabbix"],
                "env": {"ZABBIX_URL": "https://zabbix.local"},
                "description": "zabbix integration",
            }
        },
        auto_approve_all=True,
    )
    assert cfg_path
    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    assert "mcpServers" in cfg
    servers = cfg["mcpServers"]
    assert "weu-servers" in servers
    assert "zabbix-mcp" in servers
    assert servers["zabbix-mcp"]["command"] == "uvx"
    assert servers["zabbix-mcp"]["args"] == ["mcp-zabbix"]
    assert servers["zabbix-mcp"]["autoApprove"] == ["*"]
