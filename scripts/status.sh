#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "$SCRIPT_DIR/common.sh" "$@"

echo "[status] docker compose services"
compose_cmd ps
echo
echo "[status] mode: $MODE"
echo

if [[ "$MODE" == "dev" ]]; then
  echo "[status] api health (compose network)"
  if api_health="$(compose_cmd exec -T api sh -lc 'curl -fsS http://127.0.0.1:8000/health' 2>/dev/null)"; then
    echo "$api_health"
    echo
  else
    echo "API not healthy in compose network"
  fi
else
  echo "[status] api health (via frontend proxy)"
  if curl -fsS "http://127.0.0.1:${FRONTEND_PORT:-3000}/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:${FRONTEND_PORT:-3000}/health"
    echo
  else
    echo "API proxy health not reachable via frontend"
  fi
fi

echo
echo "[status] frontend"
if curl -fsS "http://127.0.0.1:${FRONTEND_PORT:-3000}" >/dev/null 2>&1; then
  echo "Frontend reachable at http://127.0.0.1:${FRONTEND_PORT:-3000}"
else
  echo "Frontend not reachable"
fi
