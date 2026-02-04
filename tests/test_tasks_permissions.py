"""
Тесты прав доступа к проектам и задачам (tasks.permissions).
"""
import pytest
from django.contrib.auth.models import User

from tasks.models import Project, ProjectMember, ProjectMemberRole, Task
from tasks.permissions import (
    ProjectPermissions,
    TaskPermissions,
    get_projects_for_user,
    get_tasks_for_user,
)


@pytest.fixture
def project_owner(db):
    """Владелец проекта."""
    return User.objects.create_user(
        username="owner",
        email="owner@example.com",
        password="pass123",
    )


@pytest.fixture
def project_member_user(db):
    """Участник проекта (роль member)."""
    return User.objects.create_user(
        username="member",
        email="member@example.com",
        password="pass123",
    )


@pytest.fixture
def project_admin_user(db):
    """Администратор проекта."""
    return User.objects.create_user(
        username="admin",
        email="admin@example.com",
        password="pass123",
    )


@pytest.fixture
def project_viewer_user(db):
    """Наблюдатель проекта."""
    return User.objects.create_user(
        username="viewer",
        email="viewer@example.com",
        password="pass123",
    )


@pytest.fixture
def outsider_user(db):
    """Пользователь не из проекта."""
    return User.objects.create_user(
        username="outsider",
        email="outsider@example.com",
        password="pass123",
    )


@pytest.fixture
def project(db, project_owner):
    """Проект с владельцем."""
    proj = Project.objects.create(
        name="Test Project",
        key="TST",
        owner=project_owner,
        is_public=False,
    )
    ProjectMember.objects.create(
        project=proj,
        user=project_owner,
        role=ProjectMemberRole.OWNER,
    )
    return proj


@pytest.fixture
def project_with_members(db, project, project_owner, project_admin_user, project_member_user, project_viewer_user):
    """Проект с владельцем, админом, участником и наблюдателем."""
    ProjectMember.objects.create(
        project=project,
        user=project_admin_user,
        role=ProjectMemberRole.ADMIN,
    )
    ProjectMember.objects.create(
        project=project,
        user=project_member_user,
        role=ProjectMemberRole.MEMBER,
    )
    ProjectMember.objects.create(
        project=project,
        user=project_viewer_user,
        role=ProjectMemberRole.VIEWER,
    )
    return project


@pytest.fixture
def project_task(db, project_with_members, project_owner):
    """Задача в проекте (создана владельцем)."""
    return Task.objects.create(
        title="Project Task",
        description="Task in project",
        status="TODO",
        priority="MEDIUM",
        project=project_with_members,
        created_by=project_owner,
    )


@pytest.mark.django_db
class TestProjectPermissions:
    """Тесты ProjectPermissions."""

    def test_owner_can_view_project(self, project, project_owner):
        assert ProjectPermissions.can_view(project_owner, project) is True

    def test_owner_can_edit_project(self, project, project_owner):
        assert ProjectPermissions.can_edit(project_owner, project) is True

    def test_owner_can_manage_members(self, project, project_owner):
        assert ProjectPermissions.can_manage_members(project_owner, project) is True

    def test_owner_can_create_task(self, project, project_owner):
        assert ProjectPermissions.can_create_task(project_owner, project) is True

    def test_owner_can_delete_project(self, project, project_owner):
        assert ProjectPermissions.can_delete_project(project_owner, project) is True

    def test_admin_can_edit_project(self, project_with_members, project_admin_user):
        assert ProjectPermissions.can_edit(project_admin_user, project_with_members) is True

    def test_admin_can_manage_members(self, project_with_members, project_admin_user):
        assert ProjectPermissions.can_manage_members(project_admin_user, project_with_members) is True

    def test_member_can_create_task_but_not_edit_project(
        self, project_with_members, project_member_user
    ):
        assert ProjectPermissions.can_create_task(project_member_user, project_with_members) is True
        assert ProjectPermissions.can_edit(project_member_user, project_with_members) is False
        assert ProjectPermissions.can_manage_members(project_member_user, project_with_members) is False

    def test_viewer_can_view_but_not_create_task(
        self, project_with_members, project_viewer_user
    ):
        assert ProjectPermissions.can_view(project_viewer_user, project_with_members) is True
        assert ProjectPermissions.can_create_task(project_viewer_user, project_with_members) is False

    def test_outsider_cannot_view_private_project(self, project, outsider_user):
        assert ProjectPermissions.can_view(outsider_user, project) is False

    def test_outsider_can_view_public_project(self, project, outsider_user):
        project.is_public = True
        project.save()
        assert ProjectPermissions.can_view(outsider_user, project) is True

    def test_outsider_cannot_edit_public_project(self, project, outsider_user):
        project.is_public = True
        project.save()
        assert ProjectPermissions.can_edit(outsider_user, project) is False


@pytest.mark.django_db
class TestTaskPermissions:
    """Тесты TaskPermissions для задач в проекте."""

    def test_owner_can_view_edit_task(self, project_task, project_owner):
        assert TaskPermissions.can_view(project_owner, project_task) is True
        assert TaskPermissions.can_edit(project_owner, project_task) is True

    def test_member_can_view_but_not_edit_task_created_by_owner(
        self, project_task, project_member_user
    ):
        assert TaskPermissions.can_view(project_member_user, project_task) is True
        # Редактировать может только создатель, исполнитель или admin/owner
        assert TaskPermissions.can_edit(project_member_user, project_task) is False

    def test_member_can_assign_task(self, project_task, project_with_members, project_member_user):
        assert TaskPermissions.can_assign(project_member_user, project_task) is True

    def test_viewer_can_view_but_not_edit(
        self, project_task, project_viewer_user
    ):
        assert TaskPermissions.can_view(project_viewer_user, project_task) is True
        assert TaskPermissions.can_edit(project_viewer_user, project_task) is False

    def test_outsider_cannot_view_project_task(
        self, project_task, outsider_user
    ):
        assert TaskPermissions.can_view(outsider_user, project_task) is False
        assert TaskPermissions.can_edit(outsider_user, project_task) is False


@pytest.mark.django_db
class TestGetProjectsForUser:
    """Тесты get_projects_for_user."""

    def test_includes_owned_project(self, project, project_owner):
        projects = list(get_projects_for_user(project_owner))
        assert project in projects

    def test_includes_project_where_member(self, project_with_members, project_member_user):
        projects = list(get_projects_for_user(project_member_user))
        assert project_with_members in projects

    def test_includes_public_project(self, project, outsider_user):
        project.is_public = True
        project.save()
        projects = list(get_projects_for_user(outsider_user))
        assert project in projects

    def test_excludes_private_project_for_outsider(self, project, outsider_user):
        projects = list(get_projects_for_user(outsider_user))
        assert project not in projects


@pytest.mark.django_db
class TestGetTasksForUser:
    """Тесты get_tasks_for_user."""

    def test_includes_project_task_for_member(self, project_task, project_member_user):
        tasks = list(get_tasks_for_user(project_member_user, project=project_task.project))
        assert project_task in tasks

    def test_excludes_project_task_for_outsider(self, project_task, outsider_user):
        tasks = list(get_tasks_for_user(outsider_user))
        assert project_task not in tasks
