#!/usr/bin/env python
"""
Настройка PostgreSQL для WEU: создание БД, миграции, суперпользователь и перенос данных из SQLite.

Порядок действий:

  1. Сначала развернуть Postgres в Docker (из корня проекта):
       Текущий контекст (общий weu-postgres на 5432):
         docker compose up postgres -d
       Новый контекст (отдельный weu-dev, порт 5433, не трогает weu-web и др.):
         docker compose -f docker-compose.dev.yml -p weu-dev up -d
       и в .env задать POSTGRES_PORT=5433

  2. Запустить настройку и миграцию:
       python scripts/setup_postgres_and_migrate.py

  3. Запуск приложения:
       python manage.py runserver

Требования:
  - В .env заданы POSTGRES_HOST=localhost, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
    (при Django на хосте и Postgres в Docker хост = localhost)
  - Docker установлен; контейнер postgres запущен (см. шаг 1)

Опционально в .env:
  - DJANGO_SUPERUSER_USERNAME=admin
  - DJANGO_SUPERUSER_PASSWORD=...
  - DJANGO_SUPERUSER_EMAIL=admin@example.com
  Если не заданы — будет создан admin с паролем из запроса или admin/admin.

Если Postgres не в Docker, а установлен в системе (Linux):
  createuser -U postgres -P weu
  createdb -U postgres -O weu weu_platform
"""
import os
import subprocess
import sys
from pathlib import Path

# Корень проекта (родитель каталога scripts)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
os.chdir(PROJECT_ROOT)
sys.path.insert(0, str(PROJECT_ROOT))

# Загрузка .env до импорта Django
env_file = PROJECT_ROOT / ".env"
if env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file)
    except ImportError:
        pass

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_DB = os.getenv("POSTGRES_DB", "weu_platform")
POSTGRES_USER = os.getenv("POSTGRES_USER", "weu")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")


def run_cmd(args, env=None, check=True):
    """Запуск команды; env — доп. переменные (текущий env копируется и обновляется)."""
    e = os.environ.copy()
    if env:
        e.update(env)
    r = subprocess.run(args, cwd=PROJECT_ROOT, env=e)
    if check and r.returncode != 0:
        print(f"Ошибка: команда завершилась с кодом {r.returncode}: {' '.join(args)}")
        sys.exit(r.returncode)
    return r.returncode


def ensure_postgres_db():
    """Создать базу PostgreSQL, если её ещё нет."""
    try:
        import psycopg
    except ImportError:
        print("Установите драйвер: pip install 'psycopg[binary]'")
        sys.exit(1)

    # Подключаемся к служебной БД postgres
    try:
        conn = psycopg.connect(
            host=POSTGRES_HOST,
            port=POSTGRES_PORT,
            dbname="postgres",
            user=POSTGRES_USER,
            password=POSTGRES_PASSWORD,
            connect_timeout=5,
        )
    except Exception as e:
        print(f"Не удалось подключиться к PostgreSQL: {e}")
        print("Сначала разверните Postgres в Docker:  docker compose up postgres -d")
        print("Проверьте также POSTGRES_HOST=localhost и пароль в .env")
        sys.exit(1)

    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM pg_database WHERE datname = %s",
        (POSTGRES_DB,),
    )
    if cur.fetchone() is None:
        cur.execute(f'CREATE DATABASE "{POSTGRES_DB}"')
        print(f"База данных {POSTGRES_DB} создана.")
    else:
        print(f"База данных {POSTGRES_DB} уже существует.")
    cur.close()
    conn.close()


def run_migrate():
    """Применить миграции к PostgreSQL."""
    print("Применение миграций...")
    run_cmd([sys.executable, "manage.py", "migrate", "--noinput"])


def migrate_from_sqlite():
    """Перенести данные из db.sqlite3 в текущую БД (PostgreSQL)."""
    sqlite_path = PROJECT_ROOT / "db.sqlite3"
    if not sqlite_path.exists():
        print("Файл db.sqlite3 не найден — перенос из SQLite пропущен.")
        return

    dump_file = PROJECT_ROOT / "scripts" / "dump_from_sqlite.json"
    # В подпроцессе убираем POSTGRES_*, чтобы Django использовал SQLite
    env_sqlite = os.environ.copy()
    env_sqlite["POSTGRES_HOST"] = ""
    env_sqlite["POSTGRES_DB"] = ""
    # UTF-8 при записи JSON (на Windows иначе падает на символах вроде ✅)
    env_sqlite["PYTHONUTF8"] = "1"

    print("Экспорт данных из SQLite...")
    run_cmd(
        [
            sys.executable, "manage.py", "dumpdata",
            "--natural-foreign", "--natural-primary",
            "--exclude", "contenttypes",
            "--exclude", "auth.permission",
            "--exclude", "sessions.session",
            "-o", str(dump_file),
        ],
        env=env_sqlite,
    )

    print("Импорт данных в PostgreSQL...")
    run_cmd([sys.executable, "manage.py", "loaddata", str(dump_file)])

    dump_file.unlink(missing_ok=True)
    print("Перенос данных из SQLite завершён.")


def ensure_superuser():
    """Создать суперпользователя, если ни одного нет."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "web_ui.settings")
    import django
    django.setup()
    from django.contrib.auth import get_user_model
    User = get_user_model()
    if User.objects.filter(is_superuser=True).exists():
        print("Суперпользователь уже есть — создание пропущено.")
        return

    username = os.getenv("DJANGO_SUPERUSER_USERNAME", "admin")
    email = os.getenv("DJANGO_SUPERUSER_EMAIL", "admin@example.com")
    password = os.getenv("DJANGO_SUPERUSER_PASSWORD", "")

    if not password:
        import getpass
        password = getpass.getpass(f"Пароль для {username} (или Enter = 'admin'): ") or "admin"

    User.objects.create_superuser(username=username, email=email, password=password)
    print(f"Создан суперпользователь: {username}")


def main():
    if not POSTGRES_HOST or not POSTGRES_DB:
        print("Задайте POSTGRES_HOST и POSTGRES_DB в .env для использования PostgreSQL.")
        sys.exit(1)

    print("=== Настройка PostgreSQL для WEU ===")
    print("Если Postgres ещё не запущен:")
    print("  текущий контекст:     docker compose up postgres -d")
    print("  новый контекст weu-dev:  docker compose -f docker-compose.dev.yml -p weu-dev up -d  (в .env: POSTGRES_PORT=5433)\n")
    ensure_postgres_db()
    run_migrate()
    migrate_from_sqlite()
    ensure_superuser()
    print("\nГотово. Запуск: python manage.py runserver")


if __name__ == "__main__":
    main()
