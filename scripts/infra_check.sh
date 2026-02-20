#!/usr/bin/env bash
# Проверка статуса инфраструктуры (диск, память, нагрузка).
# Запускать локально: bash scripts/infra_check.sh
# Используй свои команды подключения; ниже — шаблоны с <COMMAND>.

run_ssh() {
  local cmd="$1"
  # Вариант с паролем (lunix) — подставь свой вызов при необходимости:
  # sshpass -p '...' ssh -o StrictHostKeyChecking=no lunix@172.25.173.251 -p 22 "$cmd"
  ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 lunix@172.25.173.251 -p 22 "$cmd"
}

echo "=== HOSTNAME ==="
run_ssh "hostname" 2>/dev/null || echo "Не удалось подключиться (проверь ключи/пароль)"

echo ""
echo "=== UPTIME & LOAD ==="
run_ssh "uptime" 2>/dev/null

echo ""
echo "=== DISK (df -h) ==="
run_ssh "df -h" 2>/dev/null

echo ""
echo "=== MEMORY (free -h) ==="
run_ssh "free -h" 2>/dev/null

echo ""
echo "=== TOP 5 процессов по памяти ==="
run_ssh "ps aux --sort=-%mem | head -6" 2>/dev/null
