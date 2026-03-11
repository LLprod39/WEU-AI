import pytest
from asgiref.sync import async_to_sync
from django.contrib.auth.models import User

from servers.agent_engine import AgentEngine
from servers.models import ServerAgent
from servers.multi_agent_engine import MultiAgentEngine
from studio.models import MCPServerPool, Pipeline, PipelineRun
from studio.pipeline_executor import _execute_agent_mcp_call
from studio.skill_registry import SkillDefinition


def _invalid_skill_definition() -> SkillDefinition:
    return SkillDefinition(
        slug="invalid-skill",
        name="Invalid Skill",
        description="invalid runtime policy test",
        path="/tmp/invalid/SKILL.md",
        tags=(),
        service="keycloak",
        category="",
        safety_level="",
        ui_hint="",
        guardrail_summary=(),
        recommended_tools=(),
        runtime_policy={"applicable_tool_patterns": "^keycloak_"},
        metadata={},
        content="# invalid",
    )


@pytest.mark.django_db(transaction=True)
def test_pipeline_direct_mcp_node_enforces_skill_policy_preflight_and_pinned_args(monkeypatch):
    owner = User.objects.create_user(username="pipeline-policy-user", password="x")
    pipeline = Pipeline.objects.create(name="Policy Pipeline", owner=owner, nodes=[], edges=[])
    run = PipelineRun.objects.create(pipeline=pipeline, status=PipelineRun.STATUS_PENDING, context={})
    mcp = MCPServerPool.objects.create(
        owner=owner,
        name="Keycloak Admin",
        transport=MCPServerPool.TRANSPORT_STDIO,
        command="python",
        args=["-V"],
    )

    node = {
        "id": "mcp_1",
        "type": "agent/mcp_call",
        "data": {
            "mcp_server_id": mcp.id,
            "tool_name": "keycloak_create_user",
            "arguments_text": '{"username":"alice"}',
            "skill_slugs": ["keycloak-safety", "keycloak-prod-profile"],
        },
    }

    blocked = async_to_sync(_execute_agent_mcp_call)(node=node, context={}, run=run, executed_mcp_tools=set())
    assert blocked["status"] == "failed"
    assert "required preflight" in blocked["error"]

    seen = {}

    async def fake_call_mcp_tool(server, tool_name, arguments):
        seen["server_name"] = server.name
        seen["tool_name"] = tool_name
        seen["arguments"] = dict(arguments)
        return {"isError": False, "content": [{"type": "text", "text": "ok"}]}

    monkeypatch.setattr("studio.pipeline_executor.call_mcp_tool", fake_call_mcp_tool)

    allowed = async_to_sync(_execute_agent_mcp_call)(
        node=node,
        context={},
        run=run,
        executed_mcp_tools={"keycloak_current_environment"},
    )
    assert allowed["status"] == "completed"
    assert seen["server_name"] == "Keycloak Admin"
    assert seen["tool_name"] == "keycloak_create_user"
    assert seen["arguments"]["username"] == "alice"
    assert seen["arguments"]["profile"] == "prod"


@pytest.mark.django_db(transaction=True)
def test_agent_engine_fails_fast_on_invalid_skill_policy():
    user = User.objects.create_user(username="agent-policy-user", password="x")
    agent = ServerAgent.objects.create(
        user=user,
        name="Policy Agent",
        mode=ServerAgent.MODE_FULL,
        agent_type=ServerAgent.TYPE_CUSTOM,
        commands=[],
        max_iterations=3,
    )

    engine = AgentEngine(agent=agent, servers=[], user=user, skills=[_invalid_skill_definition()])
    run = async_to_sync(engine.run)()

    assert run.status == run.STATUS_FAILED
    assert "Invalid skill policy configuration" in run.ai_analysis


@pytest.mark.django_db(transaction=True)
def test_multi_agent_engine_fails_fast_on_invalid_skill_policy():
    user = User.objects.create_user(username="multi-policy-user", password="x")
    agent = ServerAgent.objects.create(
        user=user,
        name="Multi Policy Agent",
        mode=ServerAgent.MODE_MULTI,
        agent_type=ServerAgent.TYPE_MULTI_HEALTH,
        commands=[],
        max_iterations=3,
    )

    engine = MultiAgentEngine(agent=agent, servers=[], user=user, skills=[_invalid_skill_definition()])
    run = async_to_sync(engine.run)(plan_only=True)

    assert run.status == run.STATUS_FAILED
    assert "Invalid skill policy configuration" in run.ai_analysis
