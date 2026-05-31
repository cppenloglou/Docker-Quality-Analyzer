#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${MODE:-dev}"
PROFILE_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --dev)
      MODE="dev"
      ;;
    --prod)
      MODE="prod"
      ;;
    --tools)
      PROFILE_ARGS+=(--profile tools)
      ;;
  esac
done

if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  echo "[scripts][error] MODE must be 'dev' or 'prod'" >&2
  exit 1
fi

COMPOSE_FILES=(-f compose.yaml)
if [[ "$MODE" == "dev" ]]; then
  COMPOSE_FILES+=(-f compose.dev.yaml)
else
  COMPOSE_FILES+=(-f compose.prod.yaml)
fi

compose_cmd() {
  docker compose --env-file .env "${COMPOSE_FILES[@]}" "${PROFILE_ARGS[@]}" "$@"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[scripts][error] Missing required command: $1" >&2
    exit 1
  fi
}

generate_secret() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48
}
