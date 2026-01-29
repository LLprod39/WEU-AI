from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agent_hub", "0006_add_target_server"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="log_events",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="agentworkflowrun",
            name="log_events",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
