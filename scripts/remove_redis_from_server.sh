#!/bin/bash
# Удаление Redis с prod-сервера.
# Запуск с вашей машины (если установлен sshpass):
#   sshpass -p '<пароль>' ssh -o StrictHostKeyChecking=no USER@HOST -p 22 'bash -s' < scripts/remove_redis_from_server.sh
# Пароль и хост не храните в скрипте — передавайте через переменные окружения или ввод.
# Или зайти на сервер (ssh USER@HOST) и выполнить команды из scripts/remove_redis_commands.txt вручную.

set -e

echo "=== Проверка наличия Redis ==="
REDIS_FOUND=0

# Systemd
if systemctl list-units --type=service --all 2>/dev/null | grep -qi redis; then
  REDIS_FOUND=1
  echo "Найден сервис Redis (systemd)."
fi
# Пакет
if command -v dpkg >/dev/null 2>&1 && dpkg -l 2>/dev/null | grep -q redis; then
  REDIS_FOUND=1
  echo "Найден пакет Redis (dpkg)."
fi
# Docker
if command -v docker >/dev/null 2>&1 && docker ps -a 2>/dev/null | grep -qi redis; then
  REDIS_FOUND=1
  echo "Найден контейнер Redis (Docker)."
fi
# Процесс
if pgrep -x redis-server >/dev/null 2>&1; then
  REDIS_FOUND=1
  echo "Найден процесс redis-server."
fi

if [ "$REDIS_FOUND" -eq 0 ]; then
  echo "Redis на сервере не обнаружен. Ничего делать не нужно."
  exit 0
fi

echo ""
echo "=== Остановка и удаление Redis ==="

# 1. Systemd
if systemctl list-units --type=service --all 2>/dev/null | grep -qi redis; then
  sudo systemctl stop redis-server 2>/dev/null || sudo systemctl stop redis 2>/dev/null || true
  sudo systemctl disable redis-server 2>/dev/null || sudo systemctl disable redis 2>/dev/null || true
  echo "Сервис Redis остановлен и отключен."
fi
# Удаление unit-файлов (симлинков) и перезагрузка systemd
sudo rm -f /etc/systemd/system/redis.service /etc/systemd/system/redis-server.service 2>/dev/null || true
sudo systemctl daemon-reload 2>/dev/null || true
sudo systemctl reset-failed 2>/dev/null || true

# 2. Docker
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null); do
    if echo "$c" | grep -qi redis; then
      docker stop "$c" 2>/dev/null || true
      docker rm "$c" 2>/dev/null || true
      echo "Контейнер $c остановлен и удалён."
    fi
  done
fi

# 3. Убить процесс если ещё крутится
if pgrep -x redis-server >/dev/null 2>&1; then
  sudo pkill -x redis-server || true
  echo "Процесс redis-server завершён."
fi

# 4. Удаление пакетов (Debian/Ubuntu)
if command -v apt-get >/dev/null 2>&1 && dpkg -l 2>/dev/null | grep -q redis; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y redis-server redis-tools 2>/dev/null || true
  sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y redis-server redis-tools 2>/dev/null || true
  sudo dpkg --purge redis-server redis-tools 2>/dev/null || true
  sudo apt-get autoremove -y 2>/dev/null || true
  echo "Пакеты Redis удалены."
fi

# 5. Опционально: удалить данные (раскомментируйте при необходимости)
# sudo rm -rf /var/lib/redis
# sudo rm -rf /etc/redis

echo ""
echo "=== Проверка: Redis должен отсутствовать ==="
VERIFY_FAIL=0
set +e
if systemctl list-units --type=service --all 2>/dev/null | grep -qi redis; then
  echo "ОШИБКА: сервис systemd с redis всё ещё есть."
  VERIFY_FAIL=1
else
  echo "OK: сервисов systemd redis нет."
fi
if command -v dpkg >/dev/null 2>&1 && dpkg -l 2>/dev/null | grep -q redis; then
  echo "ОШИБКА: пакет dpkg redis всё ещё установлен."
  VERIFY_FAIL=1
else
  echo "OK: пакетов dpkg redis нет."
fi
if command -v docker >/dev/null 2>&1 && docker ps -a 2>/dev/null | grep -qi redis; then
  echo "ОШИБКА: контейнер Docker с redis всё ещё есть."
  VERIFY_FAIL=1
else
  echo "OK: контейнеров Docker redis нет."
fi
if pgrep -x redis-server >/dev/null 2>&1; then
  echo "ОШИБКА: процесс redis-server всё ещё запущен."
  VERIFY_FAIL=1
else
  echo "OK: процесса redis-server нет."
fi

echo ""
set -e
if [ "$VERIFY_FAIL" -eq 1 ]; then
  echo "=== Предупреждение: не все следы Redis удалены. Проверьте вывод выше. ==="
  exit 1
fi
echo "=== Готово. Redis удалён с сервера, проверка пройдена. ==="
