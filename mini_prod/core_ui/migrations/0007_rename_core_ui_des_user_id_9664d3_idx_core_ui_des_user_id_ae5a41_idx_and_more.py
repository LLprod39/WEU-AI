from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core_ui", "0006_desktoprefreshtoken_managedsecret"),
    ]

    operations = [
        migrations.RenameIndex(
            model_name="desktoprefreshtoken",
            new_name="core_ui_des_user_id_ae5a41_idx",
            old_name="core_ui_des_user_id_9664d3_idx",
        ),
        migrations.RenameIndex(
            model_name="desktoprefreshtoken",
            new_name="core_ui_des_expires_697b0d_idx",
            old_name="core_ui_des_expires_c5b826_idx",
        ),
        migrations.RenameIndex(
            model_name="desktoprefreshtoken",
            new_name="core_ui_des_revoked_39c67f_idx",
            old_name="core_ui_des_revoked_d5459d_idx",
        ),
        migrations.RenameIndex(
            model_name="managedsecret",
            new_name="core_ui_man_namespa_5bd0e2_idx",
            old_name="core_ui_man_namespa_df8efb_idx",
        ),
        migrations.RenameIndex(
            model_name="managedsecret",
            new_name="core_ui_man_updated_c5583e_idx",
            old_name="core_ui_man_updated_9efe2f_idx",
        ),
        migrations.AlterField(
            model_name="userapppermission",
            name="feature",
            field=models.CharField(
                choices=[
                    ("servers", "Servers"),
                    ("dashboard", "Dashboard"),
                    ("agents", "Agents"),
                    ("studio", "Studio"),
                    ("settings", "Settings"),
                    ("orchestrator", "Orchestrator"),
                    ("knowledge_base", "Knowledge Base"),
                ],
                max_length=30,
            ),
        ),
    ]
