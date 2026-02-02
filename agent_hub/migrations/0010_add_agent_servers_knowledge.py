# Generated migration for adding allowed_servers and knowledge_base to CustomAgent

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('agent_hub', '0009_add_custom_agents'),
    ]

    operations = [
        migrations.AddField(
            model_name='customagent',
            name='allowed_servers',
            field=models.JSONField(
                blank=True,
                default=None,
                help_text='null/"all" = все серверы пользователя, [id1, id2, ...] = только указанные серверы',
                null=True
            ),
        ),
        migrations.AddField(
            model_name='customagent',
            name='knowledge_base',
            field=models.TextField(
                blank=True,
                default='',
                help_text='База знаний агента: инструкции, типичные проблемы, примеры (подставляется в системный промпт)'
            ),
        ),
    ]
