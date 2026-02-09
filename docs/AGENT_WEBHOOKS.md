# Webhooks для авто-агентов

Коротко: можно создать webhook, который будет автоматически создавать задачу и запускать агента (или workflow) без участия человека. Это подходит для Zabbix/мониторинга, security-сканеров и любых внешних алертов.

**Что умеет:**
- принимает POST JSON
- создаёт Task с назначением на ИИ
- выбирает CustomAgent или стандартный тип агента
- опционально запускает выполнение сразу
- пишет лог вебхука (AgentWebhookEvent)

## API

### Создать webhook
`POST /agents/api/webhooks/`

Пример payload:
```json
{
  "name": "Zabbix Errors",
  "description": "Авто-разбор проблем от Zabbix",
  "source": "zabbix",
  "custom_agent_id": 12,
  "agent_type": "react",
  "auto_execute": true,
  "execution_mode": "task",
  "config": {
    "title_template": "Zabbix: {{trigger.name}} on {{host.name}}",
    "description_template": "{{trigger.description}}\n\nHost: {{host.name}}\nSeverity: {{severity}}\n\n{{payload_json}}",
    "server_field": "host.name",
    "event_id_field": "event.id",
    "workflow_template": "remediation",
    "runtime": "cursor",
    "verify_prompt": "Проверь, что алерт исчез и сервис стабилен",
    "skill_ids": [1, 2]
  }
}
```

Ответ:
```json
{ "success": true, "webhook_id": 3, "secret": "<TOKEN>" }
```

### Получить список
`GET /agents/api/webhooks/`

### Обновить webhook
`PUT /agents/api/webhooks/<id>/`

### Отключить webhook
`DELETE /agents/api/webhooks/<id>/`

### Вызов webhook (без авторизации)
`POST /agents/api/webhooks/receive/<secret>/`

Payload — любой JSON. Пример (упрощённо):
```json
{
  "event": {"id": "123"},
  "trigger": {"name": "CPU high", "description": "CPU > 90%"},
  "host": {"name": "prod-1"},
  "severity": "high"
}
```

## Шаблоны

Поддерживаются шаблоны вида `{{path.to.field}}`.

Поддерживаемые переменные:
- `{{payload_json}}` — полный JSON payload
- `{{webhook_name}}` — имя webhook
- `{{source}}` — источник (например zabbix)
- `{{received_at}}` — время получения
- `{{event_name}}` — если указано `event_name_field` в config

## Поиск сервера

Алгоритм:
- если `target_server_id` задан — используется он
- иначе ищется значение по `server_field` (например `host.name`)
- далее пытается матчить `Server.name` или `Server.host`
- можно задать `server_map` в config: `{ "prod-1": 5, "db-1": 9 }`

## Режимы выполнения

`execution_mode`:
- `task` — запускает TaskExecutor (SSH + внутренний ReAct/Ralph)
- `workflow` — создаёт workflow из задачи и запускает

`workflow_template` (для `execution_mode=workflow`):
- `remediation` — фиксированный сценарий: Triage → Remediate → Verify
- пусто/не задано — LLM генерирует шаги

`runtime` — override для workflow (cursor/claude/gemini/grok)

`verify_prompt` — переопределяет шаг Verify в remediation-шаблоне

`skill_ids` — список Skills, которые будут подставлены в workflow

## Рекомендации

- Для Zabbix используйте `server_field: "host.name"` или `host`.
- Для security-сканеров добавьте в `description_template` результат скана целиком.
- Если сервер не найден, выполнение пропускается и задача остаётся в PENDING.
- Если `auto_execute=false`, создаётся задача и ждёт подтверждения в Tasks.
