"""
Pytest configuration and fixtures for WEU AI Platform.

This file is automatically loaded by pytest and provides common fixtures
for all test modules.

Note: pytest-django handles Django setup automatically via DJANGO_SETTINGS_MODULE
configured in pyproject.toml.
"""
import pytest


@pytest.fixture
def user(db):
    """Create a test user."""
    from django.contrib.auth.models import User

    user = User.objects.create_user(
        username="testuser",
        email="test@example.com",
        password="testpassword123",
    )
    return user


@pytest.fixture
def admin_user(db):
    """Create a test admin user."""
    from django.contrib.auth.models import User

    admin = User.objects.create_superuser(
        username="admin",
        email="admin@example.com",
        password="adminpassword123",
    )
    return admin


@pytest.fixture
def staff_user(db):
    """Create a test staff user (is_staff=True but not superuser)."""
    from django.contrib.auth.models import User

    staff = User.objects.create_user(
        username="staffuser",
        email="staff@example.com",
        password="staffpassword123",
        is_staff=True,
    )
    return staff


@pytest.fixture
def authenticated_client(client, user):
    """Return a Django test client logged in as a regular user."""
    client.login(username="testuser", password="testpassword123")
    return client


@pytest.fixture
def admin_client(client, admin_user):
    """Return a Django test client logged in as an admin."""
    client.login(username="admin", password="adminpassword123")
    return client


@pytest.fixture
def task(db, user):
    """Create a test task."""
    from tasks.models import Task

    task = Task.objects.create(
        title="Test Task",
        description="Test task description",
        created_by=user,
        status="TODO",
        priority="medium",
    )
    return task


@pytest.fixture
def other_user(db):
    """Create another test user for permission tests."""
    from django.contrib.auth.models import User

    other = User.objects.create_user(
        username="otheruser",
        email="other@example.com",
        password="otherpassword123",
    )
    return other


@pytest.fixture
def task_share(db, task, other_user):
    """Create a task share for permission tests."""
    from tasks.models import TaskShare

    share = TaskShare.objects.create(
        task=task,
        user=other_user,
        can_edit=False,
    )
    return share


@pytest.fixture
def server(db, user):
    """Create a test server."""
    from servers.models import Server

    server = Server.objects.create(
        name="Test Server",
        host="192.168.1.100",
        port=22,
        username="testadmin",
        user=user,
        auth_method="key",
    )
    return server


@pytest.fixture
def agent_profile(db, user):
    """Create a test agent profile."""
    from agent_hub.models import AgentProfile

    profile = AgentProfile.objects.create(
        name="Test Agent",
        description="Test agent description",
        agent_type="react",
        owner=user,
        is_active=True,
    )
    return profile


@pytest.fixture
def workflow(db, user):
    """Create a test workflow."""
    from agent_hub.models import AgentWorkflow

    workflow = AgentWorkflow.objects.create(
        name="Test Workflow",
        description="Test workflow description",
        owner=user,
        script={"steps": [{"title": "Step 1", "action": "test"}]},
    )
    return workflow
