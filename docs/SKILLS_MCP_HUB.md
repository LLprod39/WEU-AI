# Skills / MCP — как устроено и откуда берутся данные

## Обзор раздела

В интерфейсе **Skills / MCP** (Hub) есть четыре вкладки:

1. **Overview** — сводка по скиллам и MCP.
2. **Skills** — «Мои скиллы», каталог скиллов, установка по URL.
3. **MCP** — список «Мои MCP» с редактором (добавление/редактирование), каталог MCP с установкой по одной и «Установить все», загрузка каталога по URL.
4. **Генератор MCP** — создание MCP-сервера с помощью ИИ по описанию.

---

## Как работает MCP

### Откуда берутся MCP в каталоге

Каталог MCP **не подгружается с сайта в реальном времени**. Он читается из **локального JSON-файла** в репозитории:

- Файл: `skills/mcp_catalog.json`
- Загрузка: при открытии Hub и при запросах к API каталога вызывается `_load_mcp_catalog()` в `skills/views.py`, который читает этот файл.

Сейчас в каталоге заданы серверы из официального репозитория [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers), например:

- **filesystem** — работа с файловой системой
- **github** — операции с GitHub (нужен `GITHUB_PERSONAL_ACCESS_TOKEN`)
- **postgres** — PostgreSQL
- **fetch** — загрузка веб-страниц
- **memory** — хранилище ключ–значение для агента

Поле `source_url` в записях каталога — это только **метаданные** (откуда взят шаблон), а не источник, с которого приложение что-то качает.

### Как добавить и редактировать MCP

1. **Список и редактор**  
   На вкладке **MCP** слева — список «Мои MCP» с поиском. Кнопки «Новый MCP» и «Обновить». Клик по записи открывает её в редакторе справа (Name, Command, Args, Env, описание). Кнопки **Сохранить** (POST при создании, PUT при редактировании) и **Удалить**. Выпадающий список «В агента…» на карточке добавляет MCP в выбранного агента.

2. **Из каталога**  
   В блоке «Каталог MCP» у каждой записи — кнопка **Установить**: модалка «В Мои MCP» и опционально «Добавить в агента». Кнопка **Установить все** устанавливает все записи текущего каталога (модалка с теми же опциями).

3. **Загрузка каталога по URL**  
   Поле «URL JSON-каталога» и кнопка **Загрузить каталог**: отправляется POST на `api/mcp/catalog/fetch/`, по ответу отображаемый каталог подменяется загруженным JSON-массивом (формат: объекты с `name`/`id`, `command`, `args`, `env`, `description`). Дальше можно ставить «Установить» по одной или «Установить все».

4. **Через генератор**  
   Вкладка «Генератор MCP» — описание задачи и опционально документация API; ИИ генерирует код MCP-сервера. Код можно сохранить в «Мои MCP» и привязать к агенту.

---

## Как работают Skills

### Откуда берутся скиллы в каталоге

Каталог скиллов тоже **локальный**:

- Файл: `skills/skill_catalog.json`
- Загрузка: `_load_skill_catalog()` в `skills/views.py`.

В каталоге заданы, например, скиллы из [modelcontextprotocol/skills](https://github.com/modelcontextprotocol/skills): DevOps Policy, Safe Commands и т.д. Это не «живая» подгрузка с GitHub, а заранее прописанный список в JSON.

### Как добавить скилл

1. **Из каталога**  
   В разделе **Skills** кнопка «Магазин» открывает модальное окно «Каталог Skills». Список строится из `skill_catalog.json`. У каждого пункта — кнопка **Установить** (по `catalog_id`). В шапке модалки — кнопка **Установить все**: устанавливаются все скиллы из каталога без дубликатов по slug.

2. **По URL (любой GitHub)**  
   В том же окне блок **«Установить по URL»**: URL репозитория, ветка (`main`) и путь к файлу скилла (`SKILL.md`). Установка через `api_skill_catalog_install` — скилл создаётся с `source_type=git` и выполняется sync.

---

## Где брать готовые MCP и скиллы (сайты / GitHub)

- **MCP-серверы (официальные и сообщество)**  
  - [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) — эталонные серверы (filesystem, github, fetch, memory и др.).  
  - [Официальный реестр MCP](https://registry.modelcontextprotocol.io/) — каталог с API для поиска серверов (формат `server.json`, команды, env и т.д.). В приложении пока **не используется** — каталог только из `mcp_catalog.json`.

- **Скиллы**  
  - [modelcontextprotocol/skills](https://github.com/modelcontextprotocol/skills) — примеры и кураторские скиллы.  
  - Любой репозиторий с файлом в формате скилла (например `SKILL.md`) можно добавить через «Установить по URL» в Магазине.

- **MCP**: добавление и редактирование в списке «Мои MCP»; установка по одной и **«Установить все»** из каталога; **загрузка каталога по URL** (JSON), затем установка по кнопкам.
- **Skills**: установка по одной и **«Установить все»** в модалке «Каталог Skills»; установка по URL с любого GitHub.

---

## Внешние каталоги для парсинга (источники в интернете)

Эти сайты и API можно использовать, чтобы подгружать каталоги MCP и Skills на наш веб.

### MCP (серверы)

| Источник | URL | Описание |
|----------|-----|----------|
| **Официальный MCP Registry** | https://registry.modelcontextprotocol.io | Реестр метаданных MCP-серверов. REST API: `GET /v0.1/servers?limit=100` (пагинация: `cursor`). Документация: https://registry.modelcontextprotocol.io/docs и https://modelcontextprotocol.info/tools/registry/consuming/ . В интерфейсе Hub есть кнопка **«Загрузить из MCP Registry»** — каталог подтягивается с этого API и приводится к формату нашего каталога. |
| **Официальные reference-серверы (GitHub)** | https://github.com/modelcontextprotocol/servers | Репозиторий с эталонными серверами (filesystem, fetch, memory, git, time и др.). Список папок: https://api.github.com/repos/modelcontextprotocol/servers/contents/src . Мы уже храним часть из них в `mcp_catalog.json`. |
| **Awesome MCP (каталог)** | https://awesomemcp.io | Веб-каталог с большим количеством MCP-серверов по категориям (на человекочитаемый просмотр, не JSON API). |
| **Awesome MCP Servers (GitHub)** | https://github.com/punkpeye/awesome-mcp-servers | Кураторский список на GitHub. |

### Skills (скиллы)

| Источник | URL | Описание |
|----------|-----|----------|
| **Каталог в проекте** | `skills/skill_catalog.json` | Локальный каталог; записи ссылаются на репозиторий и путь (например `source_url`: https://github.com/modelcontextprotocol/skills , `source_path`: `skills/.curated/...`). Установка по кнопке или «Установить все» тянет контент из GitHub при sync. |
| **Установка по URL** | В модалке «Каталог Skills» | Любой GitHub-репозиторий с файлом скилла (например `SKILL.md`): ввести URL, ветку и путь — скилл создаётся и синхронизируется с репо. Отдельного единого «сайта-каталога» скиллов с парсингом в интернете нет; каталог задаётся локально, контент — с GitHub. |

Итого: для **MCP** парсим официальный реестр (registry.modelcontextprotocol.io) через нашу кнопку «Загрузить из MCP Registry»; для **Skills** каталог ведётся в репозитории, контент подтягивается с GitHub при установке.

---

## Возможные доработки

- Дополнительные источники MCP (например, сторонние реестры с JSON API) можно подключать через «Загрузить каталог» по URL, если они отдают массив в формате: `[{ "name", "command", "args", "env?", "description?" }]`.

---

## Файлы в проекте

| Назначение              | Файл / место |
|-------------------------|--------------|
| Каталог MCP (данные)    | `skills/mcp_catalog.json` |
| Каталог Skills (данные) | `skills/skill_catalog.json` |
| Загрузка каталогов      | `skills/views.py`: `_load_mcp_catalog()`, `_load_skill_catalog()` |
| API каталога MCP        | `api_mcp_catalog_list`, `api_mcp_catalog_install`, `api_mcp_catalog_install_all`, `api_mcp_catalog_fetch`, `api_mcp_catalog_fetch_registry` (загрузка с registry.modelcontextprotocol.io) |
| API каталога Skills     | `api_skill_catalog_list`, `api_skill_catalog_install`, `api_skill_catalog_install_all` (поддерживает `source_url`) |
| Модель «Мои MCP»        | `skills/models.py`: `UserMCPServer` |
| UI Hub                  | `skills/templates/skills/hub.html` |
| URL-маршруты            | `skills/urls.py` |

Добавление новых записей в каталог без доработки кода: отредактировать `mcp_catalog.json` или `skill_catalog.json` (формат смотри по существующим записям) и перезагрузить страницу / перезапустить приложение при необходимости.
