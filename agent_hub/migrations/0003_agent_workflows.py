from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("agent_hub", "0002_seed_presets"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentWorkflow",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("runtime", models.CharField(choices=[("internal", "Internal"), ("cursor", "Cursor CLI"), ("opencode", "OpenCode CLI"), ("gemini", "Gemini CLI"), ("ralph", "Ralph Orchestrator")], default="gemini", max_length=20)),
                ("script", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="agent_workflows", to="auth.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="AgentWorkflowRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("succeeded", "Succeeded"), ("failed", "Failed")], default="queued", max_length=20)),
                ("current_step", models.IntegerField(default=0)),
                ("logs", models.TextField(blank=True)),
                ("output_text", models.TextField(blank=True)),
                ("meta", models.JSONField(blank=True, default=dict)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("initiated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="auth.user")),
                ("workflow", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="runs", to="agent_hub.agentworkflow")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
