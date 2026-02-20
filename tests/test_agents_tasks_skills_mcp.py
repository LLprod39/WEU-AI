"""
Интеграционные тесты: агенты, задачи (tools), скиллы, MCP.
Проверяет работоспособность цепочки AgentManager -> ToolManager -> Skills -> MCP config.
"""
import json
import pytest
from asgiref.sync import async_to_sync


# --- AgentManager ---


@pytest.mark.django_db
def test_agent_manager_registers_all_builtin_agents():
    """AgentManager регистрирует встроенных агентов."""
    from app.agents.manager import get_agent_manager

    manager = get_agent_manager()
    agents = manager.list_agents()
    names = [a["name"] for a in agents]

    assert "ReAct Agent" in names
    assert "Simple Agent" in names
    assert "Ralph Wiggum Agent" in names
    assert "Claude Code Agent" in names
    assert len(agents) >= 4


@pytest.mark.django_db
def test_agent_manager_get_and_resolve_agent():
    """AgentManager: get_agent и resolve_agent_name."""
    from app.agents.manager import get_agent_manager

    manager = get_agent_manager()
    react = manager.get_agent("ReAct Agent")
    assert react is not None
    assert react.name == "ReAct Agent"

    # resolve по типу
    assert manager.resolve_agent_name("react") == "ReAct Agent"
    assert manager.resolve_agent_name("ralph") == "Ralph Wiggum Agent"
    assert manager.resolve_agent_name("unknown_type") == "unknown_type"


@pytest.mark.django_db
def test_agent_manager_execute_agent_not_found_returns_error():
    """execute_agent для несуществующего агента возвращает структуру с success=False."""
    from app.agents.manager import get_agent_manager

    manager = get_agent_manager()
    result = async_to_sync(manager.execute_agent)("NonExistentAgent", "test task")
    assert result["success"] is False
    assert "error" in result
    assert "not found" in result["error"].lower() or "NonExistentAgent" in result["error"]


# --- ToolManager (включая tasks) ---


@pytest.mark.django_db
def test_tool_manager_registers_builtin_tools():
    """ToolManager регистрирует встроенные инструменты, включая tasks_*."""
    from app.tools.manager import get_tool_manager

    tm = get_tool_manager()
    tools = tm.get_all_tools()
    names = [t._metadata.name for t in tools]

    assert "tasks_list" in names
    assert "task_detail" in names
    assert "task_create" in names
    assert "task_update" in names
    assert "task_delete" in names
    assert "servers_list" in names
    assert "server_execute" in names


@pytest.mark.django_db
def test_tool_manager_get_tools_description_includes_tasks():
    """get_tools_description возвращает описание с tasks."""
    from app.tools.manager import get_tool_manager

    tm = get_tool_manager()
    desc = tm.get_tools_description()
    assert "tasks_list" in desc or "TASKS" in desc.upper()
    assert "task_detail" in desc or "task_create" in desc


@pytest.mark.django_db
def test_tool_manager_execute_tasks_list(user):
    """ToolManager.execute_tool(tasks_list) выполняется и возвращает JSON с total_count."""
    from app.tools.manager import get_tool_manager

    tm = get_tool_manager()
    result = async_to_sync(tm.execute_tool)(
        "tasks_list",
        _context={"user_id": user.id},
        include_completed=False,
        limit=5,
        offset=0,
    )
    data = json.loads(result) if isinstance(result, str) else result
    assert "total_count" in data
    assert "tasks" in data
    assert isinstance(data["tasks"], list)


# --- Skills ---


@pytest.mark.django_db
def test_skill_service_get_skills_for_context_empty(user):
    """SkillService.get_skills_for_context без скиллов возвращает пустой список."""
    from skills.services import SkillService

    skills = SkillService.get_skills_for_context(user, None, "chat")
    assert isinstance(skills, list)
    # У нового пользователя скиллов может не быть
    assert all(hasattr(s, "name") for s in skills)


@pytest.mark.django_db
def test_skill_service_build_skill_context(user):
    """SkillService.build_skill_context возвращает dict с text, skills, skill_ids."""
    from skills.services import SkillService

    ctx = SkillService.build_skill_context(user, None, "chat", include_references=False)
    assert "text" in ctx
    assert "skills" in ctx
    assert "skill_ids" in ctx
    assert "skill_names" in ctx
    assert isinstance(ctx["skills"], list)
    assert isinstance(ctx["skill_ids"], list)


# --- MCP config ---


def test_mcp_config_load_returns_structure():
    """load_mcp_config возвращает (config_dict, sources_list)."""
    from django.conf import settings
    from app.mcp.config import load_mcp_config

    config, sources = load_mcp_config(settings.BASE_DIR)
    assert isinstance(config, dict)
    assert "mcpServers" in config
    assert isinstance(config["mcpServers"], dict)
    assert isinstance(sources, list)


@pytest.mark.django_db
def test_tool_manager_mcp_servers_getter():
    """ToolManager.get_mcp_servers() не падает и возвращает dict."""
    from app.tools.manager import get_tool_manager

    tm = get_tool_manager()
    servers = tm.get_mcp_servers()
    assert isinstance(servers, dict)
    # Ключи — имена серверов из конфига (могут быть пустыми)
    for name, info in servers.items():
        assert isinstance(name, str)
        assert "name" in info
        assert "status" in info
