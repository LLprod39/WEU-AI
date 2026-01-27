from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("agent_type", models.CharField(choices=[("simple", "Simple"), ("complex", "Complex"), ("react", "ReAct"), ("ralph", "Ralph Wiggum")], default="react", max_length=20)),
                ("runtime", models.CharField(choices=[("internal", "Internal"), ("cursor", "Cursor CLI"), ("opencode", "OpenCode CLI"), ("gemini", "Gemini CLI")], default="internal", max_length=20)),
                ("mode", models.CharField(choices=[("simple", "Simple"), ("advanced", "Advanced")], default="simple", max_length=20)),
                ("config", models.JSONField(blank=True, default=dict)),
                ("is_default", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="agent_profiles", to="auth.user")),
            ],
            options={
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="AgentPreset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200, unique=True)),
                ("description", models.TextField(blank=True)),
                ("agent_type", models.CharField(choices=[("simple", "Simple"), ("complex", "Complex"), ("react", "ReAct"), ("ralph", "Ralph Wiggum")], max_length=20)),
                ("runtime", models.CharField(choices=[("internal", "Internal"), ("cursor", "Cursor CLI"), ("opencode", "OpenCode CLI"), ("gemini", "Gemini CLI")], max_length=20)),
                ("config", models.JSONField(blank=True, default=dict)),
                ("is_system", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="AgentRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("runtime", models.CharField(choices=[("internal", "Internal"), ("cursor", "Cursor CLI"), ("opencode", "OpenCode CLI"), ("gemini", "Gemini CLI")], default="internal", max_length=20)),
                ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("succeeded", "Succeeded"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="queued", max_length=20)),
                ("input_task", models.TextField()),
                ("output_text", models.TextField(blank=True)),
                ("logs", models.TextField(blank=True)),
                ("meta", models.JSONField(blank=True, default=dict)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("initiated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="auth.user")),
                ("profile", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="runs", to="agent_hub.agentprofile")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="agentprofile",
            index=models.Index(fields=["owner", "-updated_at"], name="agent_hub__owner_i_7a6a0f_idx"),
        ),
        migrations.AddIndex(
            model_name="agentprofile",
            index=models.Index(fields=["agent_type", "runtime"], name="agent_hub__agent_t_a28589_idx"),
        ),
        migrations.AddIndex(
            model_name="agentrun",
            index=models.Index(fields=["runtime", "-created_at"], name="agent_hub__runtime_c_05111d_idx"),
        ),
        migrations.AddIndex(
            model_name="agentrun",
            index=models.Index(fields=["status", "-created_at"], name="agent_hub__status_c_a60811_idx"),
        ),
    ]
