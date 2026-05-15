#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[status] docker compose services"
docker compose ps
echo
echo "[status] api health"
if curl -fsS "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:8000/health"
  echo
else
  echo "API not healthy"
fi
echo
echo "[status] frontend"
if curl -fsS "http://127.0.0.1:3000" >/dev/null 2>&1; then
  echo "Frontend reachable at http://127.0.0.1:3000"
else
  echo "Frontend not reachable"
fi
