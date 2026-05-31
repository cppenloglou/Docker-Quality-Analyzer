# Add/Delete/Refactor Playbook

## Purpose

Provide a single execution workflow for change requests so delivery stays fast, predictable, and reviewable.

## Standard flow

1. Confirm scope and expected behavior change.
2. Identify impacted backend/frontend/runtime boundaries.
3. Implement the minimal safe change.
4. Run strict quality gates for affected areas.
5. Summarize what changed, why, and how it was validated.

## Definition of done (strict)

A substantial task is complete only when all relevant checks pass:

- Backend changes: `cd backend && pytest -q`
- Frontend changes: `cd frontend && npm run lint && npm run build`
- Cross-cutting changes: run both backend and frontend checks

If a check fails, iterate fix -> rerun until green.

## Add tasks

- Prefer smallest vertical slice that ships user value.
- Add tests for behavior changes before closing.
- Keep API/UI contracts explicit and typed.

## Delete tasks

- Remove dead code and stale references in same change.
- Preserve compatibility or provide migration notes when needed.
- Confirm no orphaned docs/rules remain.

## Refactor tasks

- No behavior drift unless explicitly requested.
- Keep refactors incremental and reversible.
- Validate with no-regression checks and targeted smoke paths.

## PR-ready summary format

- Change intent (one sentence)
- Files/systems touched
- Risk notes
- Validation commands and outcomes
