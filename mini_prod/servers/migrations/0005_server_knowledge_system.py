# Generated migration for server knowledge system
from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('servers', '0004_add_corporate_context'),
    ]

    operations = [
        # 1. Global rules for all servers (per user)
        migrations.CreateModel(
            name='GlobalServerRules',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rules', models.TextField(
                    blank=True,
                    help_text='Общие правила для всех серверов: политики безопасности, запрещённые команды, корпоративные требования'
                )),
                ('forbidden_commands', models.JSONField(
                    default=list,
                    blank=True,
                    help_text='Список запрещённых команд/паттернов: ["rm -rf /", "shutdown", ...]'
                )),
                ('required_checks', models.JSONField(
                    default=list,
                    blank=True,
                    help_text='Обязательные проверки перед выполнением: ["df -h", "free -m", ...]'
                )),
                ('environment_vars', models.JSONField(
                    default=dict,
                    blank=True,
                    help_text='Глобальные переменные окружения для всех серверов'
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='global_server_rules',
                    to=settings.AUTH_USER_MODEL
                )),
            ],
        ),

        # 2. Group-level rules
        migrations.AddField(
            model_name='servergroup',
            name='rules',
            field=models.TextField(
                blank=True,
                help_text='Правила для группы серверов: специфичные политики, ограничения'
            ),
        ),
        migrations.AddField(
            model_name='servergroup',
            name='forbidden_commands',
            field=models.JSONField(
                default=list,
                blank=True,
                help_text='Запрещённые команды для этой группы'
            ),
        ),
        migrations.AddField(
            model_name='servergroup',
            name='environment_vars',
            field=models.JSONField(
                default=dict,
                blank=True,
                help_text='Переменные окружения для группы'
            ),
        ),

        # 3. AI-generated knowledge for servers
        migrations.CreateModel(
            name='ServerKnowledge',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('category', models.CharField(
                    max_length=50,
                    choices=[
                        ('system', 'Система'),
                        ('services', 'Сервисы'),
                        ('network', 'Сеть'),
                        ('security', 'Безопасность'),
                        ('performance', 'Производительность'),
                        ('storage', 'Хранилище'),
                        ('packages', 'Пакеты/ПО'),
                        ('config', 'Конфигурация'),
                        ('issues', 'Известные проблемы'),
                        ('solutions', 'Решения'),
                        ('other', 'Другое'),
                    ],
                    default='other'
                )),
                ('title', models.CharField(max_length=200)),
                ('content', models.TextField(help_text='Содержимое заметки/знания')),
                ('source', models.CharField(
                    max_length=20,
                    choices=[
                        ('manual', 'Ручной ввод'),
                        ('ai_auto', 'AI автоматически'),
                        ('ai_task', 'AI после задачи'),
                    ],
                    default='manual'
                )),
                ('confidence', models.FloatField(
                    default=1.0,
                    help_text='Уверенность в актуальности (0.0-1.0)'
                )),
                ('is_active', models.BooleanField(default=True)),
                ('task_id', models.IntegerField(
                    null=True,
                    blank=True,
                    help_text='ID задачи, после которой создано знание'
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('verified_at', models.DateTimeField(
                    null=True,
                    blank=True,
                    help_text='Когда последний раз проверялось'
                )),
                ('server', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='knowledge',
                    to='servers.server'
                )),
                ('created_by', models.ForeignKey(
                    null=True,
                    blank=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'ordering': ['-updated_at'],
                'verbose_name': 'Server Knowledge',
                'verbose_name_plural': 'Server Knowledge',
            },
        ),

        # 4. Group-level knowledge
        migrations.CreateModel(
            name='ServerGroupKnowledge',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('category', models.CharField(
                    max_length=50,
                    choices=[
                        ('policy', 'Политика'),
                        ('access', 'Доступ'),
                        ('deployment', 'Деплой'),
                        ('monitoring', 'Мониторинг'),
                        ('backup', 'Бэкапы'),
                        ('network', 'Сеть'),
                        ('other', 'Другое'),
                    ],
                    default='other'
                )),
                ('title', models.CharField(max_length=200)),
                ('content', models.TextField()),
                ('source', models.CharField(
                    max_length=20,
                    choices=[
                        ('manual', 'Ручной ввод'),
                        ('ai_auto', 'AI автоматически'),
                    ],
                    default='manual'
                )),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('group', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='knowledge',
                    to='servers.servergroup'
                )),
                ('created_by', models.ForeignKey(
                    null=True,
                    blank=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'ordering': ['-updated_at'],
            },
        ),

        # Index for faster lookups
        migrations.AddIndex(
            model_name='serverknowledge',
            index=models.Index(fields=['server', 'category', '-updated_at'], name='srv_knowledge_idx'),
        ),
    ]
