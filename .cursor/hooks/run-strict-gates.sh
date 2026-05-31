#!/usr/bin/env bash
set -euo pipefail

# Read hook payload (unused for now, but consumed to avoid broken pipes)
HOOK_INPUT="$(cat || true)"
export HOOK_INPUT

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
LOG_FILE="context/quality-gate-feedback.log"
mkdir -p "$(dirname "$LOG_FILE")"

CHANGED_FILES="$(git status --porcelain | awk '{print $2}')"

if [[ -z "$CHANGED_FILES" ]]; then
  echo "[strict-gates] No changed files detected; skipping checks."
  printf "%s | skip | no-changes\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$LOG_FILE"
  exit 0
fi

RUN_BACKEND=0
RUN_FRONTEND=0

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ "$file" == backend/* ]] && RUN_BACKEND=1
  [[ "$file" == frontend/* ]] && RUN_FRONTEND=1
done <<< "$CHANGED_FILES"

EXIT_CODE=0

if [[ $RUN_BACKEND -eq 1 ]]; then
  echo "[strict-gates] Running backend tests: pytest -q"
  if ! (cd backend && pytest -q); then
    echo "[strict-gates] Backend quality gate failed."
    EXIT_CODE=1
  fi
fi

if [[ $RUN_FRONTEND -eq 1 ]]; then
  echo "[strict-gates] Running frontend lint: npm run lint"
  if ! (cd frontend && npm run lint); then
    echo "[strict-gates] Frontend lint gate failed."
    EXIT_CODE=1
  fi

  echo "[strict-gates] Running frontend build: npm run build"
  if ! (cd frontend && npm run build); then
    echo "[strict-gates] Frontend build gate failed."
    EXIT_CODE=1
  fi
fi

if [[ $RUN_BACKEND -eq 0 && $RUN_FRONTEND -eq 0 ]]; then
  echo "[strict-gates] No backend/frontend source changes detected; skipping checks."
  printf "%s | skip | non-app-changes\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$LOG_FILE"
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  printf "%s | pass | backend=%s frontend=%s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$RUN_BACKEND" "$RUN_FRONTEND" >> "$LOG_FILE"
else
  printf "%s | fail | backend=%s frontend=%s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$RUN_BACKEND" "$RUN_FRONTEND" >> "$LOG_FILE"
fi

exit "$EXIT_CODE"
