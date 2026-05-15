# Python Mini Task App

A small but complete Flask web application designed to make Docker testing meaningful.

It includes:

- Browser UI for adding, completing, prioritizing, and deleting tasks
- SQLite persistence, so container data can survive restarts through Docker volumes
- JSON API endpoints for create/list/update/delete tasks
- Stats and health endpoints for automated checks
- Separate Dockerfiles for production, development, unit tests, and smoke tests
- Build-based compose files and an image-only compose file for already-built images
- Pytest tests

## Project structure

```text
.
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── static/style.css
│   └── templates/index.html
├── docker/
│   └── smoke_test.py
├── tests/
│   └── test_app.py
├── Dockerfile                 # production image, Gunicorn, non-root user
├── Dockerfile.dev             # development image, source mount, Flask debug server
├── Dockerfile.test            # runs pytest inside Docker
├── Dockerfile.smoke           # validates a running container through HTTP
├── docker-compose.yml         # build-based dev + test services
├── docker-compose.prod.yml    # build-based production-like run
├── docker-compose.images.yml  # image-only run, no build section
├── Makefile
├── requirements.txt
└── README.md
```

## Run locally without Docker

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.main
```

Open:

```text
http://localhost:5000
```

## Run development compose with build

This uses `Dockerfile.dev`, mounts your local source code, and stores SQLite data in a Docker volume.

```bash
docker compose up --build
```

Open:

```text
http://localhost:5000
```

## Run production-like compose with build

This uses the production `Dockerfile`, Gunicorn, a non-root user, and a Docker healthcheck.

```bash
docker compose -f docker-compose.prod.yml up --build
```

## Run unit tests inside Docker

This uses `Dockerfile.test` and exits with the pytest result.

```bash
docker compose --profile test up --build --abort-on-container-exit --exit-code-from tests tests
```

Or with Make:

```bash
make docker-test
```

## Run smoke test inside Docker

This starts the web service, waits until it is healthy, creates a task through the API, and checks `/api/stats`.

```bash
docker compose --profile test up --build --abort-on-container-exit --exit-code-from smoke smoke
```

Or with Make:

```bash
make docker-smoke
```

## Build images first, then run without build

This is the image-only workflow you asked for. The compose file below does not contain `build:`. It expects images to already exist locally or in a registry.

```bash
docker build -t local/python-mini-task-app:prod -f Dockerfile .
docker build -t local/python-mini-task-app:smoke -f Dockerfile.smoke .
docker compose -f docker-compose.images.yml up
```

To run the image-only smoke test:

```bash
docker compose -f docker-compose.images.yml --profile test up --abort-on-container-exit --exit-code-from smoke smoke
```

## API examples

### Health check

```bash
curl http://localhost:5000/health
```

### Stats

```bash
curl http://localhost:5000/api/stats
```

### List tasks

```bash
curl http://localhost:5000/api/tasks
```

### Create task

```bash
curl -X POST http://localhost:5000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Learn Flask","priority":"high"}'
```

### Update task

```bash
curl -X PATCH http://localhost:5000/api/tasks/1 \
  -H 'Content-Type: application/json' \
  -d '{"done":true,"priority":"low"}'
```

### Delete task

```bash
curl -X DELETE http://localhost:5000/api/tasks/1
```

## Clean Docker volumes and containers

```bash
make clean
```
