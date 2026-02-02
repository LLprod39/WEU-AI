"""
Centralized permission checks for WEU AI Platform.

This module consolidates all permission-related logic that was previously
scattered across multiple view files. Use PermissionService for all
authorization checks.

Usage:
    from app.services.permissions import PermissionService

    if PermissionService.can_edit_task(user, task):
        # proceed with edit
"""
from typing import TYPE_CHECKING

from django.db.models import Q, QuerySet

if TYPE_CHECKING:
    from django.contrib.auth.models import User
    from tasks.models import Task
    from servers.models import Server
    from agent_hub.models import Workflow, AgentProfile


class PermissionService:
    """
    Centralized permission checking service.

    All permission checks should go through this class to ensure
    consistent authorization logic across the application.
    """

    # =========================================================================
    # Task Permissions
    # =========================================================================

    @staticmethod
    def get_tasks_for_user(user: "User") -> QuerySet:
        """
        Get QuerySet of tasks visible to user.

        A task is visible if user is:
        - Creator of the task
        - Assignee of the task
        - Has explicit share (TaskShare) for the task

        Args:
            user: Django User instance

        Returns:
            QuerySet of Task objects
        """
        from tasks.models import Task

        return Task.objects.filter(
            Q(created_by=user) | Q(assignee=user) | Q(shares__user=user)
        ).distinct()

    @staticmethod
    def can_view_task(user: "User", task: "Task") -> bool:
        """
        Check if user can view a specific task.

        Args:
            user: Django User instance
            task: Task instance to check

        Returns:
            True if user can view the task
        """
        return PermissionService.get_tasks_for_user(user).filter(pk=task.pk).exists()

    @staticmethod
    def can_edit_task(user: "User", task: "Task") -> bool:
        """
        Check if user can edit a specific task.

        User can edit if:
        - They created the task
        - They are assigned to the task
        - They have TaskShare with can_edit=True

        Args:
            user: Django User instance
            task: Task instance to check

        Returns:
            True if user can edit the task
        """
        # Owner or assignee can always edit
        if task.created_by_id == user.id or task.assignee_id == user.id:
            return True

        # Check for explicit edit permission via share
        return task.shares.filter(user=user, can_edit=True).exists()

    @staticmethod
    def can_delete_task(user: "User", task: "Task") -> bool:
        """
        Check if user can delete a specific task.

        Only the creator can delete a task.

        Args:
            user: Django User instance
            task: Task instance to check

        Returns:
            True if user can delete the task
        """
        return task.created_by_id == user.id

    # =========================================================================
    # Server Permissions
    # =========================================================================

    @staticmethod
    def get_servers_for_user(user: "User") -> QuerySet:
        """
        Get QuerySet of servers accessible to user.

        Args:
            user: Django User instance

        Returns:
            QuerySet of Server objects
        """
        from servers.models import Server

        return Server.objects.filter(user=user)

    @staticmethod
    def can_access_server(user: "User", server: "Server") -> bool:
        """
        Check if user can access a specific server.

        Args:
            user: Django User instance
            server: Server instance to check

        Returns:
            True if user can access the server
        """
        return server.user_id == user.id

    @staticmethod
    def can_execute_on_server(user: "User", server: "Server") -> bool:
        """
        Check if user can execute commands on a server.

        Currently same as can_access_server, but separated for future
        granular permissions (e.g., read-only access).

        Args:
            user: Django User instance
            server: Server instance to check

        Returns:
            True if user can execute commands
        """
        return PermissionService.can_access_server(user, server)

    # =========================================================================
    # Workflow Permissions
    # =========================================================================

    @staticmethod
    def get_workflows_for_user(user: "User") -> QuerySet:
        """
        Get QuerySet of workflows accessible to user.

        Args:
            user: Django User instance

        Returns:
            QuerySet of Workflow objects
        """
        from agent_hub.models import Workflow

        return Workflow.objects.filter(created_by=user)

    @staticmethod
    def can_view_workflow(user: "User", workflow: "Workflow") -> bool:
        """
        Check if user can view a specific workflow.

        Args:
            user: Django User instance
            workflow: Workflow instance to check

        Returns:
            True if user can view the workflow
        """
        return workflow.created_by_id == user.id

    @staticmethod
    def can_run_workflow(user: "User", workflow: "Workflow") -> bool:
        """
        Check if user can run a specific workflow.

        Args:
            user: Django User instance
            workflow: Workflow instance to check

        Returns:
            True if user can run the workflow
        """
        return PermissionService.can_view_workflow(user, workflow)

    @staticmethod
    def can_edit_workflow(user: "User", workflow: "Workflow") -> bool:
        """
        Check if user can edit a specific workflow.

        Args:
            user: Django User instance
            workflow: Workflow instance to check

        Returns:
            True if user can edit the workflow
        """
        return workflow.created_by_id == user.id

    # =========================================================================
    # Agent Permissions
    # =========================================================================

    @staticmethod
    def get_agents_for_user(user: "User") -> QuerySet:
        """
        Get QuerySet of agent profiles accessible to user.

        Args:
            user: Django User instance

        Returns:
            QuerySet of AgentProfile objects
        """
        from agent_hub.models import AgentProfile

        return AgentProfile.objects.filter(
            Q(is_builtin=True) | Q(created_by=user)
        )

    @staticmethod
    def can_use_agent(user: "User", agent: "AgentProfile") -> bool:
        """
        Check if user can use a specific agent.

        Users can use:
        - Built-in agents
        - Agents they created

        Args:
            user: Django User instance
            agent: AgentProfile instance to check

        Returns:
            True if user can use the agent
        """
        if agent.is_builtin:
            return True
        return agent.created_by_id == user.id

    @staticmethod
    def can_edit_agent(user: "User", agent: "AgentProfile") -> bool:
        """
        Check if user can edit a specific agent profile.

        Only custom agents created by the user can be edited.
        Built-in agents cannot be edited.

        Args:
            user: Django User instance
            agent: AgentProfile instance to check

        Returns:
            True if user can edit the agent
        """
        if agent.is_builtin:
            return False
        return agent.created_by_id == user.id


# =============================================================================
# Backward Compatibility Aliases
# =============================================================================
# These functions maintain compatibility with existing code.
# New code should use PermissionService directly.


def _tasks_queryset_for_user(user: "User") -> QuerySet:
    """Alias for PermissionService.get_tasks_for_user()."""
    return PermissionService.get_tasks_for_user(user)


def _user_can_see_task(user: "User", task: "Task") -> bool:
    """Alias for PermissionService.can_view_task()."""
    return PermissionService.can_view_task(user, task)


def _user_can_edit_task(user: "User", task: "Task") -> bool:
    """Alias for PermissionService.can_edit_task()."""
    return PermissionService.can_edit_task(user, task)
