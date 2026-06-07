# Docker Quality Analyzer

A multi-tenant platform for analyzing, scoring, and deploying Docker artifacts. Upload your `Dockerfile`, `docker-compose.yml`, or full project archives to get instant feedback on best practices, security issues, and deployment readiness.

## 🌟 Core Features

- **Dockerfile Analysis**: Deep inspection using Hadolint and custom rules to detect security flaws, bad practices, and generate a quality score.
- **Compose Runnability**: Pre-flight checks for `docker-compose.yml` files to ensure they are safe and ready to deploy (detects bind mounts, privileged mode, host networking, etc.).
- **Project Archives**: Upload full `.zip` projects. The platform automatically detects Dockerfiles and Compose stacks, analyzes them, and prepares them for deployment.
- **Live Container Execution**: Deploy runnable Compose stacks directly from the UI to the underlying Docker daemon.
- **Real-time Monitoring**: Stream live container logs and view real-time CPU/Memory usage charts via WebSockets.
- **Analysis History**: Keep track of all your past analyses and deployments.

## 🏗️ Tech Stack & Architecture

- **Backend**: FastAPI (`backend/`) using modular-monolith + hexagonal architecture.
- **Frontend**: React SPA (`frontend/`) with Tailwind CSS, Recharts for monitoring, and real-time WebSocket integration.
- **Workers**: Redis event bus + arq workers for asynchronous analysis and deployment pipelines.
- **Database**: PostgreSQL for persistence (users, jobs, projects, containers, images).
- **Proxy**: Nginx for serving the frontend and proxying API/WebSocket traffic.
- **Docker-in-Docker (DinD)**: We utilize a `dind` service to securely isolate the building and execution of user-submitted Dockerfiles and Compose stacks from the host system. The worker service communicates with this isolated daemon via TCP.

## 🔄 Workflows

### 1. Dockerfile Analysis
1. User uploads a `Dockerfile` via the UI or API.
2. The API creates an analysis job and queues it via Redis.
3. The arq worker picks up the job and runs Hadolint and custom security/best-practice checks.
4. Real-time events (`user.analysis.started`, `user.analysis.completed`) are streamed back to the client via WebSockets.
5. The UI displays the final score, resource estimates, and detailed issue reports.

### 2. Compose Analysis & Deployment
1. User uploads a `docker-compose.yml`.
2. The system analyzes it for "runnability" (checking for blocked features like bind mounts or privileged mode).
3. If deemed runnable, the user can click **Deploy now**.
4. The worker connects to the DinD daemon, pulls/builds the required images, and starts the containers.
5. Live deployment events (`docker.image.pushed`, `container.started`) are streamed to the UI.
6. Once running, users can view live CPU/Memory metrics and container logs.

### 3. Project Archive Analysis
1. User uploads a `.zip` containing a full project.
2. The backend extracts the archive and detects `Dockerfile` and Compose assets.
3. The upload flow queues analysis for all detected artifacts and currently enables image builds by default.
4. Compose runtime deploy remains explicit: users trigger run/deploy from project results controls.

## 🚀 Quick Start (Docker Compose)

Run the entire platform with one command:

```bash
./scripts/start.sh
```

```powershell
.\scripts\start.ps1
```

### Services started:

| Service  | Purpose                                 | Exposed port |
| -------- | --------------------------------------- | ------------ |
| frontend | React SPA served by nginx + API proxy   | `3000`       |
| api      | FastAPI HTTP + WebSocket API            | `8000`       |
| worker   | arq worker for analysis and deploy jobs | n/a          |
| dind     | Isolated Docker daemon for user workloads| n/a          |
| redis    | Event bus + task queue                  | `6379`       |
| postgres | Primary database                        | `5432`       |

Open the app at `http://localhost:3000`. The frontend container proxies `/api`, `/auth`, `/health`, `/metrics`, `/docs`, `/redoc`, `/openapi.json` and `/ws/*` (with WebSocket upgrade) to the `api` service, so browser clients only need to talk to port 3000.

### What `start.sh` / `start.ps1` do automatically

- verifies required tools (`docker`, `docker compose`, `curl`, `rg`)
- creates `.env` on first run with generated secrets (`POSTGRES_PASSWORD`, `JWT_SECRET_KEY`)
- builds and starts all services (`docker compose up -d --build`)
- runs migrations with safe bootstrap fallback when schema exists but Alembic state is missing
- waits until API and frontend are healthy before returning

### Optional one-time `.env` customization

If you want fixed credentials/secrets instead of auto-generated values, create/edit root `.env`:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=choose-a-strong-password
JWT_SECRET_KEY=choose-a-long-random-secret
```

### Handy commands

```bash
./scripts/status.sh                              # compose + health summary
docker compose logs -f frontend api worker       # tail live logs
./scripts/stop.sh                                # stop stack
./scripts/stop.sh --wipe                         # stop + wipe volumes (+ dev upload dir on disk)
```

```powershell
.\scripts\status.ps1                             # compose + health summary
docker compose logs -f frontend api worker       # tail live logs
.\scripts\stop.ps1                               # stop stack
.\scripts\stop.ps1 --wipe                        # stop + wipe volumes (+ dev upload dir on disk)
```

### Troubleshooting

- If Docker daemon is not running, start Docker Desktop / Docker Engine first.
- If startup fails after a major change, run `./scripts/stop.sh --wipe` (or `.\scripts\stop.ps1 --wipe` on Windows) and then restart.
- If ports are already in use, stop conflicting services or adjust host port bindings in `compose.yaml` plus overlay files.

## 🎮 Examples & Demo

We provide drop-in test artifacts to help you explore the platform's capabilities. Check out the [`examples/README.md`](examples/README.md) for a full walkthrough of:
- Analyzing clean vs. problematic Dockerfiles
- Testing runnable vs. blocked Compose files
- Uploading full project archives
- Using the programmatic API

## 💻 Local Development (Without Docker)

```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. uvicorn app.main:app --reload --port 8000

# Frontend (in another terminal)
cd frontend && npm install && npm run dev
```

During dev the Vite server listens on `http://localhost:5173`; since `VITE_API_BASE_URL` is unset it defaults to `http://localhost:8000` and the backend's permissive CORS policy allows it.

## 🔌 Ports Reference

- `http://localhost:3000` - App UI (production-style, via nginx)
- `http://localhost:3000/docs` - Swagger UI (proxied to api)
- `http://localhost:3000/metrics` - Prometheus metrics (proxied to api)
- `http://localhost:8000` - Direct backend (useful for curl, CI, debugging)

## 🧭 Beginner Onboarding Map

If you are new to this codebase, follow this order:

1. **Run the stack first** with `./scripts/start.sh` (or `.\scripts\start.ps1` on Windows) so you can see the full upload → analysis → results flow end-to-end.
2. **Read the backend entrypoint** (`backend/app/main.py`) and API router composition (`backend/app/api/router.py`) to understand how routes are wired.
3. **Study the analysis pipeline** in `backend/app/application/services/analysis_service.py` and worker task orchestration in `backend/app/workers/tasks.py`.
4. **Review plugin-based checks** under `backend/app/plugins/` (Hadolint, compose runnability, security checks, resource estimation).
5. **Move to the frontend shell** starting at `frontend/src/main.tsx`, routes in `frontend/src/routes.tsx`, and key pages under `frontend/src/pages/`.
6. **Inspect real-time features**: backend WebSocket router (`backend/app/api/routers/ws.py`) and frontend monitoring/notification components.

### What to learn next

- **FastAPI fundamentals** (dependency injection, routers, pydantic schemas).
- **Async Python patterns** (`async/await`, background workers, queue-based processing).
- **Docker & Compose internals** (images, build context, runtime security constraints).
- **React + TypeScript app structure** (routing, component composition, API client patterns).
- **Observability basics** (logs, metrics, event-driven UX).

This sequence helps you build a mental model before diving into implementation details.
