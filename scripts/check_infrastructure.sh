#!/bin/bash
# Проверка статуса инфраструктуры (сервер 172.25.173.251).
# Запуск: ./scripts/check_infrastructure.sh
# Требуется: sshpass (apt install sshpass / yum install sshpass)

set -e
HOST="172.25.173.251"
PORT="22"

run_admin() {
  sshpass -p 'LLprod393@' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "admin@${HOST}" -p "$PORT" "$@"
}

run_lunix() {
  sshpass -p 'LLprod393@' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "lunix@${HOST}" -p "$PORT" "$@"
}

echo "=============================================="
echo "  ПРОВЕРКА ИНФРАСТРУКТУРЫ — $HOST"
echo "=============================================="

echo ""
echo "--- 1. Hostname и Uptime (admin) ---"
run_admin "hostname; uptime" || true

echo ""
echo "--- 2. Диски (df -h) ---"
run_admin "df -h" || true

echo ""
echo "--- 3. Память (free -h) ---"
run_admin "free -h" || true

echo ""
echo "--- 4. Нагрузка (load average) ---"
run_admin "cat /proc/loadavg" || true

echo ""
echo "--- 5. Неудавшиеся systemd-юниты ---"
run_admin "systemctl list-units --state=failed 2>/dev/null || true" || true

echo ""
echo "--- 6. Docker (если установлен) ---"
run_admin "docker ps -a 2>/dev/null || echo 'Docker не установлен или не в PATH'" || true

echo ""
echo "--- 7. Место в /var/log ---"
run_admin "du -sh /var/log 2>/dev/null; df -h /var/log" || true

echo ""
echo "--- 8. Сетевые слушающие порты (топ) ---"
run_admin "ss -tlnp 2>/dev/null | head -25 || netstat -tlnp 2>/dev/null | head -25" || true

echo ""
echo "=============================================="
echo "  Проверка завершена"
echo "=============================================="
