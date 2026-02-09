from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skills", "0002_skillshare"),
    ]

    operations = [
        migrations.AddField(
            model_name="skill",
            name="server_scope_all",
            field=models.BooleanField(
                default=True,
                help_text="True = применяется ко всем серверам пользователя. False = только выбранные server_ids.",
            ),
        ),
        migrations.AddField(
            model_name="skill",
            name="server_scope_ids",
            field=models.JSONField(
                default=list,
                blank=True,
                help_text="ID серверов, к которым относится этот skill (если server_scope_all=False).",
            ),
        ),
    ]
