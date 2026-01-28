# Аргументы Cursor Agent CLI и где их использовать

Справка по `agent --help` и места вызова в проекте: чат, Agent Hub (run/task), workflow steps.

## Сводка аргументов `agent`

| Аргумент | Описание | Где уже используется | Куда добавить |
|----------|----------|----------------------|---------------|
| `prompt` | Начальный промпт | Везде (чат, run, workflow) | — |
| `--api-key` | API-ключ | Через `CURSOR_API_KEY` в env | — |
| `-H, --header` | Кастомный заголовок (`Name: Value`) | — | Опционально: настройки/профиль, передавать в чат и CLI run |
| `-p, --print` | Вывод в консоль, headless | Чат, Agent Hub, workflow | — |
| `--output-format` | `text` \| `json` \| `stream-json` | Чат: text (ask), stream-json (agent); Hub: stream-json | — |
| `--stream-partial-output` | Стримить части вывода (с stream-json) | Чат (agent), Hub | — |
| `-c, --cloud` | Режим облака, composer picker | — | Не нужен для headless |
| `--mode` | `plan` \| `ask` | Чат: ask / agent (без mode) | Режим **plan** можно добавить в чат (только планирование) |
| `--plan` | То же что `--mode=plan` | — | Как альтернатива mode=plan в чате |
| `--resume [chatId]` | Продолжить сессию | — | **Чат**: если храним/получаем Cursor chatId — передавать при «продолжить» |
| `--continue` | Продолжить последний чат | — | **Чат**: опция «продолжить последний Cursor-чат» |
| `--model` | Модель (gpt-5, sonnet-4, …) | Везде только `auto` | Выбор модели запрещён — всегда передаём `auto` |
| `--list-models` | Список моделей и выход | — | Отдельная команда/страница настроек, не в вызов агента |
| `-f, --force` | Разрешить команды без подтверждения | Agent Hub, чат (agent) | — |
| `--sandbox` | `enabled` \| `disabled` | — | **Профиль/настройки**: для run и workflow; **чат** опционально |
| `--approve-mcps` | Авто-одобрение MCP (с -p) | — | **Docker/headless**: при вызове чата и workflow; настройка в конфиге |
| `--browser` | Включить автоматизацию браузера | — | **Профиль/workflow**: для тасков с E2E/Playwright |
| `--workspace` | Рабочая директория | Чат, Hub, workflow | — |

---

## Места вызова Cursor CLI в проекте

### 1. Чат (Cursor Auto) — `core_ui/views.py`

- **Функция:** `_stream_cursor_cli(message, workspace, mode="ask")`
- **Режимы:** `ask` → `--mode=ask -p --output-format text`; `agent` → `-p --force --output-format stream-json --stream-partial-output`.
- **Идеи:**
  - **Модель всегда `auto`** — выбор модели запрещён.
  - Добавить режим **plan** (`--mode=plan` или `--plan`) для «только план, без правок».
  - Опционально **`--resume <chatId>`** / **`--continue`**, если в сессии сохраняем/получаем Cursor chat ID.
  - Для headless/Docker: **`--approve-mcps`** (из настройки или `CURSOR_CLI_EXTRA_ENV`).
  - **`--sandbox`** из настроек (enabled/disabled).

### 2. Agent Hub — запуск агента (run/task) — `app/agents/cli_runtime.py` + `agent_hub/views.py`

- **Конфиг:** `CLI_RUNTIME_CONFIG["cursor"]` в `web_ui/settings.py`: `args` + `allowed_args`.
- **Сейчас:** модель всегда `auto`; `allowed_args`: **`sandbox`**, **`approve-mcps`**, **`browser`** (без `model`).
- **Идеи:**
  - В профиле/запросе передавать sandbox, approve-mcps, browser в `config` — они пойдут в CLI.
  - **`-H`** (header): если нужны кастомные заголовки — либо список в настройках, либо отдельный allowed_arg с форматом `"Name: Value"` (можно несколько через разделитель).

### 3. Workflow (шаги) — `agent_hub/views.py`

- **Функции:** `_run_steps_with_backend`, `_build_cli_command(runtime, prompt, config, workspace)`.
- Используется тот же `CLI_RUNTIME_CONFIG["cursor"]` и `allowed_args`; в `config` шага можно передать доп. параметры из `workflow.script` или настроек.
- **Идеи:**
  - В **script** workflow хранить опции: `model`, `sandbox`, `approve_mcps`, `browser` и передавать в `config` при вызове `_build_cli_command`.
  - Для шагов с браузерной автоматизацией включать **`--browser`** в конфиге шага/воркфлоу.

### 4. Резюме по файлам

| Файл | Что менять |
|------|------------|
| `web_ui/settings.py` | Расширить `CLI_RUNTIME_CONFIG["cursor"]["allowed_args"]`: `model`, `sandbox`, `approve-mcps`, `browser`. |
| `core_ui/views.py` | В `_stream_cursor_cli`: опционально модель, `--sandbox`, `--approve-mcps`; позже — `--resume`/`--continue`, режим plan. |
| `app/agents/cli_runtime.py` | Уже подхватывает `allowed_args` из конфига — достаточно расширить список в settings. |
| `agent_hub/views.py` | `_build_cli_command` уже собирает args из `allowed_args` и `config` — при добавлении в settings начнёт передавать новые флаги. |
| `app/core/model_config.py` | Опционально: поля `cursor_sandbox`, `cursor_approve_mcps` для чата (модель всегда auto). |

---

## Команды `agent`, не являющиеся вызовом агента

- `agent login`, `agent logout`, `agent mcp`, `agent status`, `agent models`, `agent create-chat`, `agent generate-rule`, `agent update` и т.д.  
Имеет смысл использовать отдельно (например, `create-chat` для получения chatId для `--resume`), но не в том же процессе, что и запуск одного промпта.

Этот файл можно обновлять по мере появления новых флагов в `agent --help`.

---

## Реализовано (январь 2025)

- **Модель всегда `auto`** — выбор модели запрещён, везде передаётся только `--model auto`.
- **CLI_RUNTIME_CONFIG["cursor"]["allowed_args"]**: `sandbox`, `approve-mcps`, `browser` (без `model`).
- **Чат (_stream_cursor_cli)**: опционально `sandbox`, `approve_mcps` из настроек; API настроек возвращает/принимает `cursor_sandbox`, `cursor_approve_mcps`.
- **ModelConfig**: `cursor_sandbox`, `cursor_approve_mcps` (без cursor_chat_model).
- **agent_hub**: для cursor из config вырезается `model` — переопределить модель нельзя.
- **cli_runtime**: для булевых флагов при `False` флаг не передаётся.
