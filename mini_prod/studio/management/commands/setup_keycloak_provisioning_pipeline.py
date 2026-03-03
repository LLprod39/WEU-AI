"""
Create a ready-to-edit Keycloak provisioning pipeline for Studio.

Usage:
    python manage.py setup_keycloak_provisioning_pipeline
    python manage.py setup_keycloak_provisioning_pipeline --username myuser

- Ensures a URL-based Keycloak MCP server entry exists for the user.
- Creates or updates a Keycloak provisioning pipeline wired to that MCP server.
- Prints the pipeline ID, webhook URL, and sample context payload.
"""

from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from studio.keycloak_provisioning import (
    KEYCLOAK_MCP_URL,
    SAMPLE_MANUAL_CONTEXT,
    ensure_keycloak_mcp_server,
    ensure_keycloak_pipeline,
)


class Command(BaseCommand):
    help = "Create a Keycloak provisioning pipeline with approval and MCP integration"

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            type=str,
            default=None,
            help="User to own the MCP server and pipeline (default: first superuser or first user).",
        )

    def handle(self, *args, **options):
        User = get_user_model()
        username = options.get("username")

        if username:
            user = User.objects.filter(username=username).first()
            if not user:
                self.stderr.write(self.style.ERROR(f"User '{username}' not found."))
                return
        else:
            user = User.objects.filter(is_superuser=True).order_by("id").first() or User.objects.order_by("id").first()
            if not user:
                self.stderr.write(self.style.ERROR("No user in database. Create one with createsuperuser first."))
                return

        mcp_server = ensure_keycloak_mcp_server(user)
        pipeline = ensure_keycloak_pipeline(user, mcp_server)
        webhook_trigger = pipeline.triggers.filter(trigger_type="webhook").order_by("id").first()

        self.stdout.write(self.style.SUCCESS(f"Keycloak MCP ready: {mcp_server.name} (ID={mcp_server.id})"))
        self.stdout.write(f"  URL: {mcp_server.url or KEYCLOAK_MCP_URL}")
        self.stdout.write(self.style.SUCCESS(f'Pipeline "{pipeline.name}" ready (ID={pipeline.id}) for user {user.username}.'))
        self.stdout.write("")
        self.stdout.write("Studio:")
        self.stdout.write("  /studio/mcp")
        self.stdout.write(f"  /studio/pipelines/{pipeline.id}")
        self.stdout.write("")
        if webhook_trigger:
            self.stdout.write("Webhook:")
            self.stdout.write(f"  /api/studio/triggers/{webhook_trigger.webhook_token}/receive/")
            self.stdout.write("")
        self.stdout.write("Manual/API context example:")
        self.stdout.write(json.dumps(SAMPLE_MANUAL_CONTEXT, ensure_ascii=False, indent=2))
        self.stdout.write("")
        self.stdout.write("Notes:")
        self.stdout.write("  1. Start the MCP service: docker compose up -d mcp-keycloak")
        self.stdout.write("  2. Configure approval email/Telegram in the human approval node or Studio notifications.")
        self.stdout.write("  3. Manual Run API accepts context JSON: POST /api/studio/pipelines/<id>/run/")
