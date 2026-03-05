#!/usr/bin/env bash
set -euo pipefail

# bootstrap-linux.sh
# One-command setup for Linux hosts:
# - create local config files from templates
# - start Docker services (Postgres + MCP demo + MCP keycloak)
# - create Python venv and install dependencies
# - run Django migrations
# - optionally install frontend dependencies

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

USE_FULL_REQUIREMENTS=0
SKIP_FRONTEND=0
NO_DOCKER=0
FORCE_CONFIG=0
COMPOSE_FILE="docker-compose.yml"

print_help() {
  cat <<'EOF'
Usage: ./bootstrap-linux.sh [options]

Options:
  --full               Install requirements-full.txt (default: requirements-mini.txt)
  --skip-frontend      Skip npm install in ai-server-terminal-main
  --no-docker          Do not run docker compose
  --compose-file FILE  Compose file to use (default: docker-compose.yml)
  --force-config       Overwrite existing .env/.notification_config.json from templates
  -h, --help           Show this help

Examples:
  ./bootstrap-linux.sh
  ./bootstrap-linux.sh --full
  ./bootstrap-linux.sh --compose-file docker-compose.postgres-mcp.yml
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      USE_FULL_REQUIREMENTS=1
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND=1
      shift
      ;;
    --no-docker)
      NO_DOCKER=1
      shift
      ;;
    --compose-file)
      COMPOSE_FILE="${2:-}"
      if [[ -z "$COMPOSE_FILE" ]]; then
        echo "Error: --compose-file requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --force-config)
      FORCE_CONFIG=1
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: command not found: $cmd" >&2
    exit 1
  fi
}

copy_template_if_needed() {
  local template_path="$1"
  local target_path="$2"

  if [[ ! -f "$template_path" ]]; then
    echo "[skip] template not found: $template_path"
    return
  fi

  if [[ -f "$target_path" && "$FORCE_CONFIG" -ne 1 ]]; then
    echo "[skip] exists: $target_path (use --force-config to overwrite)"
    return
  fi

  cp "$template_path" "$target_path"
  echo "[ok] created: $target_path"
}

wait_for_container_health() {
  local container="$1"
  local timeout_seconds="${2:-120}"
  local elapsed=0

  while true; do
    if ! docker inspect "$container" >/dev/null 2>&1; then
      echo "[wait] container not found yet: $container"
    else
      local status
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        echo "[ok] container ready: $container ($status)"
        return 0
      fi
      echo "[wait] $container status: ${status:-unknown}"
    fi

    sleep 2
    elapsed=$((elapsed + 2))
    if (( elapsed >= timeout_seconds )); then
      echo "Error: timeout waiting for container: $container" >&2
      return 1
    fi
  done
}

echo "==> Preparing configuration files"
copy_template_if_needed ".env.example" ".env"
copy_template_if_needed ".notification_config.example.json" ".notification_config.json"

echo "==> Preparing Python environment"
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Error: Python not found (python3/python)." >&2
  exit 1
fi

"$PYTHON_BIN" -m venv .venv
VENV_PYTHON="$ROOT_DIR/.venv/bin/python"
VENV_PIP="$ROOT_DIR/.venv/bin/pip"

"$VENV_PYTHON" -m pip install --upgrade pip setuptools wheel
if [[ "$USE_FULL_REQUIREMENTS" -eq 1 ]]; then
  "$VENV_PIP" install -r requirements-full.txt
  echo "[ok] installed requirements-full.txt"
else
  "$VENV_PIP" install -r requirements-mini.txt
  echo "[ok] installed requirements-mini.txt"
fi

if [[ "$NO_DOCKER" -eq 0 ]]; then
  echo "==> Starting Docker services from $COMPOSE_FILE"
  require_cmd docker
  docker compose -f "$COMPOSE_FILE" up -d --build postgres mcp-demo mcp-keycloak

  wait_for_container_health "mini-prod-postgres" 180
  wait_for_container_health "mini-prod-mcp-demo" 180
  wait_for_container_health "mini-prod-mcp-keycloak" 180
fi

echo "==> Running Django migrations"
"$VENV_PYTHON" manage.py migrate

if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
  echo "==> Installing frontend dependencies"
  require_cmd npm
  (cd ai-server-terminal-main && npm install)
fi

cat <<'EOF'

[done] Bootstrap complete.

Next steps:
  1) Fill real secrets in .env and .notification_config.json
  2) Start backend:
       source .venv/bin/activate
       python manage.py runserver
  3) Start frontend (in another shell):
       cd ai-server-terminal-main
       npm run dev

Notes:
  - Do NOT commit .env or .notification_config.json with real secrets.
  - If you need the full AI/RAG stack, rerun with --full.
EOF
