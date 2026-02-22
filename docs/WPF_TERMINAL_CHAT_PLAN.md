# План: WPF-приложение «Терминал + AI-чат»

Документ содержит полный план переноса функциональности терминала сервера и AI-чата из веб-платформы WEU в отдельное нативное приложение на C# + WPF. Структура рассчитана на использование LLM-агента для реализации.

---

## Оглавление

1. [Обзор и цели](#1-обзор-и-цели)
2. [Архитектура исходной системы](#2-архитектура-исходной-системы)
3. [Архитектура WPF-приложения](#3-архитектура-wpf-приложения)
4. [Задачи по этапам](#4-задачи-по-этапам)
5. [Протокол WebSocket (полная спецификация)](#5-протокол-websocket-полная-спецификация)
6. [HTTP API для интеграции](#6-http-api-для-интеграции)
7. [Логика AI-чата в терминале](#7-логика-ai-чата-в-терминале)
8. [Модели данных](#8-модели-данных)
9. [Безопасность и проверки](#9-безопасность-и-проверки)
10. [Структура проекта C#](#10-структура-проекта-c)

---

## 1. Обзор и цели

### Что переносим

| Компонент | Описание | Источник |
|-----------|----------|----------|
| **Терминал SSH** | PTY-сессия к серверу через WebSocket | `servers/consumers.py` (SSHTerminalConsumer) |
| **AI-чат в терминале** | LLM планирует и выполняет команды в уже подключённом PTY | `servers/consumers.py` (_handle_ai_request, _ai_plan_commands) |
| **Основной чат** | HTTP streaming API для чата с инструментами | `core_ui/views.py` (chat_api) |

### Варианты интеграции

**Вариант A (рекомендуется):** WPF как клиент существующего бэкенда
- Подключение к WebSocket `ws://host/ws/servers/<id>/terminal/`
- Вызов HTTP API `/api/chat/` для основного чата
- Минимум дублирования, единая логика на сервере

**Вариант B:** Полностью автономное приложение
- Собственная реализация SSH (например, SSH.NET)
- Собственный вызов LLM API (Gemini/Grok) или прокси через бэкенд
- Больше кода, но работает без веб-сервера

Документ ориентирован на **Вариант A** — WPF как тонкий клиент.

---

## 2. Архитектура исходной системы

### 2.1 Поток данных: Терминал + AI

```
┌─────────────────────────────────────────────────────────────────────────┐
│ WPF Client                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────────────┐ │
│  │ xterm/PTY    │  │ AI Panel     │  │ Server List (HTTP API)          │ │
│  │ (или аналог) │  │ (чат)        │  │                                 │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬──────────────────┘ │
│         │                │                          │                    │
│         └────────────────┼──────────────────────────┘                    │
│                          │                                               │
│                    WebSocket Client                                       │
│                    ws://host/ws/servers/<id>/terminal/                    │
└──────────────────────────┼──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Django Backend (Daphne ASGI)                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ SSHTerminalConsumer                                                  ││
│  │  - connect → SSH (asyncssh)                                           ││
│  │  - input → stdin.write                                                ││
│  │  - output ← stdout/stderr                                             ││
│  │  - ai_request → LLM → plan → execute in PTY                          ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Ключевые файлы веб-платформы

| Файл | Назначение |
|------|------------|
| `servers/consumers.py` | SSHTerminalConsumer — WebSocket, SSH, AI-логика |
| `servers/routing.py` | Маршрут: `ws/servers/<int:server_id>/terminal/` |
| `core_ui/views.py` | chat_api — HTTP streaming для основного чата |
| `app/core/llm.py` | LLMProvider — вызов Gemini/Grok |
| `app/tools/safety.py` | is_dangerous_command — проверка опасных команд |
| `passwords/encryption.py` | Расшифровка паролей серверов |

---

## 3. Архитектура WPF-приложения

### 3.1 Компоненты

```
┌─────────────────────────────────────────────────────────────────────────┐
│ WPF Application                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Views (XAML)                                                            │
│  ├── MainWindow        — список серверов, выбор сервера                 │
│  ├── TerminalWindow    — терминал + AI-панель                            │
│  └── ChatWindow        — (опционально) основной чат                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Services                                                               │
│  ├── WebSocketTerminalService  — подключение к ws, отправка/приём JSON   │
│  ├── TerminalRendererService   — отрисовка вывода (контрол или Canvas)   │
│  ├── ChatApiService            — HTTP POST /api/chat/ (streaming)       │
│  └── ServersApiService         — GET списка серверов, аутентификация    │
├─────────────────────────────────────────────────────────────────────────┤
│  Models                                                                 │
│  ├── Server, ServerGroup                                                │
│  ├── WsMessage (типы из протокола)                                      │
│  └── ChatMessage                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Зависимости NuGet

- `System.Net.WebSockets.Client` — WebSocket
- `Newtonsoft.Json` или `System.Text.Json` — JSON
- `CommunityToolkit.Mvvm` (опционально) — MVVM
- Для PTY-эмуляции: либо встроенный RichTextBox/TextBox с ANSI, либо библиотека типа `Terminal.Gui` / `ConEmu` интеграция, либо простой TextBlock с поддержкой ANSI escape sequences

---

## 4. Задачи по этапам

### Этап 1: Инфраструктура и настройки

| # | Задача | Описание | Критерий готовности |
|---|--------|----------|---------------------|
| 1.1 | Создать WPF-проект | .NET 8, WPF, структура папок (Views, Services, Models) | Проект собирается |
| 1.2 | Настройки приложения | Конфиг: BaseUrl (https://weu.example.com), логин/пароль или токен | Сохранение в user settings |
| 1.3 | Аутентификация | Логин по API (если есть) или cookie-based после веб-логина | Успешный запрос к защищённому API |

### Этап 2: Список серверов

| # | Задача | Описание | Критерий готовности |
|---|--------|----------|---------------------|
| 2.1 | API серверов | GET `/servers/api/` или аналог — список серверов пользователя | Модель Server, список в UI |
| 2.2 | UI списка | ListView/DataGrid с колонками: Name, Host, Port, Status | Выбор сервера → переход к терминалу |

### Этап 3: WebSocket-терминал

| # | Задача | Описание | Критерий готовности |
|---|--------|----------|---------------------|
| 3.1 | WebSocket-клиент | Подключение к `ws://host/ws/servers/<id>/terminal/` с cookie/auth | Установлено соединение |
| 3.2 | Отправка connect | JSON `{type:"connect", master_password?, password?, cols, rows, term_type}` | Получен `ready` |
| 3.3 | Обработка output | Парсинг `{type:"output", stream, data}` → вывод в терминал | Текст отображается |
| 3.4 | Отправка input | `{type:"input", data:"<keystrokes>"}` при вводе пользователя | Символы уходят на сервер |
| 3.5 | Resize | `{type:"resize", cols, rows}` при изменении размера окна | PTY перестраивается |
| 3.6 | Disconnect | `{type:"disconnect"}` при закрытии | SSH-сессия завершается |

### Этап 4: AI-панель в терминале

| # | Задача | Описание | Критерий готовности |
|---|--------|----------|---------------------|
| 4.1 | UI AI-панели | Текстовое поле + кнопка «Отправить», область сообщений | Ввод и отображение |
| 4.2 | ai_request | Отправка `{type:"ai_request", message:"<text>"}` | Запрос уходит в WebSocket |
| 4.3 | ai_status | Обработка thinking/running/waiting_confirm/idle | Индикатор состояния |
| 4.4 | ai_response | Отображение assistant_text и списка commands | Текст и карточки команд |
| 4.5 | ai_confirm / ai_cancel | Кнопки для опасных команд | Подтверждение/отмена |
| 4.6 | ai_command_status | Обновление статуса команды (running/done/skipped) | Визуальная обратная связь |
| 4.7 | ai_report | Итоговый отчёт после выполнения | Отображение отчёта |
| 4.8 | ai_error, ai_question, ai_recovery | Обработка ошибок и вопросов | Корректное отображение |

### Этап 5: Основной чат (опционально)

| # | Задача | Описание | Критерий готовности |
|---|--------|----------|---------------------|
| 5.1 | HTTP streaming | POST `/api/chat/` с JSON `{message, model, chat_id}` | Streaming ответа |
| 5.2 | Парсинг CHAT_ID | Первая строка: `CHAT_ID:123` | Сохранение chat_id |
| 5.3 | Отображение | Потоковый вывод в TextBlock/RichTextBox | Текст появляется по мере прихода |

### Этап 6: Полировка

| # | Задача | Описание | Критерий готовности |
|---|--------|----------|---------------------|
| 6.1 | ANSI в терминале | Поддержка цветов и escape-последовательностей | Цветной вывод |
| 6.2 | Master password | Диалог ввода мастер-пароля при connect | Расшифровка на сервере |
| 6.3 | Обработка ошибок | Таймауты, переподключение, сообщения пользователю | Устойчивость к сбоям |

---

## 5. Протокол WebSocket (полная спецификация)

### 5.1 URL

```
ws://<host>/ws/servers/<server_id>/terminal/
wss://<host>/ws/servers/<server_id>/terminal/  (HTTPS)
```

Требуется аутентификация (cookie сессии Django или токен в заголовке, если поддерживается).

### 5.2 Сообщения Client → Server

| type | Поля | Описание |
|------|------|----------|
| `connect` | `master_password?`, `password?`, `cols`, `rows`, `term_type?` | Подключение SSH. cols/rows — размер PTY. |
| `input` | `data` | Строка с нажатыми клавишами (UTF-8) |
| `resize` | `cols`, `rows` | Изменение размера PTY |
| `disconnect` | — | Отключение SSH |
| `ai_request` | `message` | Текст запроса к AI |
| `ai_confirm` | `id` | Подтвердить опасную команду (int) |
| `ai_cancel` | `id` | Отменить команду (int) |
| `ai_reply` | `q_id`, `text` | Ответ на ai_question |
| `ai_stop` | — | Остановить AI |
| `ping` | — | Keepalive |

### 5.3 Сообщения Server → Client

| type | Поля | Описание |
|------|------|----------|
| `ready` | `server_id`, `server_name`, `auth_method`, `has_encrypted_secret` | Терминал готов к connect |
| `status` | `status`: connecting\|connected\|disconnected | Статус SSH |
| `output` | `stream`: stdout\|stderr, `data` | Вывод терминала |
| `error` | `message` | Ошибка |
| `exit` | `exit_status`, `exit_signal` | Сессия завершена |
| `ai_status` | `status`: thinking\|running\|waiting_confirm\|idle\|generating_report\|analyzing_error | Состояние AI |
| `ai_response` | `mode`, `assistant_text`, `commands` | План/ответ. commands: `[{id, cmd, why, requires_confirm, reason}]` |
| `ai_command_status` | `id`, `status`: running\|done\|skipped, `exit_code?`, `reason?` | Статус команды |
| `ai_report` | `report`, `status`: ok\|warning\|error | Итоговый отчёт |
| `ai_error` | `message` | Ошибка AI |
| `ai_recovery` | `original_cmd`, `new_cmd`, `new_id`, `why` | Retry после ошибки |
| `ai_question` | `q_id`, `question`, `cmd`, `exit_code` | Вопрос пользователю |
| `ai_install_progress` | `cmd`, `elapsed`, `output_tail` | Прогресс установки |
| `pong` | — | Ответ на ping |

### 5.4 Примеры JSON

**Connect:**
```json
{
  "type": "connect",
  "master_password": "secret",
  "password": "",
  "cols": 120,
  "rows": 30,
  "term_type": "xterm-256color"
}
```

**AI Request:**
```json
{
  "type": "ai_request",
  "message": "Проверь место на диске и запущенные контейнеры Docker"
}
```

**AI Response (execute):**
```json
{
  "type": "ai_response",
  "mode": "execute",
  "assistant_text": "Проверяю диск и контейнеры...",
  "commands": [
    {"id": 1, "cmd": "df -h", "why": "Проверка места", "requires_confirm": false, "reason": ""},
    {"id": 2, "cmd": "docker ps -a", "why": "Список контейнеров", "requires_confirm": false, "reason": ""}
  ]
}
```

---

## 6. HTTP API для интеграции

### 6.1 Основной чат

**POST** `/api/chat/`

**Headers:** `Content-Type: application/json`, Cookie сессии

**Body:**
```json
{
  "message": "Текст сообщения",
  "model": "auto",
  "chat_id": null,
  "use_rag": true
}
```

**Response:** `text/plain`, streaming. Первая строка может быть `CHAT_ID:123\n`. Далее — текст ответа по мере генерации.

### 6.2 Список серверов

**GET** `/skills/api/servers/` (требует feature `agents` и `servers`)

**Response:**
```json
{
  "success": true,
  "servers": [
    {"id": 1, "name": "prod-1", "host": "192.168.1.10", "group": "Production", "tags": ""}
  ]
}
```

**Альтернатива:** Добавить `GET /servers/api/list/` с полями `id, name, host, port, username, auth_method, has_encrypted_secret` — если нужен отдельный API без зависимости от skills/agents.

### 6.3 Master password

- `POST /servers/api/master-password/set/` — `{"master_password": "..."}` для сохранения в сессии (при необходимости для auto-connect)

---

## 7. Логика AI-чата в терминале

Вся логика выполняется на бэкенде. WPF только отправляет и отображает. Ниже — описание для понимания и отладки.

### 7.1 Режимы ответа LLM

| mode | Описание | Действия в WPF |
|------|----------|----------------|
| `answer` | Только текст, без команд | Показать assistant_text |
| `ask` | Уточняющий вопрос | Показать assistant_text |
| `execute` | Выполнить команды | Показать commands, ждать confirm для опасных |

### 7.2 Опасные команды

Команды с `requires_confirm: true` и `reason: "dangerous"` или `"forbidden"` требуют явного `ai_confirm` или `ai_cancel`.

Паттерны опасных команд (на бэкенде): `rm -rf`, `mkfs`, `dd if=`, `shutdown`, `reboot`, `systemctl stop/disable/mask`, `truncate -s 0` и т.д.

### 7.3 Запрещённые команды

Берутся из `GlobalServerRules` и `ServerGroup.forbidden_commands`. Если команда совпадает — `requires_confirm: true`, `reason: "forbidden"`.

### 7.4 Streaming-команды

Команды типа `tail -f`, `journalctl -f`, `docker logs -f` автоматически прерываются через ~8 сек (Ctrl+C на бэкенде). WPF может показывать `ai_install_progress` для длительных установок.

### 7.5 Адаптивное восстановление

При `exit_code != 0` бэкенд вызывает LLM для решения: retry (новая команда), skip, ask (вопрос пользователю), abort. WPF получает `ai_recovery` или `ai_question`.

---

## 8. Модели данных

### 8.1 Server (клиентская модель)

```csharp
public class Server
{
    public int Id { get; set; }
    public string Name { get; set; }
    public string Host { get; set; }
    public int Port { get; set; }
    public string Username { get; set; }
    public string AuthMethod { get; set; }  // "password", "key", "key_password"
    public bool HasEncryptedSecret { get; set; }
}
```

### 8.2 WsMessage (базовый)

```csharp
public class WsMessage
{
    [JsonProperty("type")]
    public string Type { get; set; }
    // Остальные поля — динамически или отдельные DTO под каждый type
}
```

### 8.3 Готовые DTO для ai_response

```csharp
public class AiResponseMessage
{
    public string Type => "ai_response";
    public string Mode { get; set; }
    public string AssistantText { get; set; }
    public List<AiCommand> Commands { get; set; }
}

public class AiCommand
{
    public int Id { get; set; }
    public string Cmd { get; set; }
    public string Why { get; set; }
    public bool RequiresConfirm { get; set; }
    public string Reason { get; set; }
}
```

---

## 9. Безопасность и проверки

### 9.1 На стороне WPF

- Не хранить мастер-пароль в открытом виде (только в памяти на время сессии).
- Использовать HTTPS/WSS в production.
- Валидировать URL перед подключением.

### 9.2 На стороне бэкенда (уже реализовано)

- `is_dangerous_command()` — блокировка опасных паттернов.
- Forbidden patterns из правил пользователя.
- Подтверждение для опасных команд.

---

## 10. Структура проекта C#

```
WeuTerminalWpf/
├── WeuTerminalWpf.csproj
├── App.xaml
├── App.xaml.cs
├── Models/
│   ├── Server.cs
│   ├── WsMessage.cs
│   ├── AiResponseMessage.cs
│   └── ...
├── Services/
│   ├── IWebSocketTerminalService.cs
│   ├── WebSocketTerminalService.cs
│   ├── IChatApiService.cs
│   ├── ChatApiService.cs
│   ├── IServersApiService.cs
│   └── ServersApiService.cs
├── ViewModels/
│   ├── MainViewModel.cs
│   ├── TerminalViewModel.cs
│   └── ...
├── Views/
│   ├── MainWindow.xaml
│   ├── TerminalWindow.xaml
│   └── ...
└── Helpers/
    ├── AnsiParser.cs       // опционально: разбор ANSI escape
    └── ConfigHelper.cs
```

---

## Приложение A: Ссылки на исходный код

| Логика | Файл:строка |
|--------|--------------|
| WebSocket protocol | `servers/consumers.py` 85-110 |
| _handle_ai_request | `servers/consumers.py` 489 |
| _ai_plan_commands | `servers/consumers.py` 1175 |
| _ai_process_queue | `servers/consumers.py` 571 |
| _ai_execute_command | `servers/consumers.py` 825 |
| _ai_handle_error | `servers/consumers.py` 1100 |
| is_dangerous_command | `app/tools/safety.py` 22 |
| chat_api | `core_ui/views.py` 855 |

---

## Приложение B: Чек-лист для LLM-агента

При реализации WPF-приложения проверь:

- [ ] WebSocket подключается с корректным URL и auth
- [ ] Все типы сообщений из протокола обрабатываются (хотя бы логированием)
- [ ] ai_confirm/ai_cancel отправляются с правильным id
- [ ] Терминал отображает output без потери данных при быстром потоке
- [ ] Resize вызывается при изменении размера окна
- [ ] Ошибки сети показываются пользователю
- [ ] Master password передаётся только при connect, не логируется
