#!/bin/sh
# Запуск Postgres (и Redis) в отдельном контексте для локальной разработки.
# Контейнеры: weu-dev-postgres-1, weu-dev-redis-1 (проект weu-dev).
# Не трогает текущие weu-web, weu-postgres и т.д.
#
# Перед первым запуском в .env задайте:  POSTGRES_PORT=5433
# Затем:  python scripts/setup_postgres_and_migrate.py  &&  python manage.py runserver

cd "$(dirname "$0")/.."
docker compose -f docker-compose.dev.yml -p weu-dev up -d
echo ""
echo "Контекст weu-dev запущен. Postgres на порту 5433 (если в .env POSTGRES_PORT=5433)."
echo "Дальше: python scripts/setup_postgres_and_migrate.py && python manage.py runserver"
