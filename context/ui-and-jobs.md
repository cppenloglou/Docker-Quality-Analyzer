# UI and job lifecycle notes

## 2026-05-14 — History, delete, project progress truthfulness

**History dashboard**

- Fourth stat card is **"Container jobs"**: counts `job.type` **compose** plus **project** (not compose-only).
- Each row has **Delete** (trash): `window.confirm`, `stopPropagation` so the row click still opens results/analysis. On success, list state and `jobListRef` update; `sessionStorage` keys `analysisJobId` / `projectJobId` cleared if they matched the deleted id.

**Delete analysis API**

- `DELETE /api/v1/users/me/jobs/{job_id}` → **204** when allowed.
- **404** if job missing or not owned.
- **409** if status is **queued** or **running** (avoid races with the worker).
- **409** for **compose** / **project** when deploy is **active** (same semantics as `compute_deploy_status` in [`backend/app/api/routers/compose.py`](backend/app/api/routers/compose.py)) — user must stop containers first.
- After successful DB delete: Redis keys `deploy:{user_id}:{job_id}` and `deploy-stop:{user_id}:{job_id}` are deleted (no ghost deploy UI).
- Client: [`frontend/src/utils/api.ts`](frontend/src/utils/api.ts) `jobs.delete(jobId)`.

**Project upload / `run_after_analysis`**

- Checkbox copy reflects **manual** Compose from the results page, not auto-deploy. `run_after_analysis` stays in `job.input_metadata` only; worker enqueue payload does **not** pass it (no auto-run). Comment in [`backend/app/api/routers/project.py`](backend/app/api/routers/project.py) documents this.

**Analysis progress (project jobs)**

- Core steps only by default; **Building Images** and **Running Stack** rows are **inserted when** matching domain events arrive (`project.image_build_*`, `container.started` / `container.exited` / `project.runtime_stopped`). Reconcile uses core steps only (no event replay from `GET .../jobs/{id}/events`).
