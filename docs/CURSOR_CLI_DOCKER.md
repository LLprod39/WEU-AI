# Cursor CLI в Docker без входа по Google

Чтобы агенты на базе Cursor CLI работали в Docker **без интерактивного входа** (без логина через Google в браузере), используется **API-ключ** и переменная окружения `CURSOR_API_KEY`.

## Шаги

1. **Создай API-ключ в Cursor**
   - Открой [Cursor Settings → API Access](https://cursor.com/settings) или Dashboard → Background Agents.
   - Создай ключ и скопируй его.

2. **Добавь ключ в `.env`**
   ```env
   CURSOR_API_KEY=твой_скопированный_ключ
   ```

3. **Запусти стек**
   ```bash
   docker compose up --build
   ```

Контейнеры `web` и `agent-runner` получают `CURSOR_API_KEY` из окружения (через `env_file: .env` и явную переменную в `docker-compose`). При запуске Cursor CLI (агент из раздела Agents) подпроцесс наследует это окружение — **дополнительный вход по Google не нужен**.

## Cursor CLI уже в образе

При сборке образа (`docker compose build` или `docker compose up --build`) Cursor CLI ставится **автоматически** через официальный скрипт [cursor.com/install](https://cursor.com/install) ([документация](https://cursor.com/ru/docs/cli/headless)). Бинарник `agent` попадает в `/root/.local/bin`, PATH в контейнере уже настроен. Отдельный контейнер или ручная установка не нужны — достаточно `CURSOR_API_KEY` в `.env` и перезапуска стека.

## CURSOR_CLI_PATH — когда нужен вручную

Сообщение *«CLI для 'cursor' не найден (бинарник agent)»* бывает, если установка в образе не сработала (сеть при сборке, другая ОС и т.п.) или ты используешь свой образ без этого шага.

**Варианты:**

1. **Запуск на хосте (не в Docker)**  
   Установи Cursor CLI: `curl https://cursor.com/install -fsSL | bash` ([Windows](https://cursor.com/docs/cli/installation)). Добавь в PATH или задай в `.env`:
   ```env
   CURSOR_CLI_PATH=C:\путь\к\agent.exe   # Windows
   CURSOR_CLI_PATH=/usr/local/bin/agent  # Linux/macOS
   ```

2. **Docker — пересборка**  
   Обычно хватает пересборки образа: `docker compose build --no-cache web agent-runner` и затем `docker compose up -d`. В образ снова запустится установка Cursor CLI.

3. **Docker — свой бинарник**  
   Если скрипт в образе недоступен, смонтируй каталог с бинарником с хоста и в `.env` укажи путь **внутри контейнера**:
   ```env
   CURSOR_CLI_PATH=/cursor-cli/agent
   ```
   и в `docker-compose.yml` для сервисов `web` и `agent-runner` добавь volume, например:
   ```yaml
   volumes:
     - C:\путь\на\хосте\к\agent:/cursor-cli:ro   # Windows
   ```
   (слева — каталог на хосте с исполняемым файлом `agent`).

Бинарник `agent` — это Cursor CLI (Background Agents). Официальная установка: [cursor.com/install](https://cursor.com/install), [Headless CLI](https://cursor.com/ru/docs/cli/headless).

## Важно

- Ключ хранится только в `.env` на хосте; не коммить `.env` в git (он уже в `.gitignore`).
- Для продакшена используй секреты/менеджер паролей, а не голый `.env` в репо.
- В Docker при стандартной сборке бинарник `agent` уже в образе; для воркфлоу «Ralph mode: orchestrate via Cursor CLI» достаточно задать в `.env` только `CURSOR_API_KEY`. Если сборка идёт без доступа к cursor.com/install или ты используешь свой образ без установки CLI — задай `CURSOR_CLI_PATH` или смонтируй бинарник (см. раздел выше).

## Где используется

Переменная `CURSOR_API_KEY` передаётся в окружение процесса при вызове Cursor CLI из `app.agents.cli_runtime` (runtime `cursor`). Если ключ задан, Cursor CLI работает в headless-режиме без запроса входа.

## Вызов Cursor для вопросов (Ask) — только ответы

Чтобы Cursor **ничего не делал**, а только отвечал на вопросы (без изменений файлов и без агента), используется режим **Ask** и неинтерактивный запуск:

```bash
agent --mode=ask -p "ваш вопрос" --output-format text
```

- `--mode=ask` — Ask mode: поиск по коду и ответы, без правок файлов ([Using Agent in CLI](https://cursor.com/docs/cli/using)).
- `-p` / `--print` — неинтерактивный режим: вывод в консоль, без диалога в терминале.
- `--output-format text` — обычный текст ответа (удобно для скриптов и чата).

В чате при выборе **«Авто»** запросы отправляются через Cursor CLI. Режим (**Ask** или **Agent**) задаётся в **Настройки → Models → «Режим Cursor CLI в чате»**; по умолчанию Ask.

- **Ask:** `agent --mode=ask -p "сообщение" --output-format text --workspace <путь>`
- **Agent** (правка файлов): у CLI нет `--mode=agent` (допустимы только `plan` и `ask`), поэтому используется отдельный вызов:  
  `agent -p --force --output-format stream-json --stream-partial-output --workspace <путь> --model auto "сообщение"`
