# Refactor Backlog (Ranked)

## Scoring model

- **Impact:** 1 (low) to 5 (high)
- **Risk:** 1 (low) to 5 (high)
- **Effort:** 1 (low) to 5 (high)
- **Priority score:** `impact - risk - (effort * 0.5)` (higher first)

## Candidates

| Rank | Candidate | Impact | Risk | Effort | Priority | Why |
|---|---|---:|---:|---:|---:|---|
| 1 | Consolidate frontend runtime-state mapping into shared utility (`frontend/src/pages/Monitoring.tsx`, `ResultsDashboard.tsx`, `ContainerExecution.tsx`, `History.tsx`) | 5 | 2 | 3 | 1.5 | Reduces drift in state labels (`failed`, `stopped_by_user`, `cleanup_completed`) and UI truthfulness bugs. |
| 2 | Split project upload orchestration from router into service-level use case (`backend/app/api/routers/project.py`) | 5 | 3 | 3 | 0.5 | Router currently owns scan + queue + payload defaults; extraction improves testability and policy control. |
| 3 | Centralize deploy status derivation contract (`backend/app/api/routers/compose.py`, `backend/app/workers/tasks.py`) | 4 | 2 | 3 | 0.5 | Keeps runtime-state semantics consistent between API response and worker state writes. |
| 4 | Introduce typed project-flow metadata object in backend schemas (`backend/app/application/schemas.py`, project/compose routers) | 4 | 2 | 4 | 0.0 | Replaces ad-hoc dict metadata usage and lowers merge/regression risk. |
| 5 | Harden TODO/FIXME debt in frontend auth and API keys pages (`frontend/src/pages/Login.tsx`, `Register.tsx`, `ApiKeys.tsx`) | 3 | 1 | 2 | 1.0 | Small cleanup wins that reduce recurring warnings and behavior ambiguity. |
| 6 | Normalize scanner/analysis decision boundaries (`backend/app/application/services/project_scanner.py`, `analysis_service.py`, `workers/tasks.py`) | 4 | 3 | 4 | -1.0 | Clarifies scan-time metadata vs analysis-time decisions for long-term maintainability. |

## Batch plan

### Batch A (low risk, high consistency)

- Candidate 1
- Candidate 5
- Validation: `cd frontend && npm run lint && npm run build`

### Batch B (backend contract cleanup)

- Candidate 2
- Candidate 3
- Validation: `cd backend && pytest -q`

### Batch C (typed metadata and deeper flow cleanup)

- Candidate 4
- Candidate 6
- Validation: `cd backend && pytest -q` plus frontend build if shared API types change

## No-regression requirement

Each batch is only complete when relevant strict gates pass and runtime behavior remains unchanged unless explicitly requested.
