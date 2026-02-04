# Data migration: создать персональный проект для каждого пользователя
# и перенести в него задачи без проекта (обратная совместимость сохраняется)

from django.db import migrations


def migrate_tasks_to_projects(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    Project = apps.get_model('tasks', 'Project')
    ProjectMember = apps.get_model('tasks', 'ProjectMember')
    Task = apps.get_model('tasks', 'Task')

    for user in User.objects.filter(is_active=True):
        # Задачи пользователя без проекта
        tasks_without_project = Task.objects.filter(
            created_by=user,
            project__isnull=True
        )
        if not tasks_without_project.exists():
            continue

        key = f'PERSONAL-{user.id}'
        project, created = Project.objects.get_or_create(
            key=key,
            defaults={
                'name': f'Личные задачи ({user.username})',
                'owner': user,
                'description': '',
                'is_public': False,
                'color': '#64748b',
                'icon': 'user',
            }
        )

        if created:
            ProjectMember.objects.get_or_create(
                project=project,
                user=user,
                defaults={'role': 'owner'}
            )

        # Переносим задачи и назначаем task_key (историческая модель не вызывает get_next_task_key)
        counter = project.task_counter or 0
        for task in tasks_without_project:
            counter += 1
            task.project = project
            task.task_key = f'{project.key}-{counter}'
            task.save()
        if counter > (project.task_counter or 0):
            Project.objects.filter(pk=project.pk).update(task_counter=counter)


def noop_reverse(apps, schema_editor):
    """Откат: не переносим задачи обратно (оставляем в персональных проектах)."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0013_add_notification_types_and_nullable_task'),
    ]

    operations = [
        migrations.RunPython(migrate_tasks_to_projects, noop_reverse),
    ]
