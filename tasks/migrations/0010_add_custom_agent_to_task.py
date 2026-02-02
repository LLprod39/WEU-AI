# Generated migration for adding recommended_custom_agent to Task

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('agent_hub', '0009_add_custom_agents'),
        ('tasks', '0009_add_jira_integration'),
    ]

    operations = [
        migrations.AddField(
            model_name='task',
            name='recommended_custom_agent',
            field=models.ForeignKey(
                blank=True,
                help_text='Рекомендованный кастомный агент для выполнения задачи',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='tasks',
                to='agent_hub.customagent'
            ),
        ),
    ]
