# Логика выполнения Workflow

## Общая схема

```
1. Pre-analysis (всегда Cursor)
   └── Cursor CLI в режиме --mode=plan анализирует задачу
   └── Проверяет: папка пустая? есть ли файлы? готовы ли шаги?
   └── Вывод: READY или уточняющие вопросы

2. Выполнение шагов (ваш выбранный CLI)
   └── CLI runtime из Settings (cursor / claude / codex)
   └── Каждый шаг: Cursor CLI, Claude CLI или Codex CLI
   └── Ralph mode: несколько итераций до completion promise
```

## Почему сначала Cursor?

**Pre-analysis** — отдельная фаза, которая всегда использует Cursor CLI. Она нужна для:

- Проверки содержимого workspace (пустая папка или уже есть файлы)
- Уточнения формулировки (например: «есть файлы — перезаписать или доработать?»)
- Флага `READY` — можно ли запускать основной агент

**Результат** — перед запуском Codex/Claude/другого CLI вы видите, что задача проанализирована.

## Выбор CLI для выполнения

**Settings → CLI Агент** — основной runtime для workflow:

- **Cursor** — Cursor CLI
- **Claude** — Claude Code CLI
- **Codex** — Codex CLI

Для каждого шага вызывается именно он.

## Ralph mode

Если в Settings включён **Ralph mode** (`ralph_internal` или `ralph_cli`):

- Агент может выполняться в несколько итераций (1–5)
- Итерации продолжаются, пока не найден `<promise>READY</promise>` или не достигнут лимит
- В логах: `[Step 1: ...] (Ralph 1/5)`, `(Ralph 2/5)` и т.д.

## Отключение Pre-analysis

Чтобы отключить фазу Cursor:

```
# В .env
ANALYZE_TASK_BEFORE_RUN=0
```

Тогда workflow сразу переходит к выполнению шагов без pre-analysis.
