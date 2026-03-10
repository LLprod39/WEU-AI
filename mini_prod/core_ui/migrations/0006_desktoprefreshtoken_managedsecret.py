from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core_ui", "0005_llmusagelog"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ManagedSecret",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("namespace", models.CharField(max_length=50)),
                ("object_id", models.PositiveIntegerField()),
                ("key", models.CharField(default="default", max_length=50)),
                ("ciphertext", models.TextField()),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["namespace", "object_id", "key"],
                "unique_together": {("namespace", "object_id", "key")},
            },
        ),
        migrations.CreateModel(
            name="DesktopRefreshToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("label", models.CharField(blank=True, default="", max_length=120)),
                ("user_agent", models.CharField(blank=True, default="", max_length=512)),
                ("expires_at", models.DateTimeField()),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "replaced_by",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="replaces",
                        to="core_ui.desktoprefreshtoken",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="desktop_refresh_tokens",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="managedsecret",
            index=models.Index(fields=["namespace", "object_id"], name="core_ui_man_namespa_df8efb_idx"),
        ),
        migrations.AddIndex(
            model_name="managedsecret",
            index=models.Index(fields=["updated_at"], name="core_ui_man_updated_9efe2f_idx"),
        ),
        migrations.AddIndex(
            model_name="desktoprefreshtoken",
            index=models.Index(fields=["user", "-created_at"], name="core_ui_des_user_id_9664d3_idx"),
        ),
        migrations.AddIndex(
            model_name="desktoprefreshtoken",
            index=models.Index(fields=["expires_at"], name="core_ui_des_expires_c5b826_idx"),
        ),
        migrations.AddIndex(
            model_name="desktoprefreshtoken",
            index=models.Index(fields=["revoked_at"], name="core_ui_des_revoked_d5459d_idx"),
        ),
    ]
