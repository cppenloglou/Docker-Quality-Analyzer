#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '[start] %s\n' "$*"
}

err() {
  printf '[start][error] %s\n' "$*" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: $1"
    exit 1
  fi
}

generate_secret() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48
}

ensure_env_var() {
  local key="$1"
  local val="${!key-}"
  if [[ -n "$val" ]]; then
    return 0
  fi

  local file_val
  file_val="$(awk -F= -v k="$key" '$1 == k {print substr($0, index($0, "=") + 1); exit}' ".env" || true)"
  if [[ -n "$file_val" ]]; then
    return 0
  fi

  local generated
  generated="$(generate_secret)"
  printf '%s=%s\n' "$key" "$generated" >> .env
  log "Added missing $key to .env"
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
      err "Timed out waiting for $name at $url"
      return 1
    fi
    sleep 2
  done
}

run_migrations() {
  local migration_log
  migration_log="$(mktemp)"

  if docker compose exec -T -w /app api sh -lc 'PYTHONPATH=/app alembic upgrade head' >"$migration_log" 2>&1; then
    rm -f "$migration_log"
    log "Migrations are up to date"
    return 0
  fi

  if rg -i 'duplicate|already exists|DuplicateTable' "$migration_log" >/dev/null 2>&1; then
    log "Detected existing schema without Alembic state; stamping head then retrying"
    docker compose exec -T -w /app api sh -lc 'PYTHONPATH=/app alembic stamp head' >>"$migration_log" 2>&1
    docker compose exec -T -w /app api sh -lc 'PYTHONPATH=/app alembic upgrade head' >>"$migration_log" 2>&1
    rm -f "$migration_log"
    log "Migration bootstrap completed"
    return 0
  fi

  err "Migration failed. Logs:"
  cat "$migration_log" >&2
  rm -f "$migration_log"
  return 1
}

require_cmd docker
require_cmd curl
require_cmd rg

if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose v2 is required (docker compose ...)"
  exit 1
fi

if [[ ! -f ".env" ]]; then
  log "No .env file found. Creating one with generated secrets."
  cat > .env <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$(generate_secret)
JWT_SECRET_KEY=$(generate_secret)
EOF
fi

ensure_env_var "POSTGRES_PASSWORD"
ensure_env_var "JWT_SECRET_KEY"

log "Building and starting stack"
docker compose up -d --build

log "Running migrations"
run_migrations

wait_http "http://127.0.0.1:8000/health" "API" 120
wait_http "http://127.0.0.1:3000" "Frontend" 120

log "Stack is ready"
echo "UI:  http://127.0.0.1:3000"
echo "API: http://127.0.0.1:8000"
echo "Use ./scripts/status.sh for runtime status"
echo "Use ./scripts/stop.sh --wipe to reset everything"
