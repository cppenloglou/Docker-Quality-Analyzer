#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/common.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh" "$@"

if [[ " $* " == *" --wipe "* ]]; then
  echo "[stop] Stopping $MODE stack and removing volumes"
  compose_cmd down -v --remove-orphans
  if [[ "$MODE" == "dev" ]]; then
    clean_dev_upload_storage
  fi
else
  echo "[stop] Stopping $MODE stack"
  compose_cmd down --remove-orphans
fi
