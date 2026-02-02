#!/bin/bash
# Проверка места на диске на prod (172.25.173.251)
# Требуется: sshpass (sudo apt install sshpass)
# Использование: ./check_disk_prod.sh

set -e
HOST="172.25.173.251"
USER="lunix"
PORT="22"
export SSHPASS='LLprod393@'

echo "=== 1. Место на диске (df -h) ==="
sshpass -e ssh -o StrictHostKeyChecking=no "${USER}@${HOST}" -p "${PORT}" 'df -h'

echo ""
echo "=== 2. GET /api/disk/ (порты 8000, 8080, 80) ==="
for port in 8000 8080 80; do
  echo "--- Port $port ---"
  sshpass -e ssh -o StrictHostKeyChecking=no "${USER}@${HOST}" -p "${PORT}" \
    "curl -s -w '\nHTTP_CODE:%{http_code}\n' http://127.0.0.1:${port}/api/disk/ 2>/dev/null || echo 'curl failed'"
done

echo ""
echo "=== 3. Процессы приложения (gunicorn/uwsgi/django) ==="
sshpass -e ssh -o StrictHostKeyChecking=no "${USER}@${HOST}" -p "${PORT}" \
  'ps aux | grep -E "gunicorn|uwsgi|manage.py|runserver" | grep -v grep || true'

echo ""
echo "=== 4. Службы (systemctl) ==="
sshpass -e ssh -o StrictHostKeyChecking=no "${USER}@${HOST}" -p "${PORT}" \
  'systemctl list-units --type=service --state=running 2>/dev/null | grep -E "gunicorn|uwsgi|django|web" || true'
