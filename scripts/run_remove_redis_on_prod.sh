#!/bin/bash
# Запуск удаления Redis на prod-сервере по SSH.
# Использование (с вашей машины, где установлен sshpass):
#   export PROD_SSH_PASS='ваш_пароль'
#   ./scripts/run_remove_redis_on_prod.sh
# Или одной строкой:
#   PROD_SSH_PASS='...' ./scripts/run_remove_redis_on_prod.sh
#
# Prod: lunix@172.25.173.251:22

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_HOST="${PROD_HOST:-172.25.173.251}"
PROD_USER="${PROD_USER:-lunix}"
PROD_PORT="${PROD_PORT:-22}"

if ! command -v sshpass >/dev/null 2>&1; then
  echo "Ошибка: sshpass не установлен. Установите: sudo apt install sshpass"
  exit 1
fi

if [ -z "${PROD_SSH_PASS}" ]; then
  echo "Ошибка: задайте пароль: export PROD_SSH_PASS='пароль'"
  exit 1
fi

echo "Подключение к prod ($PROD_USER@$PROD_HOST:$PROD_PORT) и выполнение remove_redis_from_server.sh..."
sshpass -p "$PROD_SSH_PASS" ssh -o StrictHostKeyChecking=no "$PROD_USER@$PROD_HOST" -p "$PROD_PORT" 'bash -s' < "$SCRIPT_DIR/remove_redis_from_server.sh"
echo "Готово."
