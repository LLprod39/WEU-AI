from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("studio", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="pipelinetrigger",
            name="node_id",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
    ]
