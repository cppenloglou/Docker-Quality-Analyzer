# UI and job lifecycle notes

Last updated: 2026-06-03

This file tracks product-truth behavior for UI, job lifecycle, and deploy/runtime handling.

## 2026-05-14 — History, delete, project progress truthfulness

**History dashboard**

- Fourth stat card is **"Container jobs"**: counts `job.type` **compose** plus **project** (not compose-only).
- Each row has **Delete** (trash): `window.confirm`, `stopPropagation` so the row click still opens results/analysis. On success, list state and `jobListRef` update; client session cleanup via [`frontend/src/utils/jobSessionCleanup.ts`](frontend/src/utils/jobSessionCleanup.ts) (`analysisJobId`, `projectJobId`, monitoring/execution state, deploy-stop flags, notification replay entry for that job).

**Delete analysis API**

- `DELETE /api/v1/users/me/jobs/{job_id}` → **204** when allowed.
- **404** if job missing or not owned.
- **409** if status is **queued** or **running** (avoid races with the worker).
- **409** for **compose** / **project** when deploy is **active** (same semantics as `compute_deploy_status` in [`backend/app/api/routers/compose.py`](backend/app/api/routers/compose.py)) — user must stop containers first.
- Before DB delete: [`cleanup_job_artifacts`](backend/app/application/services/job_cleanup.py) removes project extract dir (`input_metadata.project_path` under `upload_dir/{user_id}`), compose deployment dir (`upload_dir/deployments/{user_id}/{job_id}`), and enqueues worker `teardown_job_runtime` (leftover compose stack from Redis deploy state + analysis/runtime image refs; best-effort; failures do not block delete).
- After successful DB delete: Redis keys `deploy:{user_id}:{job_id}` and `deploy-stop:{user_id}:{job_id}` are deleted (no ghost deploy UI).
- Client: [`frontend/src/utils/api.ts`](frontend/src/utils/api.ts) `jobs.delete(jobId)`.

**Project upload behavior**

- Upload flow currently queues project analysis for all detected Docker/Compose assets and sets image builds enabled in enqueue payload.
- Compose runtime remains manual from results/deploy actions (`run_stack`), not auto-run on upload completion.

**Runtime stack teardown (DinD)**

| Trigger | Containers | Images |
|---------|------------|--------|
| User **Stop** | `compose down --remove-orphans` (no `--rmi`) | Kept (redeploy friendly) |
| Stack **unhealthy** (worker metrics) | Torn down automatically | Removed (`--rmi all` + best-effort `docker rmi` on deploy-state refs) |
| Stack **self-exit** (all containers exited) | Torn down automatically | Removed (same as unhealthy) |
| **History delete** (deploy inactive) | Best-effort via `teardown_job_runtime` if Redis deploy spec exists | Build tags + container images from deploy state |

Worker helper: [`_teardown_deploy_stack`](backend/app/workers/tasks.py). Terminal deploy states `exited` and `unhealthy` are **inactive** in `compute_deploy_status` (not “Live”).

**Job state truthfulness**

- Workflow should preserve explicit scan-to-analysis state transitions where available (including `scanned` semantics in state-machine-aware flows).
- UI status labels should never imply execution when runtime is terminal (`exited`, `unhealthy`, `failed`, `stopped_by_user`, `cleanup_completed`).

**Analysis progress (project jobs)**

- Core steps only by default; **Building Images** and **Running Stack** rows are **inserted when** matching domain events arrive (`project.image_build_*`, `container.started` / `container.exited` / `project.runtime_stopped`). Reconcile uses core steps only (no event replay from `GET .../jobs/{id}/events`).

**Research analytics privacy boundary**

- Research data can be available to authenticated users while remaining privacy-safe via anonymized submitter and sanitized public metadata/results.
- Never surface raw source previews, account identifiers, secrets, internal host hints, or other fingerprinting material in research views.
