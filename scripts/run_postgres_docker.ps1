# Запуск только PostgreSQL в Docker для локальной разработки.
# Запускать из корня проекта:  .\scripts\run_postgres_docker.ps1

Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
docker compose up postgres -d
Write-Host "Postgres в контейнере. Дальше: python scripts/setup_postgres_and_migrate.py && python manage.py runserver"
