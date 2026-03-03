from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("servers", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ServerGroupTag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=50)),
                ("color", models.CharField(default="#6b7280", max_length=7)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="server_group_tags", to="auth.user")),
            ],
            options={
                "ordering": ["name"],
                "unique_together": {("name", "user")},
            },
        ),
        migrations.CreateModel(
            name="ServerGroupMember",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("owner", "Owner"), ("admin", "Admin"), ("member", "Member"), ("viewer", "Viewer")], default="member", max_length=20)),
                ("joined_at", models.DateTimeField(auto_now_add=True)),
                ("group", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="servers.servergroup")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="server_group_memberships", to="auth.user")),
            ],
            options={
                "unique_together": {("group", "user")},
            },
        ),
        migrations.CreateModel(
            name="ServerGroupSubscription",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kind", models.CharField(choices=[("follow", "Follow"), ("favorite", "Favorite")], default="follow", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("group", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="subscriptions", to="servers.servergroup")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="server_group_subscriptions", to="auth.user")),
            ],
            options={
                "unique_together": {("group", "user", "kind")},
            },
        ),
        migrations.CreateModel(
            name="ServerGroupPermission",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("can_view", models.BooleanField(default=True)),
                ("can_execute", models.BooleanField(default=False)),
                ("can_edit", models.BooleanField(default=False)),
                ("can_manage_members", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("group", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="permissions", to="servers.servergroup")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="server_group_permissions", to="auth.user")),
            ],
            options={
                "unique_together": {("group", "user")},
            },
        ),
        migrations.AddField(
            model_name="servergroup",
            name="tags",
            field=models.ManyToManyField(blank=True, related_name="groups", to="servers.servergrouptag"),
        ),
    ]
