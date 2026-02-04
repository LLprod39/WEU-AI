# План: Превращение Tasks в полноценную Jira-подобную систему

## Текущее состояние

Модуль tasks уже имеет:
- ✅ Задачи с приоритетами, статусами, дедлайнами
- ✅ Подзадачи с прогрессом
- ✅ Комментарии и вложения
- ✅ Метки (labels)
- ✅ AI-анализ и авто-выполнение
- ✅ Интеграция с серверами
- ✅ Уведомления
- ✅ История изменений
- ✅ Базовая Jira-интеграция (external_id, external_url)

## Чего не хватает (актуально на дату плана)

- ✅ **Проекты** — группировка задач по проектам (реализовано)
- ✅ **Команды** — группы пользователей (Team, TeamMember), добавление команды в проект целиком (реализовано)
- ✅ **Роли в проектах** — owner, admin, member, viewer (реализовано)
- ✅ **Материалы проекта** — документы/файлы/ссылки/wiki (реализовано)
- ✅ **Спринты** — планирование, активный, завершён (реализовано)
- ✅ **Доска проекта** — Kanban по проекту + бэклог (реализовано)
- ✅ **Назначение между пользователями** — через участников проекта (реализовано)
- ✅ **Фильтры и сохранённые виды** — API filter_list/save/delete (реализовано)

---

## Фаза 1: Модели данных (Backend)

### 1.1 Новые модели

```python
# tasks/models.py - НОВЫЕ МОДЕЛИ

class Project(models.Model):
    """Проект — контейнер для задач"""
    name = models.CharField(max_length=200)
    key = models.CharField(max_length=10, unique=True)  # Например: "WEU", "DEV"
    description = models.TextField(blank=True)

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='owned_projects')

    # Настройки
    is_public = models.BooleanField(default=False)  # Видимость для всех
    default_assignee = models.ForeignKey(User, null=True, blank=True,
                                          on_delete=models.SET_NULL,
                                          related_name='default_assignee_projects')

    # Визуал
    color = models.CharField(max_length=7, default='#3B82F6')  # HEX цвет
    icon = models.CharField(max_length=50, default='folder')  # Иконка

    # Счётчик задач для генерации ID типа "WEU-123"
    task_counter = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-updated_at']


class ProjectMember(models.Model):
    """Членство в проекте с ролями"""
    ROLE_CHOICES = [
        ('owner', 'Владелец'),
        ('admin', 'Администратор'),
        ('member', 'Участник'),
        ('viewer', 'Наблюдатель'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='members')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='project_memberships')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='member')

    # Уведомления
    notify_on_new_task = models.BooleanField(default=True)
    notify_on_mention = models.BooleanField(default=True)
    notify_on_assignment = models.BooleanField(default=True)

    joined_at = models.DateTimeField(auto_now_add=True)
    invited_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL,
                                   related_name='sent_invitations')

    class Meta:
        unique_together = ['project', 'user']


class ProjectInvitation(models.Model):
    """Приглашения в проект"""
    STATUS_CHOICES = [
        ('pending', 'Ожидает'),
        ('accepted', 'Принято'),
        ('declined', 'Отклонено'),
        ('expired', 'Истекло'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    email = models.EmailField()  # Для приглашения по email
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE)  # Если уже зарегистрирован
    role = models.CharField(max_length=20, default='member')

    invited_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='invitations_sent')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    token = models.CharField(max_length=64, unique=True)  # Для принятия по ссылке

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    responded_at = models.DateTimeField(null=True, blank=True)


class ProjectMaterial(models.Model):
    """Материалы проекта — документы, ссылки, файлы"""
    TYPE_CHOICES = [
        ('document', 'Документ'),
        ('link', 'Ссылка'),
        ('file', 'Файл'),
        ('wiki', 'Wiki-страница'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='materials')

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    material_type = models.CharField(max_length=20, choices=TYPE_CHOICES)

    # Для файлов
    file = models.FileField(upload_to='project_materials/%Y/%m/', null=True, blank=True)
    file_size = models.PositiveIntegerField(null=True, blank=True)

    # Для ссылок
    url = models.URLField(max_length=500, blank=True)

    # Для wiki
    content = models.TextField(blank=True)  # Markdown

    # Организация
    folder = models.CharField(max_length=200, blank=True)  # Виртуальная папка
    pinned = models.BooleanField(default=False)

    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Sprint(models.Model):
    """Спринт/Итерация"""
    STATUS_CHOICES = [
        ('planning', 'Планирование'),
        ('active', 'Активный'),
        ('completed', 'Завершён'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='sprints')
    name = models.CharField(max_length=100)
    goal = models.TextField(blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='planning')

    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_date']


class SavedFilter(models.Model):
    """Сохранённые фильтры/виды"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_filters')
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.CASCADE)

    name = models.CharField(max_length=100)
    filter_config = models.JSONField()  # {"status": ["TODO"], "assignee": [1,2], ...}

    is_default = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
```

### 1.2 Изменения в существующей модели Task

```python
# Добавить в Task:
project = models.ForeignKey('Project', null=True, blank=True,
                            on_delete=models.CASCADE, related_name='tasks')
sprint = models.ForeignKey('Sprint', null=True, blank=True,
                           on_delete=models.SET_NULL, related_name='tasks')
task_key = models.CharField(max_length=20, blank=True)  # "WEU-123"

# Для назначения нескольких людей:
watchers = models.ManyToManyField(User, blank=True, related_name='watched_tasks')

# Связи между задачами:
parent_task = models.ForeignKey('self', null=True, blank=True,
                                on_delete=models.CASCADE, related_name='child_tasks')
blocked_by = models.ManyToManyField('self', symmetrical=False,
                                     blank=True, related_name='blocks')
```

---

## Фаза 2: Permissions & Доступ

### 2.1 Система прав

```python
# tasks/permissions.py

class ProjectPermissions:
    """Проверка прав доступа к проекту"""

    @staticmethod
    def can_view(user, project):
        """Может просматривать проект"""
        if project.is_public:
            return True
        return ProjectMember.objects.filter(project=project, user=user).exists()

    @staticmethod
    def can_edit(user, project):
        """Может редактировать настройки проекта"""
        return ProjectMember.objects.filter(
            project=project, user=user, role__in=['owner', 'admin']
        ).exists()

    @staticmethod
    def can_manage_members(user, project):
        """Может управлять участниками"""
        return ProjectMember.objects.filter(
            project=project, user=user, role__in=['owner', 'admin']
        ).exists()

    @staticmethod
    def can_create_task(user, project):
        """Может создавать задачи"""
        return ProjectMember.objects.filter(
            project=project, user=user, role__in=['owner', 'admin', 'member']
        ).exists()

    @staticmethod
    def can_delete_project(user, project):
        """Может удалить проект"""
        return project.owner == user


class TaskPermissions:
    """Проверка прав на задачу"""

    @staticmethod
    def can_view(user, task):
        if not task.project:
            return task.created_by == user or task.assignee == user
        return ProjectPermissions.can_view(user, task.project)

    @staticmethod
    def can_edit(user, task):
        if not task.project:
            return task.created_by == user or task.assignee == user
        membership = ProjectMember.objects.filter(
            project=task.project, user=user
        ).first()
        if not membership:
            return False
        if membership.role in ['owner', 'admin']:
            return True
        return task.created_by == user or task.assignee == user

    @staticmethod
    def can_assign(user, task):
        """Может назначать задачу"""
        if not task.project:
            return task.created_by == user
        return ProjectMember.objects.filter(
            project=task.project, user=user, role__in=['owner', 'admin', 'member']
        ).exists()
```

---

## Фаза 3: API Endpoints

### 3.1 Новые URLs

```python
# tasks/urls.py — ДОПОЛНЕНИЯ

# Проекты
path('projects/', views.project_list, name='project_list'),
path('projects/create/', views.project_create, name='project_create'),
path('projects/<int:pk>/', views.project_detail, name='project_detail'),
path('projects/<int:pk>/settings/', views.project_settings, name='project_settings'),
path('projects/<int:pk>/delete/', views.project_delete, name='project_delete'),
path('projects/<int:pk>/archive/', views.project_archive, name='project_archive'),

# Участники проекта
path('projects/<int:pk>/members/', views.project_members, name='project_members'),
path('projects/<int:pk>/members/add/', views.project_member_add, name='project_member_add'),
path('projects/<int:pk>/members/<int:user_id>/remove/', views.project_member_remove, name='project_member_remove'),
path('projects/<int:pk>/members/<int:user_id>/role/', views.project_member_role, name='project_member_role'),

# Приглашения
path('projects/<int:pk>/invite/', views.project_invite, name='project_invite'),
path('invitations/<str:token>/', views.invitation_respond, name='invitation_respond'),

# Материалы проекта
path('projects/<int:pk>/materials/', views.project_materials, name='project_materials'),
path('projects/<int:pk>/materials/add/', views.material_add, name='material_add'),
path('materials/<int:pk>/', views.material_detail, name='material_detail'),
path('materials/<int:pk>/delete/', views.material_delete, name='material_delete'),

# Спринты
path('projects/<int:pk>/sprints/', views.sprint_list, name='sprint_list'),
path('projects/<int:pk>/sprints/create/', views.sprint_create, name='sprint_create'),
path('sprints/<int:pk>/', views.sprint_detail, name='sprint_detail'),
path('sprints/<int:pk>/start/', views.sprint_start, name='sprint_start'),
path('sprints/<int:pk>/complete/', views.sprint_complete, name='sprint_complete'),

# Фильтры
path('filters/', views.filter_list, name='filter_list'),
path('filters/save/', views.filter_save, name='filter_save'),
path('filters/<int:pk>/delete/', views.filter_delete, name='filter_delete'),

# Расширенные операции с задачами
path('tasks/<int:pk>/watchers/', views.task_watchers, name='task_watchers'),
path('tasks/<int:pk>/move/', views.task_move, name='task_move'),  # Между проектами
path('tasks/<int:pk>/link/', views.task_link, name='task_link'),  # Связать задачи
path('tasks/bulk/', views.tasks_bulk_action, name='tasks_bulk_action'),  # Массовые операции
```

---

## Фаза 4: Frontend

### 4.1 Новые страницы

| Страница | Описание |
|----------|----------|
| `/tasks/projects/` | Список проектов (карточки) |
| `/tasks/projects/<pk>/` | Доска проекта (Kanban) |
| `/tasks/projects/<pk>/backlog/` | Бэклог проекта |
| `/tasks/projects/<pk>/settings/` | Настройки проекта |
| `/tasks/projects/<pk>/members/` | Управление участниками |
| `/tasks/projects/<pk>/materials/` | Материалы проекта |
| `/tasks/projects/<pk>/sprints/` | Спринты |

### 4.2 Компоненты UI

```
┌─────────────────────────────────────────────────────────────────┐
│  🏠 Проекты  >  WEU Platform  >  Доска                          │
├─────────────────────────────────────────────────────────────────┤
│  [+ Задача]  [Фильтры ▼]  [Поиск...]  [👤 Участники]  [⚙️]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📋 TODO          🔄 IN PROGRESS      ✅ DONE                   │
│  ─────────────    ─────────────────   ─────────────             │
│  ┌───────────┐    ┌───────────────┐   ┌───────────┐             │
│  │ WEU-123   │    │ WEU-120       │   │ WEU-115   │             │
│  │ Fix bug   │    │ Add feature   │   │ Deploy v2 │             │
│  │ 👤 Ivan   │    │ 👤 Maria      │   │ 👤 AI     │             │
│  │ 🔴 High   │    │ 🟡 Medium     │   │ ✓ Done    │             │
│  └───────────┘    └───────────────┘   └───────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Модальные окна

1. **Создание проекта**
   - Название, ключ (авто-генерация), описание
   - Цвет, иконка
   - Добавить участников сразу

2. **Приглашение участника**
   - Email / выбор из списка пользователей
   - Роль
   - Персональное сообщение

3. **Добавление материала**
   - Тип (файл/ссылка/wiki)
   - Загрузка / URL / редактор Markdown
   - Папка

4. **Настройки проекта**
   - Основные (название, описание)
   - Права доступа
   - Интеграции (Jira sync)
   - Danger zone (архив/удаление)

---

## Фаза 5: Уведомления

### 5.1 Новые типы уведомлений

```python
NOTIFICATION_TYPES = [
    # Существующие...

    # Проекты
    ('PROJECT_INVITATION', 'Приглашение в проект'),
    ('PROJECT_ROLE_CHANGED', 'Изменение роли в проекте'),
    ('PROJECT_MEMBER_JOINED', 'Новый участник проекта'),
    ('PROJECT_MEMBER_LEFT', 'Участник покинул проект'),

    # Задачи
    ('TASK_ASSIGNED', 'Задача назначена'),
    ('TASK_MENTIONED', 'Упоминание в задаче'),
    ('TASK_WATCHING', 'Обновление отслеживаемой задачи'),
    ('TASK_MOVED', 'Задача перемещена'),

    # Спринты
    ('SPRINT_STARTED', 'Спринт начат'),
    ('SPRINT_ENDING', 'Спринт заканчивается'),
    ('SPRINT_COMPLETED', 'Спринт завершён'),
]
```

### 5.2 Триггеры уведомлений

| Событие | Кому | Тип |
|---------|------|-----|
| Приглашение в проект | Приглашённый | PROJECT_INVITATION |
| Назначение задачи | Assignee | TASK_ASSIGNED |
| @упоминание в комментарии | Упомянутый | TASK_MENTIONED |
| Изменение задачи | Watchers | TASK_WATCHING |
| Начало спринта | Участники проекта | SPRINT_STARTED |

---

## Фаза 6: Миграция данных

### 6.1 Стратегия миграции

1. **Создать дефолтный проект** "Personal" для каждого пользователя
2. **Перенести существующие задачи** в персональные проекты
3. **Сохранить обратную совместимость** — задачи без проекта по-прежнему работают

```python
# tasks/migrations/00XX_migrate_to_projects.py

def migrate_tasks_to_projects(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    Project = apps.get_model('tasks', 'Project')
    ProjectMember = apps.get_model('tasks', 'ProjectMember')
    Task = apps.get_model('tasks', 'Task')

    for user in User.objects.all():
        # Создаём персональный проект
        project, created = Project.objects.get_or_create(
            owner=user,
            key=f'PERSONAL-{user.id}',
            defaults={
                'name': f'Личные задачи ({user.username})',
                'is_public': False,
            }
        )

        if created:
            # Добавляем владельца как участника
            ProjectMember.objects.create(
                project=project,
                user=user,
                role='owner'
            )

        # Переносим задачи
        Task.objects.filter(
            created_by=user,
            project__isnull=True
        ).update(project=project)
```

---

## Фаза 7: План реализации

### Этап 1: Модели и миграции (2-3 дня)
- [x] Создать модели Project, ProjectMember, ProjectInvitation
- [x] Создать модели ProjectMaterial, Sprint, SavedFilter
- [x] Обновить модель Task (project, sprint, task_key, watchers, TaskRelation вместо blocked_by)
- [x] Написать миграции
- [x] Создать скрипт миграции существующих данных (0014_migrate_tasks_to_personal_projects)

### Этап 2: Backend API (3-4 дня)
- [x] CRUD для проектов
- [x] Управление участниками
- [x] Система приглашений
- [x] CRUD для материалов
- [x] CRUD для спринтов
- [x] Обновить task_list для фильтрации по проекту
- [x] Bulk-операции с задачами

### Этап 3: Permissions (1-2 дня)
- [x] Реализовать ProjectPermissions
- [x] Реализовать TaskPermissions
- [x] Добавить декораторы для view
- [x] Тесты на права доступа (tests/test_tasks_permissions.py)

### Этап 4: Frontend — Проекты (3-4 дня)
- [x] Страница списка проектов
- [x] Страница проекта (доска)
- [x] Страница настроек проекта (в /settings/projects/<id>/)
- [x] Модальное окно создания проекта
- [x] Управление участниками UI
- [x] URL и страница бэклога (/projects/<pk>/backlog/)

### Этап 5: Frontend — Материалы и спринты (2-3 дня)
- [x] UI материалов проекта
- [x] Wiki-редактор (Markdown)
- [x] UI спринтов
- [x] Drag-drop задач в спринт (sprint_add_tasks)

### Этап 6: Уведомления и polish (2 дня)
- [x] Новые типы уведомлений (PROJECT_*, TASK_ASSIGNED, TASK_MENTIONED, TASK_WATCHING, TASK_MOVED, SPRINT_*)
- [x] Триггеры уведомлений (tasks/notification_triggers.py): приглашение, смена роли, выход, присоединение, назначение задачи, @упоминание, обновление для watchers, перемещение задачи, старт/завершение спринта
- [x] Email-уведомления: вызов TaskEmailService при назначении задачи, @упоминании, добавлении в проект, смене статуса (watchers)
- [x] Мобильная адаптация: фильтр по проекту на mobile task_list (полоска проектов + ссылка на список проектов)
- [x] UI сохранённых видов: блок «Saved views» в сайдбаре, загрузка/применение фильтров, модалка «Save current view»
- [ ] Тестирование (расширенное)

---

## Примерный UI Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        MAIN NAVIGATION                       │
│  [Dashboard] [Projects ▼] [Tasks] [Servers] [Agents]        │
│              └── My Projects                                 │
│                  ├── 🔵 WEU Platform                        │
│                  ├── 🟢 DevOps Tools                        │
│                  └── + Create Project                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  PROJECT: WEU Platform                                       │
│  ─────────────────────────────────────────────────────────  │
│  [Board] [Backlog] [Sprints] [Materials] [Members] [Settings]│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Sprint 5: Jira-like features                           ││
│  │  Feb 4 - Feb 18  │  🟢 Active  │  12/20 tasks done     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  TODO (4)         IN PROGRESS (3)      DONE (12)           │
│  ┌─────────┐      ┌─────────────┐      ┌─────────┐         │
│  │WEU-145  │      │WEU-142      │      │WEU-140  │         │
│  │Add proj │      │Project board│      │Models   │         │
│  └─────────┘      └─────────────┘      └─────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## Технические детали

### Генерация task_key

```python
# В модели Project
def get_next_task_key(self):
    with transaction.atomic():
        project = Project.objects.select_for_update().get(pk=self.pk)
        project.task_counter += 1
        project.save(update_fields=['task_counter'])
        return f"{self.key}-{project.task_counter}"

# В модели Task — сигнал pre_save
@receiver(pre_save, sender=Task)
def generate_task_key(sender, instance, **kwargs):
    if not instance.task_key and instance.project:
        instance.task_key = instance.project.get_next_task_key()
```

### Фильтрация по правам

```python
def get_projects_for_user(user):
    """Получить проекты, доступные пользователю"""
    return Project.objects.filter(
        Q(is_public=True) |
        Q(members__user=user)
    ).distinct()

def get_tasks_for_user(user, project=None):
    """Получить задачи с учётом прав"""
    projects = get_projects_for_user(user)
    qs = Task.objects.filter(
        Q(project__in=projects) |
        Q(project__isnull=True, created_by=user) |
        Q(project__isnull=True, assignee=user)
    )
    if project:
        qs = qs.filter(project=project)
    return qs.distinct()
```

---

## Оценка сложности

| Компонент | Сложность | Время |
|-----------|-----------|-------|
| Модели и миграции | Средняя | 2-3 дня |
| Backend API | Высокая | 3-4 дня |
| Permissions | Средняя | 1-2 дня |
| Frontend проекты | Высокая | 3-4 дня |
| Frontend материалы/спринты | Средняя | 2-3 дня |
| Уведомления | Низкая | 1 день |
| Тестирование | Средняя | 2 дня |
| **ИТОГО** | | **~15-19 дней** |

---

## Приоритеты (MVP)

Для первой версии (MVP) можно реализовать:

1. ✅ **Проекты** — базовый CRUD
2. ✅ **Участники** — добавление/удаление
3. ✅ **Задачи в проектах** — привязка к проекту
4. ✅ **Доска проекта** — Kanban по проекту
5. ⏸️ Спринты — отложить
6. ⏸️ Материалы — отложить
7. ⏸️ Wiki — отложить

**MVP: ~7-10 дней**

---

## Вопросы для уточнения

1. **Приоритет функций**: MVP или полная версия сразу?
2. **Email-уведомления**: Нужны ли? Есть ли настроенный SMTP?
3. **Интеграция с Jira**: Синхронизация проектов или только задач?
4. **Мобильная версия**: Делать параллельно или после десктопа?
5. **Права доступа**: Достаточно ли 4 ролей (owner/admin/member/viewer)?
