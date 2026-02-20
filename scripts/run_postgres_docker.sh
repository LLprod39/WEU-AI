#!/bin/sh
# Запуск только PostgreSQL в Docker для локальной разработки.
# Запускать из корня проекта:  ./scripts/run_postgres_docker.sh
# Или:  sh scripts/run_postgres_docker.sh

cd "$(dirname "$0")/.." && docker compose up postgres -d
echo "Postgres в контейнере. Дальше: python scripts/setup_postgres_and_migrate.py && python manage.py runserver"
