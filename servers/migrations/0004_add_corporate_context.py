# Generated migration for corporate_context field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('servers', '0003_add_network_context'),
    ]

    operations = [
        migrations.AddField(
            model_name='server',
            name='corporate_context',
            field=models.TextField(blank=True, help_text='Корпоративные требования: прокси, VPN, env переменные, условия доступа'),
        ),
    ]
