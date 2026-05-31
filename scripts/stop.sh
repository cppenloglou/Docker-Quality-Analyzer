#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/common.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh" "$@"

if [[ " $* " == *" --wipe "* ]]; then
  echo "[stop] Stopping $MODE stack and removing volumes"
  compose_cmd down -v --remove-orphans
else
  echo "[stop] Stopping $MODE stack"
  compose_cmd down --remove-orphans
fi
