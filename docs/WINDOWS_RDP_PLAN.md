# План: Поддержка Windows-серверов и RDP в браузере

## Цель

Добавить в модуль **Servers** возможность подключаться к Windows-серверам по протоколу RDP (Remote Desktop Protocol) напрямую из браузера, аналогично текущему SSH-терминалу для Linux.

---

## Текущая архитектура (SSH)

| Компонент | Реализация |
|-----------|------------|
| **Модель** | `Server` — host, port (22), username, auth_method (password/key/key_password) |
| **Подключение** | WebSocket → `SSHTerminalConsumer` → asyncssh |
| **Фронтенд** | xterm.js в `terminal.html` / `multi_terminal.html` |
| **Маршрутизация** | `servers/<id>/terminal/` → SSH-терминал |

---

## Варианты реализации RDP в браузере

### Вариант A: Apache Guacamole (рекомендуется)

**Суть:** Guacamole — clientless HTML5 gateway для RDP, VNC, SSH. Пользователь подключается через браузер без установки клиентов.

| Плюсы | Минусы |
|-------|--------|
| Готовый RDP-клиент в браузере | Требует отдельный сервис guacd (Java) |
| Поддержка RDP, VNC, SSH | Дополнительная инфраструктура |
| REST API для интеграции | Лицензия GPL (если встраивать код) |
| Работает на мобильных | |

**Архитектура Guacamole:**
```
Браузер (guacamole-common-js) 
    → HTTP/WebSocket tunnel 
    → guacd (Java daemon) 
    → RDP-сервер (Windows)
```

### Вариант B: noVNC + xrdp

**Суть:** noVNC — HTML5 VNC-клиент. Для Windows нужен VNC-сервер (TightVNC, UltraVNC) или xrdp на Linux.

| Плюсы | Минусы |
|-------|--------|
| Проще, чем Guacamole | Windows по умолчанию — RDP, не VNC |
| Только JavaScript | Нужно ставить VNC на Windows |
| | Менее нативная поддержка Windows |

### Вариант C: FreeRDP WebConnect (guacd-подобный)

**Суть:** Guacamole использует guacd, который внутри использует FreeRDP для RDP. Альтернатив «чистый» FreeRDP WebConnect нет в виде готовой библиотеки для браузера.

**Вывод:** Вариант A (Guacamole) — наиболее практичный для RDP в браузере.

---

## План реализации (Guacamole)

### Фаза 1: Расширение модели данных

**1.1. Добавить тип сервера и RDP-специфичные поля**

- В модель `Server`:
  - `server_type`: `CharField` — `'ssh'` | `'rdp'` (default `'ssh'`)
  - `port`: для RDP — default `3389`
  - `auth_method`: для RDP — только `'password'` (RDP не поддерживает SSH-ключи)
  - Опционально: `rdp_domain`, `rdp_ignore_cert`, `rdp_resolution`, `rdp_audio` (JSON в `network_config` или отдельные поля)

**1.2. Миграция**

- `python manage.py makemigrations servers`
- Обратная совместимость: существующие серверы остаются `server_type='ssh'`

---

### Фаза 2: Инфраструктура Guacamole

**2.1. Добавить guacd в Docker**

```yaml
# docker-compose.yml
guacd:
  image: guacamole/guacd:latest
  container_name: weu-guacd
  restart: unless-stopped
  # guacd слушает 4822
```

**2.2. Связь Django с guacd**

Варианты:
- **A)** Guacamole REST API (отдельный контейнер guacamole + MySQL) — тяжёлый вариант
- **B)** Прямое подключение к guacd через `guacamole-common-js` + свой HTTP/WebSocket tunnel в Django

Для встраивания в WEU оптимален **вариант B**: свой tunnel-сервис в Django, который:
1. Принимает WebSocket от браузера
2. Подключается к guacd по протоколу Guacamole
3. Проксирует трафик RDP

Библиотеки:
- **guacamole-common-js** (npm) — клиент в браузере
- **pyguacamole** или **guacapy** — Python-клиент к guacd (опционально, можно писать свой минимальный протокол)

**2.3. Протокол Guacamole**

Guacd использует свой протокол поверх сокета. Есть готовые реализации:
- [guacamole-common-js](https://www.npmjs.com/package/guacamole-common-js) — JS-клиент
- Нужен bridge: браузер ↔ Django ↔ guacd

Упрощение: использовать **Guacamole Docker stack** (guacamole + guacd + postgres) и интегрироваться через REST API (GuacaPy) + iframe или редирект на Guacamole UI с токеном.

---

### Фаза 3: Backend (Django)

**3.1. Guacamole tunnel / proxy**

- Новый WebSocket consumer: `RDPTerminalConsumer` или расширение `SSHTerminalConsumer` с ветвлением по `server_type`
- Маршрут: `ws://.../servers/<id>/rdp/` или общий `ws://.../servers/<id>/terminal/` с определением типа

**3.2. Создание RDP-соединения**

- При подключении WebSocket:
  1. Получить `Server` с `server_type='rdp'`
  2. Расшифровать пароль (как для SSH)
  3. Открыть соединение с guacd с параметрами RDP (host, port 3389, username, password)
  4. Проксировать Guacamole-протокол между браузером и guacd

**3.3. API**

- `server_test_connection` — для RDP: проверка доступности порта 3389 (или попытка RDP-handshake через guacd)
- `server_execute_command` — для RDP не применимо (нет shell); можно оставить заглушку или отключить в UI

---

### Фаза 4: Frontend

**4.1. Определение типа при открытии терминала**

- `server_terminal_page` и `multi_terminal` — проверять `server.server_type`
- Если `rdp` → открывать RDP-виджет вместо xterm.js

**4.2. RDP-виджет**

- Подключить `guacamole-common-js` (CDN или npm)
- Создать `rdp-terminal.html` или блок в `terminal.html`:
  - Контейнер для Guacamole display
  - Инициализация Guacamole client с WebSocket URL к нашему tunnel
  - Обработка resize, fullscreen, clipboard

**4.3. Список серверов**

- В `list.html` — иконка/бейдж: SSH vs RDP
- Кнопка «Подключиться» для RDP ведёт на RDP-терминал
- В форме добавления сервера — выбор типа (SSH / RDP), условные поля (для RDP скрыть key_path, показать domain при необходимости)

---

### Фаза 5: Безопасность и UX

**5.1. Безопасность**

- RDP-пароли хранить так же, как SSH (encrypted_password + salt)
- Не логировать пароли
- Проверка `user_can_feature('servers')` и `server.user == request.user`
- CORS и проверка Origin для WebSocket

**5.2. Сеть**

- Guacd должен иметь доступ к RDP-серверам (порты 3389)
- Если Windows за NAT/firewall — возможен bastion (аналог SSH bastion) — Guacamole поддерживает через конфиг

**5.3. UX**

- Единый интерфейс: вкладки SSH и RDP в multi_terminal
- Индикатор типа (иконка Windows / Linux)
- Для RDP: полноэкранный режим, масштабирование

---

## Альтернатива: Guacamole как отдельный сервис + iframe

Если не хочется встраивать guacd в WEU:

1. Развернуть [Apache Guacamole](https://guacamole.apache.org/doc/gug/installing-guacamole.html) отдельно (Docker: `glyptodon/guacamole`)
2. Настроить Guacamole REST API
3. Из Django по REST создавать connection и получать токен
4. Открывать Guacamole UI в iframe с токеном (или редирект)

**Плюсы:** Меньше кода в WEU, Guacamole сам управляет сессиями.  
**Минусы:** Отдельный сервис, другой UI, сложнее единый UX.

---

## Рекомендуемый порядок работ

| # | Этап | Оценка |
|---|------|--------|
| 1 | Расширение модели Server (server_type, миграция) | 0.5 дня |
| 2 | Форма добавления/редактирования — выбор SSH/RDP, условные поля | 0.5 дня |
| 3 | Добавить guacd в docker-compose | 0.25 дня |
| 4 | Исследование: GuacaPy / pyguacamole для создания RDP-сессий | 0.5 дня |
| 5 | WebSocket tunnel Django ↔ guacd (или использование Guacamole REST) | 1–2 дня |
| 6 | RDP consumer + маршрутизация по server_type | 1 день |
| 7 | Frontend: guacamole-common-js, rdp-terminal.html | 1 день |
| 8 | Интеграция в multi_terminal (вкладки SSH + RDP) | 0.5 дня |
| 9 | Тест подключения для RDP, доработки | 0.5 дня |

**Итого:** ~6–7 дней.

---

## Зависимости

- **guacd** — Docker-образ `guacamole/guacd`
- **guacamole-common-js** — npm или CDN
- **GuacaPy** (pip) — для REST API Guacamole (если выбран путь с полным Guacamole)
- **FreeRDP** — уже входит в guacd, отдельно не нужен

---

## Риски и ограничения

1. **NLA (Network Level Authentication)** — Windows по умолчанию требует NLA. Guacamole поддерживает, но нужно корректно передавать credentials.
2. **Сертификаты** — самоподписанные сертификаты RDP-серверов могут требовать `ignore-cert` в конфиге.
3. **Производительность** — RDP через Guacamole может быть менее отзывчивым, чем нативный клиент; для админ-задач обычно достаточно.

---

## Ссылки

- [Apache Guacamole](https://guacamole.apache.org/)
- [Guacamole REST API](https://guacamole.apache.org/doc/gug/guacamole-common.html)
- [guacamole-common-js (npm)](https://www.npmjs.com/package/guacamole-common-js)
- [GuacaPy (Python)](https://github.com/pschmitt/guacapy)
- [Guacamole Docker](https://guacamole.apache.org/doc/gug/installing-guacamole.html#docker)
