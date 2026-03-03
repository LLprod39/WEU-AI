# MINI Version (Servers Only)

Эта папка содержит отдельную урезанную версию проекта для прод-использования только с модулем `Servers` и минимальными админ-настройками.

Что оставлено:
- вкладка `Servers` (SSH/RDP терминал, группы серверов, шаринг, AI в терминале)
- авторизация (`login/logout`)
- веб-вкладка `Настройки` в мини-формате:
  - управление моделями чата (провайдеры/модели)
  - логи активности
  - управление пользователями, группами и правами
- минимальные настройки доступа для админов:
  - пользователи
  - группы
  - права
  - логи активности
- Django Admin (`/admin/`)

Что убрано из роутов и `INSTALLED_APPS`:
- `tasks`
- `agent_hub`
- `skills`
- `passwords` (как Django app; модуль шифрования оставлен как кодовая зависимость)
- Jira API и прочие несерверные endpoints

## Запуск

```bash
cd mini_prod
python -m venv venv
venv\\Scripts\\activate
pip install -r requirements-mini.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

## Новый npm frontend (React + Vite)

Фронтенд вынесен в `mini_prod/ai-server-terminal-main` и работает с Django backend через API/WebSocket.

```bash
cd mini_prod/ai-server-terminal-main
npm install
npm run dev
```

По умолчанию Vite поднимается на `http://127.0.0.1:8080` и проксирует:
- `/api/*` -> Django
- `/servers/api/*` -> Django
- `/ws/*` -> Django WebSocket

Если backend у вас на другом адресе, задайте переменные:

```env
VITE_DJANGO_URL=http://127.0.0.1:9000
VITE_DJANGO_WS_URL=ws://127.0.0.1:9000
VITE_BACKEND_ORIGIN=http://127.0.0.1:9000
```

Также в Django используется редирект на SPA через `FRONTEND_APP_URL`:

```env
FRONTEND_APP_URL=http://127.0.0.1:8080
```

Страницы `/login`, `/dashboard`, `/servers/*`, `/settings*` теперь ведут в новый React UI.

## PostgreSQL (Docker)

В каталоге `mini_prod` есть свой `docker-compose.yml` — поднимается только контейнер PostgreSQL.

**Запуск Postgres:**

```bash
cd mini_prod
docker compose up -d
```

Проверка: `docker compose ps` — сервис `postgres` должен быть `running`. Логи: `docker compose logs -f postgres`.

**Подключение приложения:**

В `mini_prod/.env` задайте (или скопируйте из корневого `.env`):

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=weu_platform
POSTGRES_USER=weu
POSTGRES_PASSWORD=weu_secret_change_me
```

Затем миграции и запуск:

```bash
python manage.py migrate
python manage.py runserver
```

Остановка контейнера: `docker compose down`. Данные сохраняются в volume `mini_prod_postgres_data`.

Если нужен тот же Postgres, что и у основного проекта, держите `mini_prod/.env` с теми же `POSTGRES_*` и поднимайте Postgres из корня репозитория (`docker compose up postgres -d`).

## Зависимости

В `mini_prod` зависимости уже урезаны под текущий состав кода:
- Django + Channels + Daphne
- PostgreSQL driver (`psycopg`)
- SSH/RDP серверный контур (`asyncssh`, `cryptography`)
- LLM API для настроек/terminal AI (`google-genai`, `httpx`, `aiohttp`)

После запуска:
- `http://127.0.0.1:8000/servers/` — основной раздел
- `http://127.0.0.1:8000/settings/` — мини-настройки (модели, логи, доступы)
- `http://127.0.0.1:8000/admin/` — админка Django
