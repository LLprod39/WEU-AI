# Generated migration for target_server field

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('servers', '0002_servergroup_advanced'),
        ('agent_hub', '0005_add_step_results_and_retry'),
    ]

    operations = [
        migrations.AddField(
            model_name='agentworkflow',
            name='target_server',
            field=models.ForeignKey(
                blank=True,
                help_text='Целевой сервер для выполнения команд (если не указан — агент сам выбирает из доступных)',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='workflows',
                to='servers.server',
            ),
        ),
    ]
