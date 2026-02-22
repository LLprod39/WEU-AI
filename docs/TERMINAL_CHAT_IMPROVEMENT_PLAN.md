# План улучшения логики Terminal AI Chat

Документ описывает практичный план стабилизации AI-чата в SSH-терминале (`/ws/servers/<id>/terminal/`) на основе текущей реализации.

## Цели

1. Убрать критичные расхождения между фактическим состоянием выполнения и UI.
2. Исключить обход safety-проверок при recovery/retry.
3. Сделать одинаковый протокол и поведение для `terminal.html`, `terminal_minimal.html`, `multi_terminal.html`.
4. Повысить предсказуемость выполнения команд и качество контекста для LLM.
5. Закрыть тестами ключевые сценарии: stop/cancel/confirm/retry/question/report.

## Ключевые проблемы (по коду)

### P0 (критично)

1. `ai_stop` останавливает только AI-задачу, но не прерывает активную команду в PTY.
- `servers/consumers.py:222`
- `servers/consumers.py:365`
- `servers/consumers.py:825`

2. Recovery-команды (`retry`) добавляются в план без повторной safety-оценки (`requires_confirm`, `reason`, `streaming`).
- Базовый план учитывает safety: `servers/consumers.py:468`
- Retry вставляется без этого: `servers/consumers.py:651`
- Повторный retry после `ai_question` также без этого: `servers/consumers.py:695`

3. В `multi_terminal.html` не обрабатываются `ai_status`, `ai_recovery`, `ai_question`, `ai_install_progress`.
- `servers/templates/servers/multi_terminal.html:983`
- В результате часть бекенд-логики "невидима" для пользователя.

### P1 (важно)

4. В full/minimal UI AI-события обрабатываются только для `activeTabId`, из-за чего события фоновой вкладки теряются.
- `servers/templates/servers/terminal.html:1135`
- `servers/templates/servers/terminal_minimal.html:701`

5. `onclose/onerror` в full/minimal сбрасывают AI-индикаторы без проверки активной вкладки.
- `servers/templates/servers/terminal.html:1153`
- `servers/templates/servers/terminal_minimal.html:720`

6. Матч forbidden-команд сделан простым `substring`, что дает ложные срабатывания/пропуски.
- `servers/consumers.py:1266`

7. Контекст для LLM берётся из "сырого" terminal output без очистки ANSI/control-последовательностей.
- `servers/consumers.py:1407`
- `servers/consumers.py:1415`

8. Экспорт env-переменных в shell не экранирует значения (риск некорректного исполнения при спецсимволах).
- `servers/consumers.py:1464`

9. Тесты по терминальному AI-потоку сейчас только smoke.
- `tests/test_ssh_terminal_ws.py:1`

## План внедрения

### Фаза 0. Контракт и наблюдаемость (0.5-1 день)

1. Зафиксировать версию WS-протокола и обязательные события/поля в одном месте (`docs` + inline schema).
2. Добавить `run_id` (на `ai_request`) и включать его во все AI-события.
3. Добавить структурные логи состояния очереди: `run_id`, `cmd_id`, `phase`, `exit_code`, `recovery_action`.

Критерий готовности:
- Любое сообщение в UI можно сопоставить с конкретным запуском и командой.

### Фаза 1. Критичные исправления выполнения (1-2 дня)

1. Исправить `ai_stop`:
- если выполняется команда, отправлять `Ctrl+C` в PTY;
- переводить команду в `cancelled/interrupted`;
- гарантировать финальный `ai_status=idle` для run.

2. Вынести создание plan item в единый helper (например `_build_plan_item(cmd, why)`):
- использовать и для первичного плана, и для recovery/retry;
- всегда пересчитывать `requires_confirm/reason/streaming`.

3. Для `abort` и принудительной остановки унифицировать финализацию статусов (исключить "подвисшее running" состояние).

Критерий готовности:
- Нельзя выполнить retry-команду без safety-гейта.
- Stop реально останавливает активную команду на сервере.

### Фаза 2. Унификация фронтенда (1-2 дня)

1. Для `multi_terminal.html` добавить обработку всех AI-событий:
- `ai_status`, `ai_recovery`, `ai_question`, `ai_install_progress`.

2. Поддержать отправку `ai_reply` из multi-tab UI.

3. В full/minimal:
- хранить AI-state помимо `activeTabId` (по tab id);
- при `onclose/onerror` обновлять AI UI только для соответствующей вкладки.

4. Опционально: выделить общий JS-модуль AI-клиента, чтобы не дублировать логику между тремя шаблонами.

Критерий готовности:
- Поведение AI-панели консистентно во всех 3 UI-вариантах.

### Фаза 3. Надёжность исполнения и контекст LLM (1-2 дня)

1. Усилить механику маркеров exit-code:
- уникальный token на run/session;
- устойчивый парсинг CRLF/частичных чанков;
- защита от ложного срабатывания, если пользовательский вывод содержит похожую строку.

2. Нормализовать вывод перед передачей в LLM:
- strip ANSI/control sequences;
- ограничение по размеру после очистки;
- отдельный "чистый хвост" для промпта.

3. Сделать политику таймаутов на основе класса команды (stream/install/diag) и конфигурации.

Критерий готовности:
- Меньше ложных timeout/marker-fail и более релевантные AI-отчёты.

### Фаза 4. Safety и security hardening (1 день)

1. Forbidden rules:
- поддержка regex/шаблонов с явным режимом матчинга;
- fallback на literal match.

2. Расширить `is_dangerous_command` и покрыть тестами.
- `app/tools/safety.py:7`

3. Экранировать env exports через shell-safe quoting.

4. Опционально добавить настройку верификации host keys (не всегда `known_hosts=None`).
- `servers/consumers.py:276`

Критерий готовности:
- Снижен риск опасного/некорректного исполнения.

### Фаза 5. Тесты и rollout (1-2 дня)

1. Backend unit/integration:
- state machine очереди (`pending -> running -> done/skipped/cancelled`);
- stop/cancel/confirm;
- recovery retry с safety;
- ai_question/ai_reply timeout path;
- marker parser edge-cases.

2. Frontend e2e (Playwright):
- все `ai_*` события в каждом UI-шаблоне;
- переключение вкладок во время выполнения;
- корректный рендер статусов и отчёта.

3. Rollout:
- feature flag `terminal_ai_v2`;
- staged включение и сравнение метрик.

Критерий готовности:
- Регрессии ловятся тестами до релиза.

## Приоритет исполнения

1. Фаза 1 (P0)  
2. Фаза 2 (протокол/UI консистентность)  
3. Фаза 3 (надежность контекста и маркеров)  
4. Фаза 4 (safety/security)  
5. Фаза 5 (полное тестовое покрытие и rollout)

## Метрики успеха

1. Доля "зависших" запусков AI (нет terminal idle за N секунд) < 1%.
2. Доля ложных retry без confirm = 0.
3. Доля AI-run с полным набором WS-событий во всех UI = 100%.
4. Снижение AI timeout/marker failures минимум на 50%.
