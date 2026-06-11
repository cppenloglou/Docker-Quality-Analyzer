# Docker Quality Analyzer — Backend

Production-grade FastAPI backend for the Docker Quality Analyzer platform. It implements the analysis, scoring, and deployment pipeline as a modular monolith with a hexagonal (ports-and-adapters) internal structure, and runs in two roles from a single image: the HTTP/WebSocket API server and the asynchronous `arq` worker.

For the system-level architecture and the six-service Compose topology, see the root [README.md](../README.md) and [README-compose.md](../README-compose.md).

## 1. Architectural Layering

| Layer | Path | Responsibility |
| --- | --- | --- |
| API | `app/api/` | FastAPI routers and WebSocket endpoints (transport layer) |
| Application | `app/application/` | Use-case services and Pydantic schemas (orchestration) |
| Domain | `app/domain/` | `DomainEvent` dataclass (intentionally thin domain layer) |
| Infrastructure | `app/infrastructure/` | PostgreSQL (SQLAlchemy async), Docker gateway, Redis event bus, subprocess tooling |
| Workers | `app/workers/` | Asynchronous background jobs via `arq` (queue, tasks, worker settings) |
| Plugins | `app/plugins/` | Dynamically loaded analyzers |
| Core | `app/core/` | Configuration (`pydantic-settings`), structured logging, security primitives |

### Boundary rule: API ↔ Database

Routers may import lightweight ORM types and enums for authentication checks and comparisons, but **all persistent reads and writes go through repositories and services** (`app/infrastructure/db/repositories.py`, `app/application/services/`). Routers must not execute raw SQLAlchemy queries.

## 2. API Surface

Router composition is defined in `app/api/router.py`:

| Router | Module | Purpose |
| --- | --- | --- |
| Auth | `app/api/routers/auth.py` | `/auth/register`, `/auth/login`; JWT Bearer tokens |
| Dockerfile | `app/api/routers/dockerfile.py` | Dockerfile upload and analysis jobs |
| Compose | `app/api/routers/compose.py` | Compose upload, analysis, and explicit deploy (`run_stack`) |
| Project | `app/api/routers/project.py` | Project ZIP upload, safe archive scan, merged project analysis |
| History | `app/api/routers/history.py` | User-scoped job history and results retrieval |
| Research | `app/api/routers/research.py` | Aggregated, anonymized research analytics |
| Preview proxy | `app/api/routers/preview_proxy.py` | Proxy access to running stack previews |
| WebSocket | `app/api/routers/ws.py` | Real-time event and metrics streaming |

Additional operational endpoints: `/health` (liveness) and `/metrics` (Prometheus). Logging is JSON-structured.

## 3. Asynchronous Job Pipeline

1. A router receives an upload, persists a job record in PostgreSQL, and enqueues an `arq` task via Redis (`app/workers/queue.py`).
2. The worker (`app/workers/tasks.py`) executes `AnalysisService.run_job_with_plugins()` (`app/application/services/analysis_service.py`), selecting plugins by job type.
3. The worker publishes `DomainEvent`s to Redis publish/subscribe channels (`app/infrastructure/events/bus.py`).
4. WebSocket endpoints subscribe to the relevant channels and stream events to the browser.

### Redis channel naming

| Channel pattern | Content |
| --- | --- |
| `user:{user_id}:events` | All events for a user |
| `job:{job_id}:events` | Events scoped to a specific job |
| `container:{container_id}:metrics` | Container CPU/memory metrics |
| `user:{user_id}:container:{container_id}:metrics` | User-scoped container metrics |

## 4. Plugin Architecture

Plugins live in `app/plugins/`. Each plugin extends `BasePlugin` (`app/plugins/base.py`) and implements a single method, `async run(context) -> dict`. The `PLUGIN_MAP` in `app/plugins/registry.py` maps plugin names to classes; `load_plugins()` instantiates the requested subset. Worker tasks select plugins by job type:

| Job type | Plugins |
| --- | --- |
| Dockerfile | `hadolint`, `security_scanner`, `resource_estimation` |
| Compose | `compose_validator`, `compose_runnability`, `security_scanner`, `resource_estimation` |
| Project archive | dynamic subset based on the files detected during the archive scan |

The `compose_runnability` plugin implements the pre-flight deployment gate: it evaluates rules such as `no_build_contexts`, `no_bind_mounts`, `no_env_file`, `no_unresolved_env`, `no_external_resources`, `explicit_non_latest_images`, and `no_dangerous_runtime_flags`, and reports the per-rule outcome together with human-readable blocking reasons in the result metadata.

## 5. Project Analysis Workflow

ZIP upload → safe archive scan (`app/application/services/project_scanner.py`) → automatic queueing of analysis for all detected Dockerfiles and Compose files → per-file plugin runs → merged `ProjectAnalysisResult` containing `per_file_results`, `project_summary`, `service_mappings`, and optionally `image_build_results`.

Current behavior: the upload flow defaults `build_selected_images=true` (the worker still gates build execution on this flag), while Compose run/deploy remains an explicit user action through the deploy controls (`run_stack=true`).

## 6. Docker-in-Docker Execution

The worker reaches an isolated DinD sidecar over TLS (`DOCKER_HOST=tcp://docker:2376`, `DOCKER_TLS_VERIFY=1`, `DOCKER_CERT_PATH=/certs/client`); the Docker gateway lives in `app/infrastructure/docker/client.py` and all `docker compose` subprocess invocations execute inside the worker container. The host Docker socket is never used. The runtime layer reports final container states explicitly: `running`, `partial`, `unhealthy`, `exited`, `failed`, `stopped_by_user`, `cleanup_completed`.

## 7. Database and Migrations

- **ORM:** SQLAlchemy with the async engine (`asyncpg`); models in `app/infrastructure/db/models.py`, session management in `session.py`, repositories in `repositories.py`.
- **Migrations:** Alembic, under `alembic/`. Apply with:

```bash
docker compose exec api alembic upgrade head
```

The start scripts run migrations automatically before the API boots, with a bootstrap fallback (`stamp head` then `upgrade head`) when the schema exists without Alembic state.

## 8. Configuration

Settings are loaded by `pydantic-settings` (`app/core/config.py`) from environment variables and secret files. `APP_ENV` accepts only `dev`, `test`, or `prod`; `dev` enables permissive CORS while `prod` restricts it. `JWT_SECRET_KEY` is loaded from a Compose secret in containerized deployments and must be strong in production. See [README-compose.md](../README-compose.md) for the full deployment-level configuration reference.

## 9. Research Privacy Guarantees

Research endpoints expose **aggregated and anonymized** data only. Public payloads are limited to fields such as `anonymized_submitter`, `public_metadata`, and `public_result`; no raw user identifiers, emails, or private job contents are ever exposed. The dedicated test module `tests/test_research_privacy.py` asserts that research responses leak no forbidden fields.

## 10. Running Locally

### API server

```bash
cp .env.example .env
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Worker

```bash
arq app.workers.worker.WorkerSettings
```

The worker requires reachable Redis and PostgreSQL instances and, for build/deploy functionality, a Docker daemon endpoint as configured by the `DOCKER_HOST` family of variables.

## 11. Testing

All tests reside flat under `tests/` and use mocked sessions and repositories — no real database is required.

```bash
pytest -q                                      # full suite
pytest tests/test_plugins.py -v -k "test_name" # single test
```

Key fixtures from `tests/conftest.py`:

| Fixture | Purpose |
| --- | --- |
| `app` | FastAPI instance with a no-op lifespan (skips DB table creation) |
| `client` | `TestClient(app)` |
| `fake_session` | `AsyncMock` standing in for `AsyncSession` |
| `auth_header_for(user_id)` | Valid JWT Bearer header factory |
| `make_user()` | `UserModel` factory without database access |

Conventions: prefer `monkeypatch.setattr(...)` with inline fake classes over complex `unittest.mock` setups, and always clear `app.dependency_overrides` after a test. Coverage expectations per area: `test_project_scan.py` (archive scanning), `test_project_build.py` (image builds and failure isolation), `test_container_lifecycle.py` (start/stop, exit, unhealthy states), `test_research_privacy.py` (privacy invariants).

## Related Documents

- [Root README](../README.md) — system overview and architecture diagram
- [README-compose.md](../README-compose.md) — deployment runbook and DinD isolation model
- [frontend/README.md](../frontend/README.md) — frontend counterpart
