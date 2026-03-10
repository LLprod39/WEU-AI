import json
from types import SimpleNamespace

import pytest
from django.contrib.auth.models import User
from django.test import Client
from django.utils import timezone

from servers.models import (
    AgentRun,
    Server,
    ServerAlert,
    ServerHealthCheck,
)


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _create_server(user: User, **kwargs) -> Server:
    return Server.objects.create(
        user=user,
        name=kwargs.pop("name", "srv-01"),
        host=kwargs.pop("host", "10.0.0.11"),
        username=kwargs.pop("username", "root"),
        auth_method=kwargs.pop("auth_method", "password"),
        **kwargs,
    )


@pytest.mark.django_db
def test_group_server_and_context_crud_endpoints():
    user = User.objects.create_user(username="servers-user", password="x")
    teammate = User.objects.create_user(username="teammate", password="x")
    client = Client()
    client.force_login(user)

    create_group = client.post(
        "/servers/api/groups/create/",
        data=_json({"name": "prod", "description": "production"}),
        content_type="application/json",
    )
    assert create_group.status_code == 200
    group_id = create_group.json()["group_id"]

    update_group = client.post(
        f"/servers/api/groups/{group_id}/update/",
        data=_json({"name": "prod-updated", "color": "#111111"}),
        content_type="application/json",
    )
    assert update_group.status_code == 200
    assert update_group.json()["success"] is True

    add_member = client.post(
        f"/servers/api/groups/{group_id}/add-member/",
        data=_json({"user": teammate.username, "role": "member"}),
        content_type="application/json",
    )
    assert add_member.status_code == 200
    assert add_member.json()["success"] is True

    remove_member = client.post(
        f"/servers/api/groups/{group_id}/remove-member/",
        data=_json({"user_id": teammate.id}),
        content_type="application/json",
    )
    assert remove_member.status_code == 200
    assert remove_member.json()["success"] is True

    subscribe = client.post(
        f"/servers/api/groups/{group_id}/subscribe/",
        data=_json({"kind": "favorite"}),
        content_type="application/json",
    )
    assert subscribe.status_code == 200
    assert subscribe.json()["success"] is True

    create_server = client.post(
        "/servers/api/create/",
        data=_json(
            {
                "name": "web-01",
                "host": "10.0.0.21",
                "port": 22,
                "username": "root",
                "group_id": group_id,
                "server_type": "ssh",
                "auth_method": "password",
            }
        ),
        content_type="application/json",
    )
    assert create_server.status_code == 200
    server_id = create_server.json()["server_id"]

    bootstrap = client.get("/servers/api/frontend/bootstrap/")
    assert bootstrap.status_code == 200
    assert bootstrap.json()["success"] is True
    assert any(item["id"] == server_id for item in bootstrap.json()["servers"])

    details = client.get(f"/servers/api/{server_id}/get/")
    assert details.status_code == 200
    assert details.json()["name"] == "web-01"

    update_server = client.post(
        f"/servers/api/{server_id}/update/",
        data=_json(
            {
                "name": "web-01-updated",
                "network_config": {"proxy": {"http_proxy": "http://proxy.local:8080"}},
                "tags": "prod,ssh",
            }
        ),
        content_type="application/json",
    )
    assert update_server.status_code == 200
    assert update_server.json()["success"] is True

    bulk_update = client.post(
        "/servers/api/bulk-update/",
        data=_json({"server_ids": [server_id], "tags": "prod,critical", "is_active": True}),
        content_type="application/json",
    )
    assert bulk_update.status_code == 200
    assert bulk_update.json()["success"] is True

    save_global = client.post(
        "/servers/api/global-context/save/",
        data=_json({"rules": "Do backups", "forbidden_commands": ["rm -rf /"]}),
        content_type="application/json",
    )
    assert save_global.status_code == 200
    assert save_global.json()["success"] is True

    global_ctx = client.get("/servers/api/global-context/")
    assert global_ctx.status_code == 200
    assert global_ctx.json()["rules"] == "Do backups"

    save_group_ctx = client.post(
        f"/servers/api/groups/{group_id}/context/save/",
        data=_json({"rules": "Only change in maintenance window", "forbidden_commands": ["reboot"]}),
        content_type="application/json",
    )
    assert save_group_ctx.status_code == 200
    assert save_group_ctx.json()["success"] is True

    group_ctx = client.get(f"/servers/api/groups/{group_id}/context/")
    assert group_ctx.status_code == 200
    assert group_ctx.json()["rules"] == "Only change in maintenance window"

    delete_server = client.post(f"/servers/api/{server_id}/delete/")
    assert delete_server.status_code == 200
    assert delete_server.json()["success"] is True

    delete_group = client.post(f"/servers/api/groups/{group_id}/delete/")
    assert delete_group.status_code == 200
    assert delete_group.json()["success"] is True


@pytest.mark.django_db
def test_share_master_password_and_knowledge_endpoints(monkeypatch):
    owner = User.objects.create_user(username="owner", password="x")
    teammate = User.objects.create_user(username="shared-user", password="x")
    client = Client()
    client.force_login(owner)

    server = _create_server(owner, name="share-me", server_type="ssh", port=22)

    create_share = client.post(
        f"/servers/api/{server.id}/share/",
        data=_json({"user": teammate.username, "share_context": True}),
        content_type="application/json",
    )
    assert create_share.status_code == 200
    share_id = create_share.json()["share"]["id"]

    shares = client.get(f"/servers/api/{server.id}/shares/")
    assert shares.status_code == 200
    assert len(shares.json()["shares"]) == 1

    revoke = client.post(f"/servers/api/{server.id}/shares/{share_id}/revoke/")
    assert revoke.status_code == 200
    assert revoke.json()["success"] is True

    set_mp = client.post(
        "/servers/api/master-password/set/",
        data=_json({"master_password": "master-secret"}),
        content_type="application/json",
    )
    assert set_mp.status_code == 200
    assert set_mp.json()["success"] is True

    has_mp = client.get("/servers/api/master-password/check/")
    assert has_mp.status_code == 200
    assert has_mp.json()["has_master_password"] is True

    clear_mp = client.post("/servers/api/master-password/clear/")
    assert clear_mp.status_code == 200
    assert clear_mp.json()["success"] is True

    create_knowledge = client.post(
        f"/servers/api/{server.id}/knowledge/create/",
        data=_json({"title": "Nginx path", "content": "/etc/nginx/nginx.conf", "category": "config"}),
        content_type="application/json",
    )
    assert create_knowledge.status_code == 200
    knowledge_id = create_knowledge.json()["id"]

    list_knowledge = client.get(f"/servers/api/{server.id}/knowledge/")
    assert list_knowledge.status_code == 200
    assert list_knowledge.json()["success"] is True
    assert len(list_knowledge.json()["items"]) == 1

    update_knowledge = client.post(
        f"/servers/api/{server.id}/knowledge/{knowledge_id}/update/",
        data=_json({"title": "Nginx main config", "is_active": False, "confidence": 0.6}),
        content_type="application/json",
    )
    assert update_knowledge.status_code == 200
    assert update_knowledge.json()["success"] is True

    delete_knowledge = client.post(
        f"/servers/api/{server.id}/knowledge/{knowledge_id}/delete/",
        content_type="application/json",
    )
    assert delete_knowledge.status_code == 200
    assert delete_knowledge.json()["success"] is True

    server.auth_method = "password"
    server.encrypted_password = "ciphertext"
    server.salt = b"12345678"
    server.save(update_fields=["auth_method", "encrypted_password", "salt"])

    monkeypatch.setattr(
        "servers.views.PasswordEncryption.decrypt_password",
        lambda *_args, **_kwargs: "plain-password",
    )
    reveal = client.post(
        f"/servers/api/{server.id}/reveal-password/",
        data=_json({"master_password": "master-secret"}),
        content_type="application/json",
    )
    assert reveal.status_code == 200
    assert reveal.json()["success"] is True
    assert reveal.json()["password"] == "plain-password"


@pytest.mark.django_db
def test_server_test_and_execute_endpoints_use_mocked_ssh(monkeypatch):
    user = User.objects.create_user(username="ssh-user", password="x")
    client = Client()
    client.force_login(user)
    server = _create_server(user, name="ssh-node", server_type="ssh", port=22)

    async def fake_connect(*_args, **_kwargs):
        return "conn-1"

    async def fake_disconnect(_conn_id):
        return None

    async def fake_execute(self, conn_id, command, allow_destructive=False):
        assert conn_id == "conn-1"
        assert command == "uname -a"
        assert allow_destructive is False
        return {"stdout": "Linux test\n", "stderr": "", "exit_code": 0, "success": True}

    monkeypatch.setattr("servers.views.ssh_manager.connect", fake_connect)
    monkeypatch.setattr("servers.views.ssh_manager.disconnect", fake_disconnect)
    monkeypatch.setattr("app.tools.ssh_tools.SSHExecuteTool.execute", fake_execute)
    monkeypatch.setattr("servers.views.ServerCommandHistory.objects.create", lambda *args, **kwargs: None)

    test_connection = client.post(
        f"/servers/api/{server.id}/test/",
        data=_json({}),
        content_type="application/json",
    )
    assert test_connection.status_code == 200
    assert test_connection.json()["success"] is True

    execute = client.post(
        f"/servers/api/{server.id}/execute/",
        data=_json({"command": "uname -a"}),
        content_type="application/json",
    )
    assert execute.status_code == 200
    assert execute.json()["success"] is True
    assert execute.json()["output"]["exit_code"] == 0


@pytest.mark.django_db
def test_monitoring_alerts_and_ai_analyze_endpoints(monkeypatch):
    user = User.objects.create_user(username="monitor-user", password="x")
    staff = User.objects.create_user(username="monitor-staff", password="x", is_staff=True)
    client = Client()
    client.force_login(user)
    server = _create_server(user, name="monitored", server_type="ssh")

    existing_check = ServerHealthCheck.objects.create(
        server=server,
        status=ServerHealthCheck.STATUS_WARNING,
        cpu_percent=81.0,
        memory_percent=72.0,
        disk_percent=66.0,
    )
    alert = ServerAlert.objects.create(
        server=server,
        alert_type=ServerAlert.TYPE_CPU,
        severity=ServerAlert.SEVERITY_WARNING,
        title="CPU high",
        message="CPU usage above warning threshold",
    )

    dashboard = client.get("/servers/api/monitoring/dashboard/")
    assert dashboard.status_code == 200
    assert dashboard.json()["success"] is True

    history = client.get(f"/servers/api/{server.id}/health/?hours=24")
    assert history.status_code == 200
    assert history.json()["success"] is True
    assert history.json()["checks"][0]["id"] == existing_check.id

    async def fake_check_server(_target_server, deep=False):
        return SimpleNamespace(
            id=999,
            status=ServerHealthCheck.STATUS_HEALTHY,
            cpu_percent=30.0,
            memory_percent=45.0,
            disk_percent=40.0,
            load_1m=0.2,
            is_deep=deep,
            response_time_ms=12,
            checked_at=timezone.now(),
        )

    monkeypatch.setattr("servers.monitor.check_server", fake_check_server)

    check_now = client.post(
        f"/servers/api/{server.id}/health/check/",
        data=_json({"deep": True}),
        content_type="application/json",
    )
    assert check_now.status_code == 200
    assert check_now.json()["success"] is True
    assert check_now.json()["check"]["status"] == ServerHealthCheck.STATUS_HEALTHY

    list_alerts = client.get("/servers/api/alerts/")
    assert list_alerts.status_code == 200
    assert list_alerts.json()["success"] is True
    assert any(item["id"] == alert.id for item in list_alerts.json()["alerts"])

    resolve = client.post(f"/servers/api/alerts/{alert.id}/resolve/")
    assert resolve.status_code == 200
    assert resolve.json()["success"] is True

    async def fake_stream_chat(self, prompt: str, model: str = "auto", purpose: str = "chat"):
        assert "Проанализируй сервер" in prompt
        yield "## Резюме\nСервер стабилен."

    monkeypatch.setattr("app.core.llm.LLMProvider.stream_chat", fake_stream_chat, raising=False)

    ai = client.post(f"/servers/api/{server.id}/ai-analyze/", data=_json({}), content_type="application/json")
    assert ai.status_code == 200
    assert ai.json()["success"] is True
    assert "Резюме" in ai.json()["analysis"]

    staff_client = Client()
    staff_client.force_login(staff)

    mon_cfg_get = staff_client.get("/servers/api/monitoring/config/")
    assert mon_cfg_get.status_code == 200
    assert mon_cfg_get.json()["success"] is True

    mon_cfg_post = staff_client.post(
        "/servers/api/monitoring/config/",
        data=_json({"thresholds": {"cpu_warn": 75, "cpu_crit": 90}}),
        content_type="application/json",
    )
    assert mon_cfg_post.status_code == 200
    assert mon_cfg_post.json()["success"] is True


@pytest.mark.django_db
def test_agent_endpoints_crud_run_and_control_flow(monkeypatch):
    user = User.objects.create_user(username="agent-user", password="x")
    client = Client()
    client.force_login(user)
    server = _create_server(user, name="agent-srv", server_type="ssh")

    templates = client.get("/servers/api/agents/templates/")
    assert templates.status_code == 200
    assert templates.json()["success"] is True

    create_agent = client.post(
        "/servers/api/agents/create/",
        data=_json(
            {
                "mode": "mini",
                "agent_type": "custom",
                "name": "Ops Agent",
                "commands": ["uname -a"],
                "server_ids": [server.id],
            }
        ),
        content_type="application/json",
    )
    assert create_agent.status_code == 200
    assert create_agent.json()["success"] is True
    agent_id = create_agent.json()["id"]

    list_agents = client.get("/servers/api/agents/")
    assert list_agents.status_code == 200
    assert list_agents.json()["success"] is True
    assert any(item["id"] == agent_id for item in list_agents.json()["agents"])

    update_agent = client.post(
        f"/servers/api/agents/{agent_id}/update/",
        data=_json({"name": "Ops Agent v2", "max_iterations": 25}),
        content_type="application/json",
    )
    assert update_agent.status_code == 200
    assert update_agent.json()["success"] is True

    def _build_run(status: str) -> AgentRun:
        return AgentRun.objects.create(
            agent_id=agent_id,
            server=server,
            user=user,
            status=status,
            ai_analysis="ok",
            commands_output=[{"cmd": "uname -a", "stdout": "Linux"}],
        )

    completed_run = _build_run(AgentRun.STATUS_COMPLETED)

    async def fake_run_agent_on_all_servers(_agent, _user):
        return [completed_run]

    monkeypatch.setattr("servers.agents.run_agent_on_all_servers", fake_run_agent_on_all_servers)

    run_agent = client.post(
        f"/servers/api/agents/{agent_id}/run/",
        data=_json({}),
        content_type="application/json",
    )
    assert run_agent.status_code == 200
    assert run_agent.json()["success"] is True
    run_id = run_agent.json()["runs"][0]["run_id"]

    runs = client.get(f"/servers/api/agents/{agent_id}/runs/")
    assert runs.status_code == 200
    assert runs.json()["success"] is True

    run_detail = client.get(f"/servers/api/agents/runs/{run_id}/")
    assert run_detail.status_code == 200
    assert run_detail.json()["success"] is True

    run_log = client.get(f"/servers/api/agents/runs/{run_id}/log/")
    assert run_log.status_code == 200
    assert run_log.json()["success"] is True

    waiting_run = _build_run(AgentRun.STATUS_WAITING)
    waiting_run.pending_question = "Need approval?"
    waiting_run.save(update_fields=["pending_question"])

    reply = client.post(
        f"/servers/api/agents/runs/{waiting_run.id}/reply/",
        data=_json({"answer": "Proceed"}),
        content_type="application/json",
    )
    assert reply.status_code == 200
    assert reply.json()["success"] is True

    running_run = _build_run(AgentRun.STATUS_RUNNING)
    stop = client.post(f"/servers/api/agents/{agent_id}/stop/")
    assert stop.status_code == 200
    assert stop.json()["success"] is True
    running_run.refresh_from_db()
    assert running_run.status == AgentRun.STATUS_STOPPED

    editable_run = _build_run(AgentRun.STATUS_PLAN_REVIEW)
    editable_run.plan_tasks = [
        {"id": 1, "name": "Check logs", "description": "Inspect journalctl", "status": "pending"}
    ]
    editable_run.save(update_fields=["plan_tasks"])

    update_task = client.post(
        f"/servers/api/agents/runs/{editable_run.id}/tasks/1/update/",
        data=_json({"action": "update", "name": "Check logs and disk"}),
        content_type="application/json",
    )
    assert update_task.status_code == 200
    assert update_task.json()["success"] is True
    assert update_task.json()["plan_tasks"][0]["name"] == "Check logs and disk"

    async def fake_stream_chat(self, prompt: str, model: str = "auto", purpose: str = "chat"):
        assert "Верни ТОЛЬКО JSON-объект" in prompt
        yield '{"name":"Refined task","description":"Updated by AI"}'

    monkeypatch.setattr("app.core.llm.LLMProvider.stream_chat", fake_stream_chat, raising=False)

    refine_task = client.post(
        f"/servers/api/agents/runs/{editable_run.id}/tasks/1/ai-refine/",
        data=_json({"instruction": "Сделай задачу точнее"}),
        content_type="application/json",
    )
    assert refine_task.status_code == 200
    assert refine_task.json()["success"] is True
    assert refine_task.json()["task"]["name"] == "Refined task"

    dashboard = client.get("/servers/api/agents/dashboard/")
    assert dashboard.status_code == 200
    assert dashboard.json()["success"] is True

    delete_agent = client.post(f"/servers/api/agents/{agent_id}/delete/")
    assert delete_agent.status_code == 200
    assert delete_agent.json()["success"] is True
