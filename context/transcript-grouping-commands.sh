#!/usr/bin/env bash
set -euo pipefail

# Groups parent transcript folders into keep/archive/delete-candidates buckets.
# No transcript content is deleted.
# Usage:
#   bash transcript-grouping-commands.sh [--dry-run] [transcripts_root] [lists_root]
#   bash transcript-grouping-commands.sh --apply [transcripts_root] [lists_root]

MODE="dry-run"
if [[ "${1:-}" == "--dry-run" ]]; then
  MODE="dry-run"
  shift
elif [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
  shift
fi

TRANSCRIPTS_ROOT="${1:-/home/cppenloglou/.cursor/projects/home-cppenloglou-Documents-Docker-Quality-Analyzer/agent-transcripts}"
LISTS_ROOT="${2:-/home/cppenloglou/Documents/Docker-Quality-Analyzer/context}"

mkdir -p "$TRANSCRIPTS_ROOT/keep" "$TRANSCRIPTS_ROOT/archive" "$TRANSCRIPTS_ROOT/delete-candidates"

move_group() {
  local list_file="$1"
  local target_dir="$2"

  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    [[ "$id" == \#* ]] && continue
    if [[ -d "$TRANSCRIPTS_ROOT/$id" ]]; then
      if [[ "$MODE" == "apply" ]]; then
        mv "$TRANSCRIPTS_ROOT/$id" "$TRANSCRIPTS_ROOT/$target_dir/"
        echo "moved $id -> $target_dir/"
      else
        echo "would move $id -> $target_dir/"
      fi
    else
      echo "skip missing: $id"
    fi
  done < "$list_file"
}

move_group "$LISTS_ROOT/transcript-groups-keep.txt" "keep"
move_group "$LISTS_ROOT/transcript-groups-archive.txt" "archive"
move_group "$LISTS_ROOT/transcript-groups-delete-candidates.txt" "delete-candidates"

if [[ "$MODE" == "apply" ]]; then
  echo "done: grouped transcript folders under $TRANSCRIPTS_ROOT"
else
  echo "done: dry-run preview only (no folders moved)"
fi
