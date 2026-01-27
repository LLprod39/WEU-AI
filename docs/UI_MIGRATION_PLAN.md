# План миграции UI: work_ai → web_rA

**Дата аудита:** 2025-01-27  
**Источник:** `c:\work_ai\core_ui`, `c:\work_ai\agent_hub`  
**Цель:** `c:\work_ai\agent_projects\web_rA\core_ui`, `c:\work_ai\agent_projects\web_rA\agent_hub`

---

## 1. Сравнение структур

### 1.1 Источник (work_ai)

| Путь | Содержимое |
|------|------------|
| `core_ui/templates/` | base.html, chat.html, knowledge_base.html, login.html, orchestrator.html, settings.html |
| `core_ui/static/css/` | style.css (~516 строк) |
| `agent_hub/templates/agent_hub/` | agents.html |

**Замечания:** Нет `agent_hub/static` в источнике. Единый `style.css` без системы тем/плотности.

### 1.2 Цель (web_rA)

| Путь | Содержимое |
|------|------------|
| `core_ui/templates/` | base.html, chat.html, knowledge_base.html, login.html, orchestrator.html, settings.html |
| `core_ui/static/css/` | style.css (~1046 строк) |
| `agent_hub/templates/agent_hub/` | agents.html |

**Замечания:** Структура папок совпадает. В web_rA один расширенный `style.css` с темами, плотностью, UI-панелью, toast, empty-state, skeleton, glass-утилитами.

### 1.3 Итог по структурам

- **Имена файлов** совпадают.
- **Дополнительных шаблонов/статики** в источнике нет — миграция идёт только из work_ai в web_rA в рамках уже существующих файлов.
- Решение: оставить структуру web_rA; при необходимости переносить отдельные идеи/блоки из work_ai в соответствующие файлы web_rA.

---

## 2. Таблица: страница → что лучше/новее → что переносим/улучшаем → что удаляем

| Страница | Что лучше/новее | Что переносим/улучшаем | Что удаляем как дубли |
|----------|------------------|------------------------|------------------------|
| **base.html** | В **web_rA**: панель UI-настроек (тема/плотность/размер/анимации), сворачиваемый сайдбар, мобильное меню, Toast, health check, блок breadcrumbs, ссылка «Обратная связь», aria-атрибуты, data-theme/density/size. В work_ai — только базовый layout. | Ничего не переносим из work_ai. В web_rA: вынести inline `<style>` и `<script>` в static (см. раздел 4). | Дублей между проектами нет; в работе используем только версию web_rA. |
| **style.css** | В **web_rA**: система CSS-переменных, [data-theme], [data-density], [data-size], UI-панель, toast, empty-state, skeleton, glass-sm/md/lg, статусы (status-online/offline/reconnecting), mobile-menu, sidebar overlay. | Оставить style.css web_rA как основу. При желании можно точечно взять из work_ai отсутствующие утилиты (если появятся потребности). | Не дублировать старый style.css work_ai; один общий файл — в web_rA. |
| **chat.html** | В **web_rA**: «Enterprise AI Assistant», corporate-чат (сетка, карточки быстрых действий), раздельные Provider/Model, панель контекста задачи (task_id), горячие клавиши (Ctrl+Enter, Ctrl+/, Ctrl+L), overlay справки, copy-кнопки у блоков кода, showToast, timestamp в сообщениях. В work_ai — один model-select и простые quick-action кнопки. | Ничего из work_ai. В web_rA: перенести большой inline `<style>` и `<script>` в static (см. раздел 4). | Дубли: логику getCookie, showNotification/showToast лучше держать в одном месте (base или общий js); в chat — только вызов. |
| **knowledge_base.html** | В **web_rA**: компактный статус-бар (.kb-status-pill), загрузка документов по API (loadDocuments), skeleton при загрузке, empty-state, модалка .kb-modal, классы .kb-*. В work_ai — серверный список документов и три отдельные glass-card. | Ничего из work_ai. В web_rA: вынести inline `<style>` и `<script>` в static. | Не использовать старую схему «три карточки + серверный список» из work_ai — в web_rA уже более продвинутая схема. |
| **login.html** | Оба варианта по сути одинаковы: standalone-страница, один и тот же inline `<style>` (aurora, glass-card, input-field, btn-primary, noise). | Оставить версию web_rA (или любую одну). Вынести inline `<style>` в `static/css/login.css` и подключать в login.html. | Второй экземпляр login (из work_ai) как дубль не копировать. |
| **orchestrator.html** | В **web_rA**: загрузка инструментов по API (loadTools), поиск, фильтры по категориям, состояния загрузки/ошибки, переключатель инструмента (toggleTool), русские подписи. В work_ai — серверный рендер и кнопка «Refresh». | Ничего из work_ai. В web_rA: вынести малое inline `<style>` и весь `<script>` в static. | Отказаться от серверного рендера списка инструментов из work_ai — в web_rA уже API-подход. |
| **settings.html** | В **web_rA**: загрузка через API (loadSettings + /api/models/), валидация полей, раздельные чат/агент/RAG модели, состояние загрузки. В work_ai — серверные переменные и простые save/clear. | Ничего из work_ai. В web_rA: вынести большой IIFE-скрипт в `static/js/settings.js`. | Дубли: не воспроизводить старую схему «всё с сервера» из work_ai. |
| **agents.html (agent_hub)** | В **work_ai** есть кнопка «Импорт» (openImportModal) и #importModal в стилях; в **web_rA** — кнопка «Конструктор» вместо «Импорт», модалок импорта нет. Функционально web_rA ближе к текущему продукту (Task Builder, workflow, профили, логи). | При необходимости: из work_ai в web_rA перенести только сценарий «Импорт» (кнопка + модалка + обработчик), если он нужен в продукте. Стили .agent-log-line из work_ai при необходимости вынести в `static/css/agents.css`. | В web_rA не дублировать неиспользуемые модалки/скрипты из work_ai. Огромный inline JS в agents.html — вынести в static, чтобы не дублировать логику при правках. |

---

## 3. Сводка: что именно переносим и что удаляем

- **Базовый слой (base + style.css):** за основу берётся web_rA; из work_ai в web_rA ничего не переносим. Удалять «как дубли» нечего — работаем только в репозитории web_rA.
- **Чаты, Knowledge Base, Orchestrator, Settings:** везде оставляем реализацию web_rA; из work_ai не переносим. «Удаляем как дубли» — старые схемы (серверный рендер списков, один model-select, отсутствие API/валидации) просто не используем.
- **Login:** считаем дублем вторую копию (work_ai vs web_rA); в использовании — одна версия (в web_rA), стили выносим в static.
- **Agents (agent_hub):** переносим из work_ai только функционал «Импорт» (если решим, что он нужен). Остальное — улучшаем только в web_rA, дубли не копируем.

---

## 4. Inline CSS/JS в шаблонах и вынос в static

Ниже перечислены файлы, в которых есть inline CSS или JS, и какие блоки целесообразно вынести в статику.

### 4.1 base.html (web_rA)

| Тип | Где находится | Рекомендация |
|-----|----------------|--------------|
| **Inline CSS** | Блок `<style>` после `{% static 'css/style.css' %}`: data-theme (light), data-layout (compact/spacious), will-change, transition для a/button/input/select/textarea | Вынести в `core_ui/static/css/base.css` (или в конец `style.css`) и подключать один раз в base.html |
| **Inline JS** | Один большой `<script>` до `{% block scripts %}`: UISettings (load/save/apply/getDefaults/getCurrent), changeTheme/changeDensity/changeSize, toggleAnimations, toggleUISettings, resetUISettings, showToast, checkHealth, логика сворачивания сайдбара (localStorage), мобильное меню и overlay, DOMContentLoaded, закрытие панели по клику вне | Вынести в `core_ui/static/js/base.js` (или `ui-settings.js`). В шаблоне оставить только подключение: `<script src="{% static 'js/base.js' %}"></script>`. Конфиг (напр. URL настроек, health) при необходимости передавать через data-атрибуты или глобальную переменную. |

### 4.2 chat.html (web_rA)

| Тип | Где находится | Рекомендация |
|-----|----------------|--------------|
| **Inline CSS** | Блок `<style>` внутри `{% block content %}`: .corporate-chat-container, .corporate-chat-messages, .corporate-action-btn, .corporate-message-user/ai, .corporate-input-container, .corporate-select, .corporate-icon-btn, .corporate-send-btn, .corporate-clear-btn, переопределения .prose (pre/code/p/ul/ol/li/h1–h4/strong/a), .code-block / .copy-btn, #attached-files, .typing-indicator, @media, scrollbar для .corporate-chat-messages | Вынести в `core_ui/static/css/chat.css`. В шаблоне: ссылка на chat.css внутри блока или в base при необходимости. |
| **Inline JS** | Блок `{% block scripts %}`: работа с chat-container, input, sendBtn, providerSelect, modelSelect, useRagCheckbox, MODEL_OPTIONS, updateModelOptions, marked, обработчики клавиш, sendMessage, appendMessage, appendThinking, attachCopyButtons, getCookie, загрузка файлов (handleFiles, uploadFile, removeFile), formatFileSize, showToast-вызовы, getTaskIdFromUrl, showTaskContext, loadTaskContextIfPresent, runSettingsCheck, проверка initial_prompt | Вынести в `core_ui/static/js/chat.js`. В шаблоне оставить только `<script src="{% static 'js/chat.js' %}"></script>` и при необходимости передать `initial_prompt` через data-атрибут или window.__CHAT_INITIAL_PROMPT`. |

### 4.3 knowledge_base.html (web_rA)

| Тип | Где находится | Рекомендация |
|-----|----------------|--------------|
| **Inline CSS** | Блок `<style>`: .kb-page, .kb-container, .kb-status-bar, .kb-status-pill/icon/ok/err/muted, .kb-search-section/box/input/btn, .kb-results*, .kb-docs-section/head/actions/title/list, .kb-link-danger, .kb-btn-add, .kb-doc-row/meta/source/id/text, .kb-state*, .kb-modal* (backdrop, panel, head, body, foot, close, field-label, input/textarea, btn-primary/secondary), .hidden | Вынести в `core_ui/static/css/knowledge_base.css` и подключать на странице KB. |
| **Inline JS** | Блок `<script>`: openAddModal, closeAddModal, getCookie, escapeHtml, addDocument, removeDocCards, searchKnowledge, resetDatabase, loadDocuments, обработчик Enter в search-query, DOMContentLoaded → loadDocuments | Вынести в `core_ui/static/js/knowledge_base.js`. Подключить в шаблоне и при необходимости передать опции (например, URL API) через data-атрибуты. |

### 4.4 login.html (оба проекта)

| Тип | Где находится | Рекомендация |
|-----|----------------|--------------|
| **Inline CSS** | Целый блок `<style>` в `<head>`: body, .aurora-bg, .aurora-blob*, @keyframes float1/2/3, .glass-card, .input-field, .btn-primary, .glow-icon, .animate-fade-in-up, .noise-overlay::before | Вынести в `core_ui/static/css/login.css`. В login.html оставить только `<link rel="stylesheet" href="{% static 'css/login.css' %}">`. Логику в login нет — отдельный файл не требуется. |

### 4.5 orchestrator.html (web_rA)

| Тип | Где находится | Рекомендация |
|-----|----------------|--------------|
| **Inline CSS** | В конце контента блок `<style>`: .filter-btn.active, .tool-toggle:hover | Перенести в `core_ui/static/css/orchestrator.css` или в общий `style.css` (секция «Orchestrator»). |
| **Inline JS** | Блок `<script>`: allTools, currentCategory, currentSearch, loadTools, updateStats, renderTools, getCategoryIcon, filterByCategory, filterTools, toggleTool, refreshTools, escapeHtml, DOMContentLoaded и поиск по полю | Вынести в `core_ui/static/js/orchestrator.js`. В шаблоне — только подключение скрипта. |

### 4.6 settings.html (web_rA)

| Тип | Где находится | Рекомендация |
|-----|----------------|--------------|
| **Inline CSS** | Нет отдельного блока; используются общие классы и единичные style="..." в заголовке | Не трогать или заменить инлайн-стили на классы из style.css. |
| **Inline JS** | Один большой IIFE в `<script>`: getCookie, setFieldError, validateRequired, validateField, apiKeyIds, requiredFieldIds, validateAllRequired, setupBlurValidation, setupClearOnInput, setupValidation, fillSelect, loadSettings (fetch /api/settings/ и /api/models/), saveSettings, clearHistory, DOMContentLoaded, обработчики кнопок | Вынести в `core_ui/static/js/settings.js`. В шаблоне — только подключение и при необходимости data-атрибуты для ID полей/контейнеров. |

### 4.7 agents.html (agent_hub, web_rA)

| Тип | Где находится | Рекомендация |
|-----|----------------|--------------|
| **Inline CSS** | Блок `<style>` в начале контента: overflow для body/main, @keyframes pulse-glow, .running-indicator, @keyframes spin, .spinner, .custom-scrollbar, .task-card (.dragging, .drag-over), #tb-tasks-container, z-index для модалок (#workflowModal, #taskBuilderModal, #workflowLogsModal, #agentLogsModal, #workflowScriptModal, #profileModal, #assistModal) | Вынести в `agent_hub/static/css/agents.css` (если заведёте static у приложения agent_hub) или в `core_ui/static/css/agents.css` и подключать только на странице Agents. |
| **Inline JS** | Огромный блок `<script>`: данные presetData/workflowsData/projectsData, setupProjectSelectors, toggleModelFields, open/close модалок (Profile, Assist, Workflow, TaskBuilder, WorkflowLogs, AgentLogs, WorkflowScript), fetchWorkflowLogs, fetchAgentLogs, saveProfile, runProfile, editProfile, generateConfig, generateWorkflow, runWorkflow, openWorkflowScript, stopWorkflow, deleteWorkflowRun, stopAgentRun, deleteAgentRun, deleteWorkflow, restartWorkflow, autoCreateProfile, getQuickProjectPayload, autoGenerateWorkflow, autoCreateAll, usePreset, getCookie, startStatusUpdates, updateAllStatuses, scrollToActiveRuns, showLoadingOverlay, hideLoadingOverlay, вся логика Task Builder (open/close, addNewTask, deleteTask, drag/drop, aiGenerateTasks, saveTaskBuilderWorkflow), и др. | Разбить на модули и вынести в `agent_hub/static/js/agents.js` (или аналогичный путь). Данные presets/workflows/projects можно оставить в шаблоне в виде `json_script` и подхватывать в agents.js. В шаблоне оставить только подключение скрипта и при необходимости мелкие data-атрибуты. |

---

## 5. Порядок выполнения (рекомендуемый)

1. **Static для core_ui**
   - Создать при необходимости `core_ui/static/js/` и доработать `core_ui/static/css/`.
   - Добавить: base.css, base.js; chat.css, chat.js; knowledge_base.css, knowledge_base.js; login.css; orchestrator.css, orchestrator.js; settings.js.
   - В шаблонах заменить соответствующие блоки `<style>`/`<script>` на подключение этих файлов.

2. **Проверка**
   - Убедиться, что все страницы (base, chat, knowledge_base, login, orchestrator, settings) открываются и работают так же, как до выноса.

3. **Agents (agent_hub)**
   - Решить, нужен ли сценарий «Импорт» из work_ai; при необходимости перенести только его.
   - Вынести стили agents в `agents.css` и скрипт в `agents.js`, подключить их в agents.html.

4. **Финальная проверка**
   - Пройти по всем страницам и сценариям (чат, загрузка файлов, настройки, оркестратор, база знаний, агенты). Убедиться, что дубли логики (getCookie, showToast и т.п.) не остались в нескольких inline-скриптах, а по возможности сосредоточены в base.js или общем модуле.

---

## 6. Краткий чеклист по файлам

| Файл | Inline CSS → static | Inline JS → static |
|------|---------------------|---------------------|
| base.html | → base.css / style.css | → base.js |
| chat.html | → chat.css | → chat.js |
| knowledge_base.html | → knowledge_base.css | → knowledge_base.js |
| login.html | → login.css | — |
| orchestrator.html | → orchestrator.css или style.css | → orchestrator.js |
| settings.html | — (или классы) | → settings.js |
| agent_hub/agents.html | → agents.css | → agents.js |

После выполнения плана все перечисленные блоки должны быть вынесены в указанные static-файлы, а в шаблонах — только ссылки на них и минимальная разметка/данные (json_script, data-атрибуты и т.п.).
