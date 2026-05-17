# docker-platform-api backend

Production-grade FastAPI backend using a modular-monolith + hexagonal structure:

- `api/` transport layer and websocket endpoints
- `application/` use-case orchestration
- `domain/` event contracts
- `infrastructure/` PostgreSQL, Redis, Docker SDK, and process adapters
- `workers/` async background jobs via `arq`
- `plugins/` dynamically loaded analyzers

## Features

- Multi-user auth (`/auth/register`, `/auth/login`) with JWT + API key support
- User-scoped jobs/history for Dockerfile, Compose, and project archive workflows
- Redis event bus with job/container event streams
- Plugin-based analyzers: hadolint, compose validator, compose runnability, security scanner, resource estimation
- Prometheus endpoint (`/metrics`) + JSON structured logging

## Run locally

```bash
cp .env.example .env
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Run workers

```bash
arq app.workers.worker.WorkerSettings
```

## Run tests

```bash
pytest -q
```
