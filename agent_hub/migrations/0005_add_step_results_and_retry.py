# Generated manually to align with work_ai agent_hub

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agent_hub', '0004_add_project_path'),
    ]

    operations = [
        migrations.AddField(
            model_name='agentworkflowrun',
            name='max_retries',
            field=models.IntegerField(default=3, help_text='Max retries per step'),
        ),
        migrations.AddField(
            model_name='agentworkflowrun',
            name='retry_count',
            field=models.IntegerField(default=0, help_text='Number of retries for current step'),
        ),
        migrations.AddField(
            model_name='agentworkflowrun',
            name='step_results',
            field=models.JSONField(blank=True, default=list, help_text='Results for each step'),
        ),
        migrations.AlterField(
            model_name='agentworkflowrun',
            name='status',
            field=models.CharField(choices=[('queued', 'Queued'), ('running', 'Running'), ('succeeded', 'Succeeded'), ('failed', 'Failed'), ('paused', 'Paused')], default='queued', max_length=20),
        ),
    ]
