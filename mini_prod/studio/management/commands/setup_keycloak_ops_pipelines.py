"""
Create two direct Keycloak operator pipelines for Studio: TEST and PROD.

Usage:
    python manage.py setup_keycloak_ops_pipelines
    python manage.py setup_keycloak_ops_pipelines --username myuser
"""

from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from studio.keycloak_provisioning import (
    KEYCLOAK_MCP_URL,
    KEYCLOAK_OPS_PIPELINE_SPECS,
    SAMPLE_BULK_TASK_CONTEXT,
    SAMPLE_TASK_CONTEXT,
    ensure_keycloak_mcp_server,
    ensure_keycloak_ops_pipelines,
)


class Command(BaseCommand):
    help = "Create direct Keycloak TEST and PROD pipelines with MCP integration and no notifications"

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            type=str,
            default=None,
            help="User to own the MCP server and pipelines (default: first superuser or first user).",
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
        pipelines = ensure_keycloak_ops_pipelines(user, mcp_server)

        self.stdout.write(self.style.SUCCESS(f"Keycloak MCP ready: {mcp_server.name} (ID={mcp_server.id})"))
        self.stdout.write(f"  URL: {mcp_server.url or KEYCLOAK_MCP_URL}")
        self.stdout.write("")

        for profile_name, spec in KEYCLOAK_OPS_PIPELINE_SPECS.items():
            pipeline = pipelines[profile_name]
            webhook_trigger = pipeline.triggers.filter(trigger_type="webhook").order_by("id").first()
            self.stdout.write(self.style.SUCCESS(f'{spec["name"]} ready (ID={pipeline.id}) for user {user.username}.'))
            self.stdout.write(f"  Studio: /studio/pipelines/{pipeline.id}")
            if webhook_trigger:
                self.stdout.write(f"  Webhook: /api/studio/triggers/{webhook_trigger.webhook_token}/receive/")
            self.stdout.write("")

        self.stdout.write("Manual/API context example:")
        self.stdout.write(json.dumps(SAMPLE_TASK_CONTEXT, ensure_ascii=False, indent=2))
        self.stdout.write("")
        self.stdout.write("Bulk request example:")
        self.stdout.write(json.dumps(SAMPLE_BULK_TASK_CONTEXT, ensure_ascii=False, indent=2))
        self.stdout.write("")
        self.stdout.write("Notes:")
        self.stdout.write("  1. Start the MCP service: docker compose up -d mcp-keycloak")
        self.stdout.write("  2. These pipelines do not send approval emails or Telegram messages.")
        self.stdout.write("  3. TEST pipeline is fixed to profile 'test'; PROD pipeline is fixed to profile 'prod'.")
        self.stdout.write("  4. Manual Run API accepts context JSON: POST /api/studio/pipelines/<id>/run/")
