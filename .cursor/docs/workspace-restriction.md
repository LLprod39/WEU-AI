# Ограничение доступа CLI-агентов к файлам

При запуске workflow (Cursor/Claude/Ralph) агент по умолчанию получает в `--workspace` полный каталог проекта. Чтобы **ограничить видимость файлов**, в `workflow.script` можно задать режим workspace.

## Параметры в `workflow.script`

| Параметр | Значение | Описание |
|----------|----------|----------|
| `workspace_mode` | `"full"` | Полный доступ к workspace (по умолчанию). |
| | `"empty"` | Пустая временная папка — агент **не видит** файлы проекта. |
| | `"whitelist"` | Временная папка с копией только путей из `allowed_paths`. |
| `restrict_files` | `true` | Эквивалент `workspace_mode: "empty"` (если нет `allowed_paths`). |
| `allowed_paths` | `["src/", "config.yaml"]` | Пути относительно base workspace (только для `whitelist`). |

## Примеры

### Агент вообще не видит файлы проекта

В JSON workflow в `script` добавьте:

```json
{
  "workspace_mode": "empty"
}
```

или:

```json
{
  "restrict_files": true
}
```

Агент получит пустую временную директорию; после завершения run она удаляется.

### Агент видит только указанные пути

В `script`:

```json
{
  "workspace_mode": "whitelist",
  "allowed_paths": ["src/", "README.md", "package.json"]
}
```

Создаётся временная папка, в неё копируются только `src/`, `README.md`, `package.json` из base workspace. Агент работает с этой копией; изменения в ней **не** переносятся обратно в проект (режим «только чтение/изоляция»).

## Где используется

- Логика: `agent_hub/views/utils.py` — `prepare_workspace_for_cli()`
- Вызов: `agent_hub/views_legacy.py` — `_execute_workflow_run()` перед передачей workspace в CLI
- Временные каталоги удаляются в `finally` после завершения run

## Серверные задачи

Для workflow с `target_server_id` (серверные задачи) ограничение по `workspace_mode` не применяется — используется изолированная папка под серверную задачу, как и раньше.
