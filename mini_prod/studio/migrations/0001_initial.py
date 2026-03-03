import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("servers", "0013_add_plan_review_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="MCPServerPool",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100)),
                ("description", models.TextField(blank=True)),
                (
                    "transport",
                    models.CharField(
                        choices=[("stdio", "stdio (subprocess)"), ("sse", "SSE (HTTP stream)")],
                        default="stdio",
                        max_length=10,
                    ),
                ),
                ("command", models.CharField(blank=True, help_text='e.g. "npx" or "python"', max_length=500)),
                (
                    "args",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text='e.g. ["-y", "@modelcontextprotocol/server-github"]',
                    ),
                ),
                (
                    "env",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text='Environment variables, e.g. {"GITHUB_TOKEN": "..."}',
                    ),
                ),
                ("url", models.CharField(blank=True, help_text="SSE endpoint URL", max_length=500)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mcp_pool",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("is_shared", models.BooleanField(default=False, help_text="Visible to all users")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("last_test_ok", models.BooleanField(blank=True, null=True)),
                ("last_test_at", models.DateTimeField(blank=True, null=True)),
                ("last_test_error", models.TextField(blank=True)),
            ],
            options={
                "verbose_name": "MCP Server",
                "verbose_name_plural": "MCP Servers",
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="AgentConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=150)),
                ("description", models.TextField(blank=True)),
                ("icon", models.CharField(blank=True, default="🤖", max_length=10)),
                ("system_prompt", models.TextField(blank=True, help_text="System prompt injected before the agent goal")),
                ("instructions", models.TextField(blank=True, help_text="Additional instructions / rules for this agent")),
                ("model", models.CharField(default="gemini-2.0-flash-exp", help_text="LLM model identifier", max_length=100)),
                ("max_iterations", models.PositiveIntegerField(default=10)),
                (
                    "allowed_tools",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text='List of enabled tool names, e.g. ["ssh_execute", "report"]',
                    ),
                ),
                ("mcp_servers", models.ManyToManyField(blank=True, related_name="agent_configs", to="studio.mcpserverpool")),
                (
                    "server_scope",
                    models.ManyToManyField(blank=True, related_name="agent_configs", to="servers.server"),
                ),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="agent_configs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("is_shared", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Agent Config",
                "verbose_name_plural": "Agent Configs",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="Pipeline",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("icon", models.CharField(blank=True, default="⚡", max_length=10)),
                ("tags", models.JSONField(blank=True, default=list)),
                (
                    "nodes",
                    models.JSONField(
                        default=list,
                        help_text="List of React Flow nodes: [{id, type, position, data}]",
                    ),
                ),
                (
                    "edges",
                    models.JSONField(
                        default=list,
                        help_text="List of React Flow edges: [{id, source, target, ...}]",
                    ),
                ),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pipelines",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("is_shared", models.BooleanField(default=False)),
                ("is_template", models.BooleanField(default=False, help_text="Bundled template, not user-created")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Pipeline",
                "verbose_name_plural": "Pipelines",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="PipelineTrigger",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "pipeline",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="triggers",
                        to="studio.pipeline",
                    ),
                ),
                ("name", models.CharField(blank=True, default="", max_length=100)),
                (
                    "trigger_type",
                    models.CharField(
                        choices=[("manual", "Manual"), ("webhook", "Webhook"), ("schedule", "Schedule (cron)")],
                        default="manual",
                        max_length=20,
                    ),
                ),
                ("is_active", models.BooleanField(default=True)),
                ("webhook_token", models.CharField(blank=True, max_length=64, unique=True)),
                (
                    "webhook_payload_map",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="Map incoming payload fields to pipeline context vars",
                    ),
                ),
                ("cron_expression", models.CharField(blank=True, help_text='Standard cron: "*/5 * * * *"', max_length=100)),
                ("last_triggered_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "Pipeline Trigger",
                "verbose_name_plural": "Pipeline Triggers",
                "ordering": ["pipeline", "trigger_type"],
            },
        ),
        migrations.CreateModel(
            name="PipelineRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "pipeline",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="runs",
                        to="studio.pipeline",
                    ),
                ),
                (
                    "triggered_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pipeline_runs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "trigger",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="runs",
                        to="studio.pipelinetrigger",
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("running", "Running"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                            ("stopped", "Stopped"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("nodes_snapshot", models.JSONField(default=list)),
                ("edges_snapshot", models.JSONField(default=list)),
                ("node_states", models.JSONField(default=dict)),
                ("context", models.JSONField(blank=True, default=dict)),
                ("trigger_data", models.JSONField(blank=True, default=dict)),
                ("summary", models.TextField(blank=True)),
                ("error", models.TextField(blank=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "Pipeline Run",
                "verbose_name_plural": "Pipeline Runs",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="PipelineTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=100, unique=True)),
                ("name", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("icon", models.CharField(blank=True, default="📦", max_length=10)),
                ("category", models.CharField(blank=True, default="DevOps", max_length=50)),
                ("tags", models.JSONField(blank=True, default=list)),
                ("nodes", models.JSONField(default=list)),
                ("edges", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "Pipeline Template",
                "verbose_name_plural": "Pipeline Templates",
                "ordering": ["category", "name"],
            },
        ),
    ]
