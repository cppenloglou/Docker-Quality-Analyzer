# docker-platform-api

Multi-tenant Docker analysis platform with:

- FastAPI backend (`backend/`) using modular-monolith + hexagonal structure
- React frontend (`frontend/`) with authenticated user flows and live job history
- Redis event bus + arq workers for async analysis/deploy pipelines
- PostgreSQL persistence for users, jobs, projects, containers, images, API keys

## Local development

```bash
docker compose up --build
```

Services:

- API: `http://localhost:8000`
- Frontend (dev mode): `cd frontend && npm install && npm run dev`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`