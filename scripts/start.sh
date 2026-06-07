#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "$SCRIPT_DIR/common.sh" "$@"

log() {
  printf '[start] %s\n' "$*"
}

wait_http() {
  local url="$1"
  local name="$2"
  local timeout_s="${3:-120}"
  local start_ts now
  start_ts="$(date +%s)"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$name is healthy at $url"
      return 0
    fi
    now="$(date +%s)"
    if (( now - start_ts >= timeout_s )); then
      echo "[start][error] Timed out waiting for $name at $url" >&2
      return 1
    fi
    sleep 2
  done
}

wait_postgres() {
  local timeout_s="${1:-120}"
  local start_ts now
  start_ts="$(date +%s)"
  while true; do
    if compose_cmd exec -T postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      log "Postgres is ready"
      return 0
    fi
    now="$(date +%s)"
    if (( now - start_ts >= timeout_s )); then
      echo "[start][error] Timed out waiting for Postgres readiness" >&2
      return 1
    fi
    sleep 2
  done
}

wait_api_container() {
  local timeout_s="${1:-120}"
  local start_ts now
  start_ts="$(date +%s)"
  while true; do
    if compose_cmd exec -T api sh -lc 'curl -fsS http://127.0.0.1:8000/health >/dev/null' >/dev/null 2>&1; then
      log "API is healthy in container network"
      return 0
    fi
    now="$(date +%s)"
    if (( now - start_ts >= timeout_s )); then
      echo "[start][error] Timed out waiting for API container health" >&2
      return 1
    fi
    sleep 2
  done
}

ensure_env_file() {
  if [[ ! -f ".env" ]]; then
    if [[ -f ".env.example" ]]; then
      cp .env.example .env
      log "Created .env from .env.example"
    else
      cat > .env <<EOF
COMPOSE_PROJECT_NAME=docker-platform
APP_ENV=dev
POSTGRES_USER=postgres
POSTGRES_DB=docker_platform
API_PORT=8000
FRONTEND_PORT=3000
ADMINER_PORT=8080
VITE_API_BASE_URL=
EOF
      log "Created minimal .env"
    fi
  fi
}

ensure_secret_file() {
  local target="$1"
  local example="$2"
  if [[ -f "$target" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$target")"
  if [[ -f "$example" ]]; then
    cp "$example" "$target"
  else
    printf '%s\n' "$(generate_secret)" > "$target"
  fi
  log "Created missing secret file: $target"
}

run_migrations() {
  local migration_log alembic_subcmd
  migration_log="$(mktemp)"
  alembic_subcmd="upgrade head"

  run_alembic_once() {
    compose_cmd run --rm --no-deps -w /app api sh -lc "set -euo pipefail
export POSTGRES_PASSWORD=\"\$(cat /run/secrets/postgres_password)\"
export DATABASE_URL=\"postgresql+asyncpg://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB:-docker_platform}\"
export PYTHONPATH=/app
cd /app
alembic ${alembic_subcmd}"
  }

  # Run before API boot so lifespan create_all cannot race Alembic (common after --wipe).
  if run_alembic_once >"$migration_log" 2>&1; then
    rm -f "$migration_log"
    log "Migrations are up to date"
    return 0
  fi

  if rg -i 'duplicate|already exists|DuplicateTable|DuplicateObject' "$migration_log" >/dev/null 2>&1; then
    log "Detected existing schema without Alembic state; stamping head then retrying"
    alembic_subcmd="stamp head"
    run_alembic_once >>"$migration_log" 2>&1
    alembic_subcmd="upgrade head"
    run_alembic_once >>"$migration_log" 2>&1
    rm -f "$migration_log"
    log "Migration bootstrap completed"
    return 0
  fi

  echo "[start][error] Migration failed. Logs:" >&2
  cat "$migration_log" >&2
  rm -f "$migration_log"
  return 1
}

require_cmd docker
require_cmd curl
require_cmd rg

if ! docker compose version >/dev/null 2>&1; then
  echo "[start][error] Docker Compose v2 is required (docker compose ...)" >&2
  exit 1
fi

ensure_env_file
ensure_secret_file "secrets/postgres_password.txt" "secrets/postgres_password.txt.example"
ensure_secret_file "secrets/jwt_secret.txt" "secrets/jwt_secret.txt.example"

log "Starting stack in mode: $MODE"
log "Building API image and bringing up Postgres (and Redis) before API boot"
compose_cmd build api
compose_cmd up -d postgres redis

log "Waiting for Postgres"
wait_postgres 180

log "Running migrations"
run_migrations

log "Starting remaining services"
compose_cmd up -d

wait_http "http://127.0.0.1:${FRONTEND_PORT:-3000}" "Frontend" 180

if [[ "$MODE" == "dev" ]]; then
  wait_api_container 180
  echo "UI (dev):      http://127.0.0.1:${FRONTEND_PORT:-3000}"
  echo "API (network): http://api:8000 (inside compose network)"
else
  wait_http "http://127.0.0.1:${FRONTEND_PORT:-3000}/health" "API via frontend proxy" 180
  echo "UI (prod-like): http://127.0.0.1:${FRONTEND_PORT:-3000}"
  echo "API is available through frontend proxy routes"
fi

echo "Use ./scripts/status.sh --$MODE for runtime status"
if [[ "$MODE" == "dev" ]]; then
  echo "Use ./scripts/stop.sh --$MODE --wipe to reset volumes and backend/storage/uploads"
else
  echo "Use ./scripts/stop.sh --$MODE --wipe to reset volumes"
fi
