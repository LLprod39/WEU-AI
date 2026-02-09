# WEU AI Platform — кнопки, экраны и подробная логика работы (без кода)

Документ сделан как расширение `docs/FEATURES.md`: здесь описаны **кнопки/элементы интерфейса**, что они делают, и с какими API/разделами связаны.

## Что внутри

- Подробная логика по шагам (стрелками).
- Кнопки по основным страницам платформы.
- Связи между разделами (Chat ↔ Tasks ↔ Agents ↔ Servers ↔ RAG).
- Отдельно: desktop и ключевые мобильные кнопки.

## 1. Сквозная логика платформы

### 1.1 Авторизация и доступ

```text
Login
  -> проверка пользователя
  -> загрузка его permission-флагов
  -> отрисовка sidebar/страниц только по правам
```

```text
Пользователь без права на раздел
  -> пункт меню не показывается
  -> прямой API/URL тоже проверяется сервером
```

### 1.2 Общий поток выполнения задач через AI

```text
Создание/открытие задачи
  -> анализ текста (серверы, сложность, можно ли авто-выполнить)
  -> вариант A: Discuss -> Chat с task_id
  -> вариант B: Execute/Delegate -> Agent workflow
  -> статус/результат -> уведомления + логи
```

**Skills влияние (обновлено):**

- Skills НЕ подмешиваются в Chat (чтобы не перегружать чат).
- Skills применяются для:
  - Agent Run (Custom Agents)
  - Workflow шаги (Ralph/CLI)
  - Webhooks (если указаны `skill_ids`)
  - Custom Agents (если у агента назначены skills)
- Для Custom Agents можно ограничивать набор разрешённых tools (allowed_tools).

### 1.3 Общий поток чата

```text
Сообщение в Chat
  -> (опционально) RAG-поиск в базе знаний
  -> выбор режима Chat/ReAct
  -> стриминг ответа
  -> (опционально) действия по задачам/серверу из ответа
```

**Skills в чате:** не используются.

---

## 2. Глобальные кнопки (везде)

## 2.1 Sidebar


| Кнопка/элемент     | Что делает                                           | Связь                  |
| ------------------ | ---------------------------------------------------- | ---------------------- |
| `Collapse sidebar` | Сворачивает/разворачивает боковую панель             | Локальное UI-состояние |
| `Dashboard`        | Переход на главную                                   | `/`                    |
| `Monitor`          | Мониторинг запусков                                  | `/monitor/`            |
| `Servers`          | Список серверов                                      | `/servers/`            |
| `Tasks`            | Доска задач                                          | `/tasks/`              |
| `Agents`           | Agent Hub                                            | `/agents/`             |
| `Skills`           | Личные/Shared skills, правила и контекст для агентов | `/skills/`             |
| `Chat`             | Чат с AI                                             | `/chat/`               |
| `IDE`              | Веб-IDE                                              | `/ide/`                |
| `Knowledge`        | База знаний                                          | `/knowledge-base/`     |
| `Settings`         | Настройки системы                                    | `/settings/`           |
| `Passwords`        | Менеджер паролей                                     | `/passwords/`          |
| `Sign Out`         | Выход из аккаунта                                    | `/logout/` (POST)      |


## 2.2 Header


| Кнопка/элемент            | Что делает                             | Связь                                 |
| ------------------------- | -------------------------------------- | ------------------------------------- |
| `Mobile menu`             | Открывает боковое меню на мобильных    | Mobile drawer                         |
| `Колокольчик уведомлений` | Открывает дропдаун задач/делегирования | `/tasks/notifications/`               |
| `Прочитать все`           | Отмечает уведомления прочитанными      | `/tasks/notifications/mark-all-read/` |
| `Help`                    | Открывает правую панель справки        | локальная панель + onboarding         |
| `Повторить тур` (в Help)  | Запускает обучение снова               | `OnboardingTour.start(true)`          |
| `Feedback`                | Переход в Issues                       | внешний GitHub                        |
| `Status`                  | Показ статуса соединения               | индикатор в шапке                     |
| `Model badge`             | Переход в настройки моделей            | `/settings/`                          |


---

## 6.5 Skills (`/skills/`)

### Логика

```text
Открытие Skills
  -> загрузка списка /skills/api/skills/ (только owner + shared)
  -> выбор skill
  -> редактирование policy/rules/instructions/source
  -> Save -> PUT/POST /skills/api/skills/
```

```text
Доступ к skill
  -> owner: полный доступ
  -> shared:
       can_edit: редактирование без управления share
       can_manage: редактирование + управление share
  -> не входит в scope: skill не виден
```

```text
Sync skill (git/manual)
  -> POST /skills/api/skills/<id>/sync/
  -> обновление version + контекста
  -> логирование результата sync
```

```text
AI помощник для Skill
  -> POST /skills/api/assistant/
  -> вопросы + черновик (name/slug/rules/instructions и т.д.)
  -> пользователь применяет черновик в форму
```


| Кнопка/элемент    | Что делает                                       | Связь                                               |
| ----------------- | ------------------------------------------------ | --------------------------------------------------- |
| `Новый skill`     | Создание нового skill                            | `POST /skills/api/skills/`                          |
| `Сохранить`       | Обновление skill                                 | `PUT /skills/api/skills/<id>/`                      |
| `Share: Добавить` | Выдать доступ пользователю (can_edit/can_manage) | `POST /skills/api/skills/<id>/shares/`              |
| `Share: Remove`   | Забрать доступ                                   | `DELETE /skills/api/skills/<id>/shares/<share_id>/` |
| `Sync`            | Ручная синхронизация skill                       | `POST /skills/api/skills/<id>/sync/`                |
| `AI: Вопросы`     | Запрашивает уточнения у ассистента               | `POST /skills/api/assistant/`                       |
| `AI: Черновик`    | Генерация черновика skill                        | `POST /skills/api/assistant/`                       |
| `Удалить`         | Мягкое удаление skill                            | `DELETE /skills/api/skills/<id>/`                   |
| `Preview Context` | Просмотр собранного skill-контекста              | `POST /skills/api/context/preview/`                 |


---

## 3. Dashboard (`/`, `/dashboard/`)

### Логика

```text
Открытие Dashboard
  -> запрос /api/dashboard/stats/
  -> обновление карточек
  -> автообновление каждые ~30 сек
```


| Кнопка/элемент               | Действие                         | Связь                |
| ---------------------------- | -------------------------------- | -------------------- |
| `Стрелка Active Servers`     | В список серверов                | `/servers/`          |
| `Стрелка Pending Tasks`      | В задачи                         | `/tasks/`            |
| `Стрелка Running Agents`     | В мониторинг                     | `/monitor/`          |
| `Стрелка Workflows`          | В Agent Hub                      | `/agents/`           |
| `Quick: Run Agent`           | Быстрый переход к запуску агента | `/agents/`           |
| `Quick: New Task`            | Создание задачи                  | `/tasks/?action=new` |
| `Quick: Add Server`          | В добавление/список серверов     | `/servers/`          |
| `Quick: AI Chat`             | В чат                            | `/chat/`             |
| `Recent runs -> View All`    | Полный список запусков           | `/monitor/`          |
| `Run an Agent` (empty state) | Быстрый старт агента             | `/agents/`           |


---

## 4. Chat (`/chat/`)

### Логика

```text
Пользователь пишет сообщение
  -> выбор provider/model/mode/RAG
  -> отправка в /api/chat/
  -> потоковый ответ
  -> в ответе могут появиться действия по задачам
```

```text
Если включен RAG
  -> запрос к /api/rag/query/
  -> найденные куски добавляются в контекст ответа
```

```text
Если открыт /chat/?task_id=N
  -> показывается панель "Обсуждаемая задача"
  -> сообщения привязаны к контексту этой задачи
```


| Кнопка/элемент                     | Что делает                               | Связь                        |
| ---------------------------------- | ---------------------------------------- | ---------------------------- |
| `Открыть панель чатов`             | Возвращает историю чатов                 | `/api/chats/`                |
| `Новый`                            | Создаёт новую сессию                     | `/api/chats/new/`            |
| `Свернуть панель`                  | Прячет левую панель истории              | UI                           |
| `Поиск по чатам`                   | Фильтрует список сессий                  | локально по истории          |
| `Элемент истории чата`             | Загружает выбранный чат                  | `/api/chats/<id>/`           |
| `Сводка задач` (quick card)        | Подставляет готовый запрос               | prompt insert                |
| `Анализ файла` (quick card)        | Подставляет запрос по файлам             | prompt insert                |
| `Статус серверов` (quick card)     | Подставляет infra-запрос                 | prompt insert                |
| `Provider`                         | Меняет backend (Auto/Cursor/Gemini/Grok) | `/api/models/`               |
| `Model`                            | Меняет модель выбранного провайдера      | `/api/models/`               |
| `RAG`                              | Вкл/выкл поиск по Knowledge Base         | `/api/rag/query/`            |
| `Mode` (`Chat/ReAct`)              | Быстрый ответ или tool-loop              | orchestrator modes           |
| `Clear history`                    | Очистка текущей истории                  | `/api/clear-history/`        |
| `Инструкции`                       | Показ панели «что умеет чат»             | UI                           |
| `Клавиши`                          | Окно shortcuts                           | UI                           |
| `Attach file`                      | Добавляет файлы в контекст               | `/api/chat/upload/`          |
| `Send`                             | Отправляет сообщение                     | `/api/chat/`                 |
| `Stop` (при стриминге)             | Останавливает текущий ответ              | abort stream                 |
| `Copy` / `Copy code` (в сообщении) | Копирует текст/код                       | clipboard                    |
| `Task modal -> Обсудить`           | Открывает обсуждение задачи в чате       | task-aware chat              |
| `Task modal -> Взять в работу`     | Ставит задачу `IN_PROGRESS`              | `/tasks/<id>/update-status/` |
| `Task modal -> Открыть задачу`     | Переход на задачу в Tasks                | `/tasks/`                    |
| `Task modal -> Удалить`            | Удаляет задачу                           | `/tasks/<id>/delete/`        |


### Кнопки внутри AI-блока «Сводка задач»


| Кнопка             | Что делает                        | Связь                        |
| ------------------ | --------------------------------- | ---------------------------- |
| `Просмотреть`      | Открывает детали задачи           | `/tasks/<id>/`               |
| `Обсудить`         | Переход в чат с контекстом задачи | `/chat/?task_id=<id>`        |
| `В работу`         | Обновляет статус задачи           | `/tasks/<id>/update-status/` |
| `Удалить` (иконка) | Удаляет задачу из системы         | `/tasks/<id>/delete/`        |


---

## 5. Tasks

## 5.1 Главная доска (`/tasks/`)

### Логика

```text
Открытие страницы
  -> выбор проекта (All/конкретный)
  -> загрузка задач
  -> доска по статусам (TODO/IN_PROGRESS/BLOCKED/DONE)
```

```text
Drag & Drop карточки
  -> перемещение в новую колонку
  -> POST /tasks/<id>/update-status/
  -> обновление счётчиков колонок
```


| Кнопка/элемент              | Что делает                        | Связь                        |
| --------------------------- | --------------------------------- | ---------------------------- |
| `Project selector`          | Выбор проекта контекста           | `/tasks/?project=<id>`       |
| `All Tasks`                 | Показывает все задачи             | `/tasks/`                    |
| `New Project` (в селекторе) | Открывает модалку проекта         | `project_create`             |
| `Views: Проекты`            | Переход в список проектов         | `/tasks/projects/`           |
| `Views: Команды`            | Переход в команды                 | `/tasks/teams/`              |
| `Views: Board`              | Канбан-доска                      | `/tasks/?view=board`         |
| `Views: Sprints`            | Спринты проекта                   | `/tasks/?view=sprints`       |
| `Views: Materials`          | Материалы проекта                 | `/tasks/?view=materials`     |
| `Views: Settings`           | Настройки проекта                 | `/settings/projects/<id>/`   |
| `Filter: My Tasks`          | Фильтр по назначению на себя      | client filter                |
| `Filter: Overdue`           | Фильтр просроченных               | client filter                |
| `Filter: AI Assigned`       | Фильтр задач ИИ                   | client filter                |
| `Clear` (filters)           | Сброс фильтров                    | client filter reset          |
| `Save current view`         | Сохраняет фильтр                  | `/tasks/filters/save/`       |
| `New Task`                  | Открывает модалку создания задачи | `/tasks/create/`             |
| `Toggle sidebar`            | Скрывает/показывает левую панель  | UI                           |
| `Search tasks`              | Быстрый поиск по заголовкам       | client filter                |
| `Tasks execution settings`  | Открывает настройки выполнения    | `/settings/#tasks-execution` |


## 5.2 Карточка и detail modal


| Кнопка/элемент            | Что делает                  | Связь                          |
| ------------------------- | --------------------------- | ------------------------------ |
| `Клик по карточке`        | Открывает detail modal      | `/tasks/<id>/`                 |
| `Иконка чата` на карточке | Переход в чат по задаче     | `/chat/?task_id=<id>`          |
| `Delete` на карточке      | Удаление задачи             | `/tasks/<id>/delete/`          |
| `Improve`                 | AI улучшает описание        | `/tasks/<id>/ai-improve/`      |
| `Breakdown`               | AI создаёт подзадачи        | `/tasks/<id>/ai-breakdown/`    |
| `Execute`                 | Делегирование в AI workflow | `/tasks/<id>/delegate-form/`   |
| `Discuss`                 | Переход в чат с task_id     | `/chat/?task_id=<id>`          |
| `Status` (select)         | Меняет статус               | `/tasks/<id>/update-status/`   |
| `Priority` (select)       | Меняет приоритет            | `/tasks/<id>/update-priority/` |
| `Server` (select)         | Меняет целевой сервер       | `/tasks/<id>/update-server/`   |
| `Add` (subtask)           | Добавляет подзадачу         | `/tasks/<id>/subtask/`         |
| `Comment`                 | Добавляет комментарий       | `/tasks/<id>/comment/`         |


## 5.3 Спринты (внутри Tasks view=sprints)


| Кнопка            | Что делает                    | Связь                                  |
| ----------------- | ----------------------------- | -------------------------------------- |
| `New Sprint`      | Модалка создания спринта      | `/tasks/projects/<id>/sprints/create/` |
| `Start Sprint`    | Запуск спринта                | `/tasks/sprints/<id>/start/`           |
| `View Board`      | Открывает доску этого спринта | `/tasks/?project=<id>&sprint=<id>`     |
| `Complete Sprint` | Завершает спринт              | `/tasks/sprints/<id>/complete/`        |


## 5.4 Материалы (внутри Tasks view=materials)


| Кнопка                 | Что делает                   | Связь                                 |
| ---------------------- | ---------------------------- | ------------------------------------- |
| `Add Material`         | Модалка добавления материала | `/tasks/projects/<id>/materials/add/` |
| `Карточка материала`   | Открывает материал           | `/tasks/materials/<id>/`              |
| `Cancel/Add` в модалке | Отмена/сохранение            | `material_add`                        |


---

## 6. Projects / Teams (отдельные страницы Tasks)

## 6.1 Projects list (`/tasks/projects/`)


| Кнопка                | Действие                              | Связь                     |
| --------------------- | ------------------------------------- | ------------------------- |
| `Поиск проектов`      | Фильтр карточек по имени/ключу        | client filter             |
| `Показать архивные`   | Переключает archived-проекты          | query `?archived=1`       |
| `Новый проект`        | Модалка создания                      | `/tasks/projects/create/` |
| `Меню проекта (⋮)`    | Открыть / Настройки / Архив / Удалить | project actions           |
| `Создать` (в модалке) | Создаёт проект                        | `project_create`          |


## 6.2 Project board (`/tasks/projects/<id>/`)


| Кнопка                                             | Действие                               | Связь                |
| -------------------------------------------------- | -------------------------------------- | -------------------- |
| `Доска / Бэклог / Спринты / Материалы / Настройки` | Навигация внутри проекта               | project pages        |
| `Задача`                                           | Создать задачу в проекте               | task create          |
| `+ Добавить задачу` в колонке                      | Создать задачу сразу в статусе колонки | task create + status |
| `Создать` в модалке                                | Создание задачи                        | `/tasks/create/`     |


## 6.3 Project settings (`/settings/projects/<id>/`)


| Кнопка                                       | Действие                     | Связь                                       |
| -------------------------------------------- | ---------------------------- | ------------------------------------------- |
| `Основные / Участники / Интеграции / Danger` | Переключение вкладок         | local tabs                                  |
| `Сохранить` (general)                        | Сохраняет основные настройки | project update                              |
| `Пригласить`                                 | Модалка приглашения по email | `/tasks/projects/<id>/invite/`              |
| `В проект` (добавить команду)                | Добавляет команду целиком    | `/tasks/projects/<id>/teams/<team_id>/add/` |
| `Role select`                                | Меняет роль участника        | `project_member_role`                       |
| `Remove member`                              | Удаляет участника            | `project_member_remove`                     |
| `Архивировать/Разархивировать`               | Меняет состояние проекта     | `project_archive`                           |
| `Удалить проект`                             | Полное удаление проекта      | `project_delete`                            |
| `Отправить приглашение`                      | Создаёт приглашение          | `project_invite`                            |


## 6.4 Project materials (`/tasks/projects/<id>/materials/`)


| Кнопка           | Действие                  | Связь             |
| ---------------- | ------------------------- | ----------------- |
| `Type filter`    | Фильтр по типу материалов | local filter      |
| `Search`         | Поиск по материалам       | local filter      |
| `Добавить`       | Модалка нового материала  | `material_add`    |
| `Открыть ссылку` | Переход по URL            | external link     |
| `Скачать`        | Скачивание файла          | file URL          |
| `Читать`         | Открытие wiki-материала   | material detail   |
| `Удалить`        | Удаление материала        | `material_delete` |


## 6.5 Sprint list (`/tasks/projects/<id>/sprints/`)


| Кнопка             | Действие            | Связь             |
| ------------------ | ------------------- | ----------------- |
| `Новый спринт`     | Модалка создания    | `sprint_create`   |
| `Начать спринт`    | Перевод в active    | `sprint_start`    |
| `Завершить спринт` | Перевод в completed | `sprint_complete` |


## 6.6 Teams


| Страница             | Кнопки                                                                                | Связь                                                     |
| -------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/tasks/teams/`      | `Создать команду`, клик по карточке команды                                           | `team_create`, `team_detail`                              |
| `/tasks/teams/<id>/` | `Редактировать`, `Удалить`, `К списку`, `Добавить`, `Удалить участника`, `смена роли` | `team_edit`, `team_delete`, `team_member_add/remove/role` |
| `/tasks/teams/create | edit/`                                                                                | `Создать/Сохранить`, `Отмена`                             |


## 6.7 Delegate form (`/tasks/<id>/delegate-form/`)


| Кнопка             | Действие             | Связь      |
| ------------------ | -------------------- | ---------- |
| `Перейти в Agents` | Открывает Agent Hub  | `/agents/` |
| `К задачам`        | Назад к списку задач | `/tasks/`  |


Автологика страницы:

```text
Открытие delegate-form
  -> POST /agents/api/workflows/from-task/
  -> если run_id получен: редирект в /agents/?run_id=...
```

---

## 7. Servers

## 7.1 Servers list (`/servers/`)


| Кнопка/элемент               | Что делает                           | Связь                         |
| ---------------------------- | ------------------------------------ | ----------------------------- |
| `Search`                     | Фильтр серверов по имени/хосту/тегам | client filter                 |
| `All Groups`                 | Фильтр по группе                     | UI filter                     |
| `All Status`                 | Фильтр по статусу                    | UI filter                     |
| `Terminal Hub`               | Открывает multi-terminal             | `/servers/hub/`               |
| `New Group`                  | Модалка группы                       | `/servers/api/groups/create/` |
| `Add Server`                 | Модалка сервера                      | `/servers/api/create/`        |
| `Group header`               | Сворачивает/разворачивает секцию     | UI collapse                   |
| `Select all`                 | Массовый выбор в группе              | bulk select                   |
| `Test Connection`            | Проверка SSH-доступности             | `/servers/api/<id>/test/`     |
| `Connect`                    | Открывает терминал сервера           | `/servers/<id>/terminal/`     |
| `Bulk: Clear`                | Сбрасывает выбор                     | bulk reset                    |
| `Bulk action select + Apply` | Массовые действия по серверам        | `/servers/api/bulk-update/`   |
| `Color presets` в группе     | Быстро ставит цвет                   | group form helper             |
| `Cancel/Add Server`          | Отмена/сохранение сервера            | `server_create`               |
| `Cancel/Create Group`        | Отмена/создание группы               | `group_create`                |


### Логика подключения

```text
Connect в карточке сервера
  -> переход в /servers/<id>/terminal/
  -> пользователь вводит мастер-пароль/пароль
  -> WebSocket SSH-сессия
```

## 7.2 Server terminal (`/servers/<id>/terminal/`)


| Кнопка                                          | Что делает                        | Связь                        |
| ----------------------------------------------- | --------------------------------- | ---------------------------- |
| `Connect`                                       | Открывает WS SSH-сессию           | `/ws/servers/<id>/terminal/` |
| `Disconnect`                                    | Разрывает сессию                  | WS close                     |
| `Clear`                                         | Очищает терминал                  | local terminal clear         |
| `AI toggle`                                     | Открывает/закрывает AI-панель     | terminal AI panel            |
| `Quick cmd: Disk/Memory/Logs/Processes/Network` | Отправляет AI-запрос по шаблону   | `ai_request` WS              |
| `Send` (AI panel)                               | Отправляет произвольный AI-запрос | `ai_request` WS              |


## 7.3 Multi-terminal hub (`/servers/hub/`)


| Кнопка                   | Что делает                                 | Связь                      |
| ------------------------ | ------------------------------------------ | -------------------------- |
| `+` (new tab)            | Открывает выбор сервера для новой вкладки  | tab manager                |
| `Server option`          | Добавляет новую терминальную вкладку       | tab create                 |
| `Tab close`              | Закрывает вкладку терминала                | tab remove                 |
| `Connect/Disconnect`     | Управление конкретной вкладкой             | per-tab WS                 |
| `Toggle AI`              | Показ/скрытие AI сайдбара вкладки          | per-tab AI                 |
| `Disk/Memory/Logs/Procs` | Быстрые AI-команды                         | per-tab AI request         |
| `Send`                   | Отправка текста AI в этой вкладке          | per-tab AI request         |
| `Confirm` / `Skip`       | Подтверждение/пропуск предложенной команды | `ai_confirm` / `ai_cancel` |


---

## 8. Agents

## 8.1 Agent Hub (`/agents/`)

### Общая логика

```text
Открытие Agents
  -> сервер рендерит workflows/runs/presets
  -> фронт подтягивает Custom Agents, Webhooks, Skills, MCP servers
  -> вкладки: Agents / Workflows / Automation / Runs
```

**Skills влияние (обновлено):**

- Skills применяются в Custom Agents, Workflow steps и Webhooks.
- Для Webhook можно передать `skill_ids` (override для workflow/script).
- Для Custom Agent skills + allowed_tools ограничивают доступные инструменты.
- В Chat skills по-прежнему не подмешиваются.

---

### Вкладка Agents (Custom Agents + Run)

| Кнопка/элемент                  | Что делает                                   | Связь                                     |
| ------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `Поиск агента`                  | Фильтрация списка                            | client filter                             |
| `+ Agent`                       | Открывает Editor                             | modal                                    |
| `Edit`                          | Редактирование агента                        | `/agents/api/custom-agents/<id>/`         |
| `Run`                           | Открывает модал Run                           | modal                                    |
| `Disable` (в карточке)          | Отключает агента                             | `DELETE /agents/api/custom-agents/<id>/`  |
| `Export`                        | Экспорт конфигурации                         | `/agents/api/custom-agents/<id>/export/`  |
| `Запустить` (в preview)         | Открывает модал Run                           | modal                                    |
| `Настроить агента`              | Открывает Editor                              | modal                                    |

**Agent Editor modal**

| Кнопка/элемент          | Что делает                    | Связь                                    |
| ----------------------- | ----------------------------- | ---------------------------------------- |
| `Save agent`            | Создаёт/обновляет агента      | `POST/PUT /agents/api/custom-agents/`    |
| `Cancel`                | Закрывает форму               | UI                                       |
| `Skills` (multi-select) | Привязывает skills            | agent.skills                             |
| `Tools`                 | Ограничивает разрешённые tools| allowed_tools                            |

**Agent Run modal**

| Кнопка/элемент              | Что делает                         | Связь                               |
| --------------------------- | ---------------------------------- | ----------------------------------- |
| `Start`                     | Запускает агента                   | `POST /agents/api/custom-agents/run/` |
| `Auto execute`              | Сразу запуск без подтверждения     | payload `auto_execute`              |
| `Server` / `Project` / `Runtime` | Контекст запуска              | payload `server_id/project_path/runtime` |
| `Cancel`                    | Закрывает модалку                  | UI                                  |

---

### Вкладка Workflows

#### Быстрый workflow

```text
Описание задачи + runtime + проект
  -> POST /agents/api/assist-auto/
  -> LLM генерирует workflow (model=auto)
  -> запускается run
```

#### Workflow Library

| Кнопка/элемент        | Что делает                    | Связь                                   |
| --------------------- | ----------------------------- | --------------------------------------- |
| `Import`              | Импорт workflow JSON          | `/agents/api/workflows/import/`         |
| `Builder`             | Открывает Task Builder         | modal                                  |
| `Edit`                | Загружает workflow в Builder   | `/agents/api/workflows/<id>/`           |
| `Script`              | Показывает JSON workflow       | script modal                            |
| `Delete`              | Удаляет workflow              | `/agents/api/workflows/<id>/delete/`    |
| `Run`                 | Запускает workflow            | `/agents/api/workflows/run/`            |

---

### Вкладка Automation (Webhooks + MCP)

#### Webhooks

| Кнопка/элемент        | Что делает                           | Связь                                     |
| --------------------- | ------------------------------------ | ----------------------------------------- |
| `Новый webhook`       | Открывает форму                       | UI                                        |
| `Preset`              | Заполняет поля под источник           | UI (email/slack/jira/github/...)          |
| `Save`                | Создаёт/обновляет webhook            | `POST/PUT /agents/api/webhooks/`          |
| `Disable`             | Отключает webhook                    | `DELETE /agents/api/webhooks/<id>/`       |
| `Copy`                | Копирует URL                          | `/agents/api/webhooks/receive/<secret>/`  |
| `Refresh`             | Обновляет список                      | `GET /agents/api/webhooks/`               |

**Webhook execution режимы:**

- `task` — создаёт Task и (опционально) авто-исполняет.
- `workflow` — создаёт workflow/run.
- `workflow_template=remediation` — авто‑ремедиация (Triage → Remediate → Verify).
- `event_name_field` / `event_id_field` позволяют маппить разные форматы payload (email/slack/jira и т.д.).

#### MCP Servers

| Кнопка/элемент  | Что делает                      | Связь                           |
| -------------- | ------------------------------- | ------------------------------- |
| `Refresh`      | Обновляет список MCP            | `/agents/api/mcp/servers/`      |
| `Connect`      | Подключает MCP                  | `/agents/api/mcp/servers/connect/` |
| `Disconnect`   | Отключает MCP                   | `/agents/api/mcp/servers/disconnect/` |
| `Tools`        | Открывает список инструментов   | `/agents/api/mcp/tools/`        |

---

### Вкладка Runs

| Кнопка/элемент        | Что делает                                 | Связь                                     |
| --------------------- | ------------------------------------------ | ----------------------------------------- |
| `Logs` (workflow)     | Открывает логи workflow-run                | `/agents/logs/?type=workflow&run_id=<id>` |
| `Stop`                | Останавливает активный run                 | `/agents/api/workflows/run/<id>/stop/`    |
| `Restart`             | Перезапуск run                             | `/agents/api/workflows/run/<id>/restart/` |
| `Delete`              | Удаляет run                                | `/agents/api/workflows/run/<id>/delete/`  |
| `Logs` (agent run)    | Открывает логи агент-рана                  | `/agents/logs/?type=run&run_id=<id>`      |
| `Stop` (agent run)    | Останавливает запуск агента                | `/agents/api/runs/<id>/stop/`             |

---

## 8.2 AI Analysis modal (внутри Builder)

| Кнопка/элемент    | Что делает                                     | Связь                        |
| ----------------- | ---------------------------------------------- | ---------------------------- |
| `Анализировать`   | Старт AI-анализа задачи                        | `/agents/api/smart-analyze/` |
| `Создать Workflow`| Отправляет ответы и генерирует шаги            | smart analyze flow           |
| `Применить`       | Переносит шаги в Builder                       | task builder state           |
| `Отмена` / `X`    | Закрывает модалку                              | UI                           |

## 8.3 Task Builder modal (обновлённый UI)

| Кнопка/элемент           | Что делает                  | Связь                                             |
| ------------------------ | --------------------------- | ------------------------------------------------- |
| `AI Анализ`              | Открывает AI Analysis       | smart analyzer                                    |
| `+ Добавить`             | Добавляет шаг в workflow    | builder task list                                 |
| `Добавить тест`          | Раскрывает verify-блок шага | builder step test                                 |
| `Удалить задачу`         | Удаляет шаг                 | builder task remove                               |
| `Очистить все`           | Сбрасывает список шагов     | builder reset                                     |
| `Сохранить workflow`     | Сохраняет без запуска       | `/agents/api/workflows/create-manual/` или update |
| `Сохранить и запустить`  | Сохраняет и сразу запускает | save + `/agents/api/workflows/run/`               |
| `Отмена`                 | Закрытие конструктора       | UI                                                |

## 8.4 Logs pages

| Страница              | Кнопки                                                                      | Связь                                               |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| `/agents/logs/`       | `Автоскролл`, `Обновить`, `Копировать всё`, `Показать Raw`                  | `/agents/api/runs/*`, `/agents/api/workflows/run/*` |
| `/agents/admin/logs/` | `Auto toggle`, `Refresh`, `Save`, `Restart`, tab/filter chips, copy buttons | admin runs API                                      |

## 8.5 Legacy / Standalone Custom Agents (`/agents/custom-agents/`)

Страница оставлена как отдельный интерфейс, но основной UI находится в `/agents/`.

| Кнопка             | Что делает                          | Связь                                      |
| ------------------ | ----------------------------------- | ------------------------------------------ |
| `+ Создать агента` | Открывает форму конструктора        | builder form                               |
| `Сохранить агента` | Создаёт/обновляет кастомного агента | `/agents/api/custom-agents/`               |
| `Отмена`           | Закрывает конструктор               | UI                                         |
| `Редактировать`    | Загружает агента в форму            | `/agents/api/custom-agents/<id>/`          |
| `Тест`             | Пробный запуск агента               | `/agents/api/custom-agents/run/`           |
| `Export JSON`      | Экспорт конфигурации агента         | `/agents/api/custom-agents/<id>/export/`   |
| `Удалить`          | Удаляет агента                      | `/agents/api/custom-agents/<id>/` (DELETE) |

## 9. Knowledge Base (`/knowledge-base/`)

### Логика

```text
Add document
  -> /api/rag/add/
  -> документ индексируется
  -> список документов обновляется
```

```text
Search
  -> /api/rag/query/
  -> вывод релевантных фрагментов
```


| Кнопка/элемент                         | Что делает                   | Связь              |
| -------------------------------------- | ---------------------------- | ------------------ |
| `Search`                               | Семантический поиск          | `/api/rag/query/`  |
| `Reset`                                | Полный сброс базы            | `/api/rag/reset/`  |
| `Add document`                         | Открывает модалку добавления | add modal          |
| `Delete` в строке документа            | Удаление документа           | `/api/rag/delete/` |
| `Clear filters`                        | Сброс source/text фильтра    | local filter       |
| `Cancel/Add` в модалке                 | Отмена/добавление            | `/api/rag/add/`    |
| `Обновить страницу` (если RAG offline) | Повторная проверка состояния | page reload        |


---

## 10. Settings

## 10.1 Main settings (`/settings/`)


| Кнопка/элемент                  | Что делает                              | Связь                                          |
| ------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `Дополнительные настройки`      | Раскрывает блок advanced моделей        | UI collapse                                    |
| `Save model settings`           | Сохраняет провайдер/модели/режимы       | `/api/settings/`                               |
| `Сохранить папку`               | Сохраняет default output path агента    | `/api/settings/`                               |
| `Сохранить настройки задач`     | Сохраняет execution settings            | `/tasks/settings/update/` или `/api/settings/` |
| `Clear chat history`            | Очищает историю чата пользователя       | `/api/clear-history/`                          |
| `Обновить` (Disk)               | Обновляет отчёт места на диске          | `/api/disk/`                                   |
| `Открыть` (Управление доступом) | Переход к users/groups/permissions      | `/settings/access/`                            |
| `Карточка проекта`              | Переход в настройки конкретного проекта | `/settings/projects/<id>/`                     |


## 10.2 Access management (`/settings/access/`)


| Кнопка                             | Что делает                            | Связь                                    |
| ---------------------------------- | ------------------------------------- | ---------------------------------------- |
| `Вкладки Users/Groups/Permissions` | Переключение секции                   | `?tab=...`                               |
| `Добавить` (Users)                 | Открывает модалку нового пользователя | `/api/access/users/`                     |
| `Да/Нет Staff`                     | Переключает staff-флаг                | user update                              |
| `Да/Нет Активен`                   | Переключает active-флаг               | user update                              |
| `Edit user`                        | Редактирование пользователя           | `/api/access/users/<id>/`                |
| `Key` (password)                   | Смена пароля пользователя             | `/api/access/users/<id>/password/`       |
| `Delete user`                      | Удаление пользователя                 | `/api/access/users/<id>/` (DELETE)       |
| `Добавить` (Groups)                | Модалка новой группы                  | `/api/access/groups/`                    |
| `Edit group`                       | Редактирование группы                 | `/api/access/groups/<id>/`               |
| `Delete group`                     | Удаление группы                       | `/api/access/groups/<id>/` (DELETE)      |
| `x` у участника группы             | Удаление участника из группы          | `/api/access/groups/<id>/members/`       |
| `Добавить` (Permissions)           | Добавление персонального права        | `/api/access/permissions/`               |
| `Разрешён/Запрещён`                | Переключение права                    | permission update                        |
| `Delete permission`                | Удаление права                        | `/api/access/permissions/<id>/` (DELETE) |


---

## 11. Passwords (`/passwords/`)


| Кнопка                | Что делает                | Связь                                |
| --------------------- | ------------------------- | ------------------------------------ |
| `New Credential`      | Открывает форму создания  | create modal                         |
| `Карточка credential` | Открывает просмотр записи | `viewCredential()` (сейчас заглушка) |
| `Generate`            | Генерирует пароль         | `/passwords/api/generate-password/`  |
| `Save`                | Сохраняет credential      | `/passwords/api/create/`             |
| `Cancel`              | Закрывает модалку         | UI                                   |


---

## 12. Monitor (`/monitor/`)


| Кнопка/элемент                         | Что делает                            | Связь                                      |
| -------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `Refresh`                              | Перезагрузка списка/статусов запусков | monitor refresh                            |
| `Live`                                 | Вкл/выкл live-обновления              | polling toggle                             |
| `Sidebar collapse`                     | Сворачивает левую колонку             | UI                                         |
| `Run search`                           | Поиск запусков                        | local filter                               |
| `Type/Status filters`                  | Фильтр запусков                       | local filter                               |
| `Tab: Logs/Command/Config/Raw`         | Переключение вкладок деталей          | UI tabs                                    |
| `Log chips` (`All/Messages/Tools/...`) | Фильтр событий в логе                 | local filter                               |
| `Copy logs`                            | Копирует логи                         | clipboard                                  |
| `Auto-scroll`                          | Автопрокрутка лога                    | UI toggle                                  |
| `Copy` (Command/Prompt/Raw)            | Копирует выбранный блок               | clipboard                                  |
| `Stop`                                 | Останавливает активный run            | `/agents/api/*/stop/`                      |
| `Retry`                                | Повтор шага workflow                  | `/agents/api/workflows/run/<id>/retry/`    |
| `Skip`                                 | Пропуск шага workflow                 | `/agents/api/workflows/run/<id>/skip/`     |
| `Continue`                             | Продолжить paused/failed workflow     | `/agents/api/workflows/run/<id>/continue/` |


---

## 13. IDE (`/ide/`)


| Кнопка/элемент           | Что делает                          | Связь                             |
| ------------------------ | ----------------------------------- | --------------------------------- |
| `Project selector`       | Выбор проекта/папки                 | `/agents/api/projects/` + ide API |
| `Файл в дереве`          | Открывает файл во вкладке           | `/api/ide/file/` (GET)            |
| `Сохранить (Ctrl+S)`     | Записывает изменения файла          | `/api/ide/file/` (POST)           |
| `Отправить` (чат агента) | Запрос к агенту по текущему проекту | ide agent flow                    |


---

## 14. Orchestrator (`/orchestrator/`)


| Кнопка/элемент                 | Что делает                              | Связь         |
| ------------------------------ | --------------------------------------- | ------------- |
| `Refresh`                      | Перезагружает список инструментов       | `/api/tools/` |
| `Search tools`                 | Фильтр по названию/описанию             | local filter  |
| `All / Filesystem / SSH / Web` | Фильтр по категории                     | local filter  |
| `Try again` (ошибка)           | Повторная загрузка инструментов         | `/api/tools/` |
| `Toggle tool`                  | Локально включает/выключает в UI (демо) | UI state      |


---

## 15. Мобильные кнопки (основные)

## 15.1 Глобально (mobile base)


| Кнопка                                    | Действие                                               |
| ----------------------------------------- | ------------------------------------------------------ |
| Нижняя навигация `Чат/Задачи/Агенты/База` | Быстрый переход по разделам                            |
| `Ещё`                                     | Открывает drawer: Servers, Passwords, Settings, Logout |
| `Back`                                    | Возврат на предыдущий экран                            |


## 15.2 Mobile Chat


| Кнопка                                                     | Действие              |
| ---------------------------------------------------------- | --------------------- |
| `History`                                                  | Открыть историю чатов |
| `New`                                                      | Новый чат             |
| Quick actions (`Веб-поиск`, `Файлы`, `SSH`, `Инструменты`) | Быстрые промпты       |
| `RAG`                                                      | Вкл/выкл RAG          |
| `Send`                                                     | Отправка сообщения    |


## 15.3 Mobile Tasks


| Кнопка                       | Действие                   |
| ---------------------------- | -------------------------- |
| `Filter` (header)            | Открытие фильтров          |
| `Tabs TODO/IN_PROGRESS/DONE` | Переключение списков       |
| `Swipe Edit/Delete`          | Быстрое действие по задаче |
| `FAB +`                      | Создать задачу             |
| `Создать` в модалке          | Сохранить новую задачу     |


## 15.4 Mobile Agents


| Кнопка                                      | Действие                         |
| ------------------------------------------- | -------------------------------- |
| `Refresh`                                   | Обновить данные агентов/запусков |
| `Tabs Agents/Workflows/Automation/Runs`    | Переключение контента            |
| `Run workflow`                              | Запуск workflow                  |
| `Edit/Delete workflow`                      | Управление workflow              |
| `FAB +`                                     | Быстрое меню создания            |
| `Новый Workflow/Новый Агент/Быстрая задача` | Быстрый сценарий запуска         |
| `Logs: Stop/Refresh`                        | Управление активным run          |


## 15.5 Mobile Servers / Terminal


| Кнопка                     | Действие                        |
| -------------------------- | ------------------------------- |
| `Подключиться`             | Открыть терминал сервера        |
| `Тест`                     | Проверить соединение            |
| `Connect/Disconnect/Clear` | Управление SSH сессией          |
| `AI` (в заголовке)         | Открывает AI drawer в терминале |
| `Send` (AI drawer)         | Отправка AI запроса по серверу  |


## 15.6 Mobile Knowledge / Passwords / Settings


| Раздел    | Кнопки                                                 |
| --------- | ------------------------------------------------------ |
| Knowledge | `+`, `FAB`, `Добавить`, `Отмена`, поиск по базе        |
| Passwords | `+`, `FAB`, `Copy`, поиск по записям                   |
| Settings  | Переход в `Управление доступом`, просмотр статусов API |


---

## 16. Короткая карта связей между разделами

```text
Tasks -> Discuss -> Chat (task_id)
Tasks -> Execute/Delegate -> Agents (workflow run)
Agents/Monitor -> Logs -> контроль выполнения
Servers <-> Tasks (target_server)
Knowledge Base -> Chat (через RAG toggle)
Settings -> влияет на Chat/Agents/Tasks (модели, режимы, права)
Skills -> Agents/Workflows/Webhooks (контекст выполнения)
Webhooks -> Tasks/Workflows (авто‑создание и запуск)
```

---

## 17. AI-логика по кнопкам (подробно: какие инструкции получает ИИ и что выводится)

Ниже именно AI-поведение: что отправляется в prompt/контекст, какие форматы ответов ожидаются, и что в итоге видит пользователь.

## 17.1 Chat: `Send`, `Mode`, `RAG`, `Discuss`

### Поток кнопки `Send`

```text
Send
  -> POST /api/chat/
     body: message, model, specific_model, use_rag, chat_id, task_context_id, mode
  -> backend выбирает путь:
     A) Cursor path (provider=cursor/auto->cursor)
     B) Unified Orchestrator path (chat/react и др.)
  -> ответ стримится в UI кусками
```

### Что именно получает ИИ в Chat

**Skills** в чат не подмешиваются (используются только в Agents/Workflows).


| Сценарий            | Что добавляется к запросу пользователя                                                                                          | Что это даёт                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Cursor` path       | Контекст серверов пользователя (`=== СЕРВЕРЫ ПОЛЬЗОВАТЕЛЯ ===`, команды подключения), плюс `TASK CONTEXT` если открыт `task_id` | Cursor видит инфраструктурный контекст и может отвечать по конкретной задаче |
| `Mode = Chat`       | `CHAT_SYSTEM_RULES` + список tools + короткая история + (опц.) RAG + task context                                               | Быстрый ответ, обычно 0-1 tool action                                        |
| `Mode = ReAct`      | `AGENT_SYSTEM_RULES_RU` + tools + история + RAG + execution_context                                                             | Итеративная логика `THOUGHT/ACTION/OBSERVATION`                              |
| `RAG = ON`          | Перед генерацией выполняется `api/rag/query` и фрагменты добавляются в prompt                                                   | Ответы опираются на базу знаний                                              |
| `Discuss` по задаче | В `execution_context.task_context` передаётся id/title/status/priority/due_date/description задачи                              | ИИ отвечает про текущую задачу, а не про все задачи                          |


Дополнительно по кнопке `Attach file`:

```text
Attach file
  -> POST /api/chat/upload/
  -> файл извлекается в текст
  -> текст добавляется в RAG (source=upload:<filename>)
  -> при включённом RAG этот материал начинает попадать в ответы
```

### Кнопка `Mode` (Chat/ReAct): различие инструкций

```text
Mode = Chat
  -> инструкция ИИ: при необходимости дать ОДНУ строку ACTION: tool_name {...}
  -> после tool-result дать финальный ответ пользователю

Mode = ReAct
  -> инструкция ИИ: думать по шагам
  -> формат шага: THOUGHT + ACTION
  -> после OBSERVATION продолжать цикл
  -> финальный ответ без ACTION
```

### Что Chat UI должен уметь вывести из AI-стрима


| Формат в стриме                       | Что это                         | Что делает UI                                                                     |
| ------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `CHAT_ID:<id>`                        | Идентификатор новой chat-сессии | Сохраняет chat_id и обновляет историю                                             |
| Обычный текст                         | Стандартный ответ ассистента    | Рендер markdown                                                                   |
| `WEU_TASKS_JSON:{...}`                | Специальный payload доски задач | Рисует карточки задач с кнопками `Просмотреть`, `Обсудить`, `В работу`, `Удалить` |
| JSON-chunks Cursor (`type=assistant`) | Частичные ответы Cursor         | Собирает единый текст ответа                                                      |


### Внутренняя AI-инструкция для задач в чате

Когда запрос про список задач, агент получает правило: использовать `tasks_list`, а для детального ответа — `task_detail`.  
Для `tasks_list` формируется payload `task_board`:

```text
AI вызывает tasks_list/task_detail
  -> backend строит WEU_TASKS_JSON (summary + tasks + actions)
  -> UI строит интерактивную сводку задач
  -> кнопки в карточках сразу вызывают task API
```

---

## 17.2 Tasks: AI-кнопки в модалке задачи


| Кнопка      | Какая инструкция идёт в ИИ                                                                                           | Какой ожидается ответ ИИ             | Что делает UI/Backend                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| `Improve`   | Prompt: “Improve task description… Return only plain text”                                                           | Только улучшенный текст описания     | `POST /tasks/<id>/ai-improve/`, описание заменяется |
| `Breakdown` | Prompt: “Break down task… Return JSON list of strings”                                                               | JSON-массив подзадач                 | `POST /tasks/<id>/ai-breakdown/`, создаются SubTask |
| `Discuss`   | В чат передаётся `task_context_id`                                                                                   | Ответ с фокусом на конкретной задаче | Переход в `/chat/?task_id=<id>`                     |
| `Execute`   | В текущем UI это переход `/?task_id=<id>`; основной прод-флоу делегирования идёт через уведомления и `delegate-form` | -                                    | Далее запуск workflow из задачи в Agent Hub         |


### Что ИИ получает при Smart-анализе задачи

При создании задачи запускается фоновый анализ:

```text
Создание Task
  -> background analyze
  -> ИИ получает: title + description + список доступных серверов + список custom agents
  -> ИИ возвращает JSON (can_delegate_to_ai, target_server_name, recommended_agent, ...)
  -> создаются уведомления с кнопками действия
```

Строгий формат анализа:

`can_delegate_to_ai`, `target_server_name`, `recommended_custom_agent_id`, `recommended_agent`, `reason`, `missing_info`, `estimated_time`, `complexity`, `risks`.

---

## 17.3 Tasks: уведомления с AI-действиями (колокольчик)


| Тип уведомления                  | Что уже решила AI-логика                  | Кнопки пользователя                      | Что происходит после клика                                                             |
| -------------------------------- | ----------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `AUTO_EXECUTION_SUGGESTION`      | Есть сервер + задача делегируема          | `Делегировать ИИ`, выбор другого сервера | `notification_action(delegate/change_server)` -> approve -> создание и запуск workflow |
| `SERVER_CONFIRMATION`            | Сервер найден, но требуется подтверждение | `Подтвердить`, выбор другого сервера     | `confirm_server`/`change_server` -> запуск workflow                                    |
| `QUESTIONS_REQUIRED`             | Не хватает данных (`missing_info`)        | Поля ответов + `Отправить ответы`        | `answer_questions` -> повторный анализ -> возможен авто-старт workflow                 |
| `INFO/WARNING` + `select_server` | Сервер не определён                       | Выбор сервера + подтверждение            | `select_server` -> сервер назначается -> старт workflow                                |


### Что должно выводиться пользователю после action

```text
Успех
  -> success=true
  -> message (например: "Workflow создан и запущен ...")
  -> url/redirect_to (chat или task_form)

Ошибка
  -> success=false
  -> error (например: "Сервер не найден")
```

---

## 17.4 Servers Terminal: AI-панель (`Disk/Memory/Logs/...`, `Send`, `Confirm/Skip`)

### Что получает ИИ при `Send`/quick-кнопках

```text
AI request
  -> WS message: {type:"ai_request", message:"check disk space" ...}
  -> backend добавляет:
     - rules_context (global/group/server policies)
     - forbidden command patterns
     - terminal tail (последний вывод)
  -> внутренний prompt требует:
     - вернуть ТОЛЬКО JSON
     - assistant_text + commands[{cmd, why}]
     - сначала безопасные проверки
```

Формат, который обязана вернуть модель-планировщик:

```json
{
  "assistant_text": "...",
  "commands": [{"cmd": "...", "why": "..."}]
}
```

### Что должно выводиться в UI Terminal


| Событие WS          | Значение                                      | Что видит пользователь                                                 |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `ai_response`       | `assistant_text`, `commands[]`                | Текст AI + карточки команд                                             |
| `ai_command_status` | `running/done/skipped/confirmed`, `exit_code` | Статус каждой команды                                                  |
| `ai_status`         | `thinking/running/waiting_confirm/idle`       | Служебное состояние AI-цикла (может использоваться UI для индикаторов) |
| `ai_error`          | `message`                                     | Ошибка AI-панели                                                       |


### Логика `Confirm/Skip`

```text
Команда помечена requires_confirm=true
  -> пользователь жмёт Confirm
  -> WS: ai_confirm(id)
  -> команда выполняется

Команда помечена requires_confirm=true
  -> пользователь жмёт Skip
  -> WS: ai_cancel(id)
  -> команда пропускается, цикл идёт дальше
```

`requires_confirm` выставляется, если команда попадает в forbidden-паттерны или считается опасной (`rm -rf`, `mkfs`, `dd if=`, `shutdown`, `reboot`, `systemctl stop/disable/mask`, `truncate -s 0` и т.д.).

---

## 17.5 Agents: `AI Анализ`, `Создать Workflow`, делегирование из Task


| Экран/кнопка                                       | Что получает ИИ                                                     | Что должен вернуть ИИ                                                           | Результат                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Builder `AI Анализ` (`/agents/api/smart-analyze/`) | Текст задачи (+ контекст проекта, если есть)                        | JSON: `ready`, `questions[]`, `subtasks[]`, `overall_complexity`, `warnings[]`  | Заполняется модалка анализа, затем шаги в Builder                |
| Task -> `delegate-form`                            | Текст задачи + runtime + target server                              | JSON-script workflow (`name`, `description`, `runtime`, `task_type`, `steps[]`) | Создаётся workflow и сразу run, редирект в `/agents/?run_id=...` |
| Генерация server-task workflow                     | Инструкция “используй только server_execute”, простые shell-команды | Минимальный JSON со step-командами                                              | Без примесей code/refactor логики                                |
| Генерация code-task workflow                       | Инструкция “работа в isolated dir, короткие шаги, verify_prompt”    | JSON с шагами + completion/verify promises                                      | Оркестрированный run по шагам                                    |


---

**Skills в Agents:**

- `skill_ids` задаются у workflow или custom agent.
- При запуске run собирается `skill_context` и добавляется в prompt каждого шага.
- Недоступные skills (не owner/shared) автоматически отбрасываются.

## 17.6 Настройки, которые напрямую меняют поведение ИИ


| Настройка                             | Где                | На что влияет                                      |
| ------------------------------------- | ------------------ | -------------------------------------------------- |
| `default_provider`, модели chat/agent | `/settings/`       | Какая модель отвечает в чате/агентах               |
| `default_orchestrator_mode`           | `/settings/`       | Базовый режим оркестратора (`chat/react/ralph...`) |
| `cursor_chat_mode` (`ask/agent`)      | `/settings/`       | Как запускается Cursor CLI в чате                  |
| `require_server_confirmation`         | `/tasks/settings/` | Всегда ли подтверждать сервер перед запуском       |
| `auto_execute_simple_tasks`           | `/tasks/settings/` | Автозапуск при `complexity=simple`                 |
| `ask_questions_before_execution`      | `/tasks/settings/` | Создавать ли QUESTIONS_REQUIRED перед запуском     |
| `default_server`                      | `/tasks/settings/` | Фолбэк-сервер, если в задаче сервер не найден      |
| `delegate_ui` (`chat/task_form`)      | `/settings/`       | Куда редиректить после делегирования               |


---

## 17.7 Главные правила безопасности и формата (что ИИ обязан соблюдать)

```text
Если данных не хватает
  -> задать 1-2 уточняющих вопроса
  -> не выполнять ACTION до уточнения

Если задача рискованная
  -> описать шаги
  -> запросить подтверждение

Для инструментов
  -> строго форматы ACTION / THOUGHT / JSON (в зависимости от режима)
  -> не выдумывать данные
  -> использовать только доступные tools и контекст пользователя
```

Этот документ можно использовать как "операционную карту UI": что нажимать, куда ведёт, и как это связано с логикой платформы.
