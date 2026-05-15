#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${1-}" == "--wipe" ]]; then
  echo "[stop] Stopping stack and removing volumes"
  docker compose down -v --remove-orphans
else
  echo "[stop] Stopping stack"
  docker compose down --remove-orphans
fi
