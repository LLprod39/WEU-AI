"""
Tests for PermissionService.

These tests verify the permission checking logic for tasks, servers,
and workflows.
"""
import pytest
from django.contrib.auth.models import User

from app.services.permissions import (
    PermissionService,
    _user_can_see_task,
    _user_can_edit_task,
)


@pytest.mark.django_db
class TestTaskPermissions:
    """Tests for task permission checks."""

    def test_creator_can_view_task(self, user, task):
        """Task creator can view their own task."""
        assert PermissionService.can_view_task(user, task) is True

    def test_creator_can_edit_task(self, user, task):
        """Task creator can edit their own task."""
        assert PermissionService.can_edit_task(user, task) is True

    def test_creator_can_delete_task(self, user, task):
        """Task creator can delete their own task."""
        assert PermissionService.can_delete_task(user, task) is True

    def test_other_user_cannot_view_task(self, other_user, task):
        """Other users cannot view tasks they don't own or have access to."""
        assert PermissionService.can_view_task(other_user, task) is False

    def test_other_user_cannot_edit_task(self, other_user, task):
        """Other users cannot edit tasks they don't own."""
        assert PermissionService.can_edit_task(other_user, task) is False

    def test_other_user_cannot_delete_task(self, other_user, task):
        """Other users cannot delete tasks they don't own."""
        assert PermissionService.can_delete_task(other_user, task) is False

    def test_shared_user_can_view_task(self, other_user, task, task_share):
        """User with TaskShare can view the task."""
        assert PermissionService.can_view_task(other_user, task) is True

    def test_shared_user_cannot_edit_without_permission(
        self, other_user, task, task_share
    ):
        """User with TaskShare without can_edit cannot edit."""
        assert task_share.can_edit is False
        assert PermissionService.can_edit_task(other_user, task) is False

    def test_shared_user_can_edit_with_permission(self, other_user, task, task_share):
        """User with TaskShare with can_edit=True can edit."""
        task_share.can_edit = True
        task_share.save()
        assert PermissionService.can_edit_task(other_user, task) is True

    def test_assignee_can_view_task(self, other_user, task):
        """Assignee can view the task."""
        task.assignee = other_user
        task.save()
        assert PermissionService.can_view_task(other_user, task) is True

    def test_assignee_can_edit_task(self, other_user, task):
        """Assignee can edit the task."""
        task.assignee = other_user
        task.save()
        assert PermissionService.can_edit_task(other_user, task) is True

    def test_get_tasks_for_user_includes_owned(self, user, task):
        """get_tasks_for_user includes tasks created by user."""
        tasks = PermissionService.get_tasks_for_user(user)
        assert task in tasks

    def test_get_tasks_for_user_includes_assigned(self, other_user, task):
        """get_tasks_for_user includes tasks assigned to user."""
        task.assignee = other_user
        task.save()
        tasks = PermissionService.get_tasks_for_user(other_user)
        assert task in tasks

    def test_get_tasks_for_user_includes_shared(self, other_user, task, task_share):
        """get_tasks_for_user includes shared tasks."""
        tasks = PermissionService.get_tasks_for_user(other_user)
        assert task in tasks

    def test_get_tasks_for_user_excludes_unrelated(self, other_user, task):
        """get_tasks_for_user excludes unrelated tasks."""
        tasks = PermissionService.get_tasks_for_user(other_user)
        assert task not in tasks


@pytest.mark.django_db
class TestServerPermissions:
    """Tests for server permission checks."""

    def test_owner_can_access_server(self, user, server):
        """Server owner can access their server."""
        assert PermissionService.can_access_server(user, server) is True

    def test_owner_can_execute_on_server(self, user, server):
        """Server owner can execute commands on their server."""
        assert PermissionService.can_execute_on_server(user, server) is True

    def test_other_user_cannot_access_server(self, other_user, server):
        """Other users cannot access servers they don't own."""
        assert PermissionService.can_access_server(other_user, server) is False

    def test_other_user_cannot_execute_on_server(self, other_user, server):
        """Other users cannot execute on servers they don't own."""
        assert PermissionService.can_execute_on_server(other_user, server) is False

    def test_get_servers_for_user(self, user, server):
        """get_servers_for_user returns user's servers."""
        servers = PermissionService.get_servers_for_user(user)
        assert server in servers

    def test_get_servers_for_user_excludes_others(self, other_user, server):
        """get_servers_for_user excludes other users' servers."""
        servers = PermissionService.get_servers_for_user(other_user)
        assert server not in servers


@pytest.mark.django_db
class TestBackwardCompatibility:
    """Tests for backward compatibility aliases."""

    def test_user_can_see_task_alias(self, user, task):
        """_user_can_see_task works like can_view_task."""
        assert _user_can_see_task(user, task) == PermissionService.can_view_task(
            user, task
        )

    def test_user_can_edit_task_alias(self, user, task):
        """_user_can_edit_task works like can_edit_task."""
        assert _user_can_edit_task(user, task) == PermissionService.can_edit_task(
            user, task
        )
