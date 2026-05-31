# Chat Knowledge Index (Current Application)

Last updated: 2026-05-17

This file consolidates product decisions extracted from parent chat transcripts and keeps them aligned with current application behavior.

## Core decisions

- Project upload currently follows **scan -> auto-analyze detected Docker/Compose assets**.
- Upload flow currently defaults image builds on (`build_selected_images=true` in payload), while build execution remains worker-gated.
- Compose run/deploy remains explicit user intent (`run_stack` path), not an automatic side effect of upload/analysis.
- Project merged result integrity must preserve `per_file_results`, `image_build_results`, `service_mappings`, and `project_summary`.
- Runtime/monitoring should represent terminal states truthfully (`exited`, `failed`, `stopped_by_user`, `cleanup_completed`) and avoid misleading "live" indicators.
- Research analytics must remain privacy-safe: anonymized submitter plus sanitized public metadata/results only.
- Dockerfile issue metadata can include deterministic documentation links for Hadolint/ShellCheck codes.

## High-value transcript sources

- [Project Analysis Major Milestone](c9bcaf0d-eb3f-4815-8c70-47be9a8768b4)
- [Project Workflow State Hardening](3a6344b2-564c-49c4-aecb-5723cb938eaa)
- [Simplify Upload Direct Analysis](b6513236-c6ac-492b-ba2b-e56811a73c8e)
- [Privacy-Safe Research Final Polish](199ee96f-ca71-439f-a20f-2ec2afc490fd)
- [Monitoring Persistence and Telemetry](847810c0-e6e4-4e79-a961-a6545816b9df)
- [Align Rules to Decisions](5a592014-6fed-4912-bbcd-98e82deca923)
- [Create Initial MDC Rules](a390d7f6-3e64-4d86-a026-cbe617ffece5)
- [Fix Project Results Rendering](780280d1-96c2-4557-9ec2-92017b540e86)
- [Refactor Cursor Rules Set](3229f8ea-37e6-4266-a65a-c1b35282ec21)
- [Hadolint Wiki Links in Issues](2915bdbd-8745-467f-90ee-dda453e39737)

## How to use

- When behavior conflicts appear between docs and code, validate against the current backend/frontend implementation, then update this index and linked context docs.
- Keep this list focused on product-defining decisions; move minor tactical history to archive notes.
