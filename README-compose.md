# Docker Compose Deployment Runbook

This document specifies how the Docker Quality Analyzer stack is composed, configured, and operated with Docker Compose. For a general project overview see the root [README.md](README.md); for automated lifecycle management see [scripts/README.md](scripts/README.md).

## 1. Compose Layout

The deployment is split across a base definition and two mutually exclusive overlays:

| File | Role |
| --- | --- |
| `compose.yaml` | Base definition of all six services (frontend, api, worker, dind, redis, postgres) |
| `compose.dev.yaml` | Development overrides (permissive settings, local conveniences) |
| `compose.prod.yaml` | Production-like local overrides (restricted settings) |

The split-overlay model keeps the service topology defined exactly once in the base file, while environment-specific differences (ports, environment variables, restart policies) are isolated in the overlays. A given invocation always combines the base file with exactly one overlay.

### Service Topology and Dependency Chain

Startup ordering is gated by health checks:

- `frontend → api → redis, postgres`
- `worker → dind, redis, postgres`

The `api` and `worker` services are built from the same backend image; only the container command differs (uvicorn HTTP server versus `arq` worker). Both mount the shared `uploads_data` volume so the worker can access files uploaded through the API.

## 2. Environment and Secrets Preparation

One-time setup:

```bash
cp .env.example .env
mkdir -p secrets
cp secrets/postgres_password.txt.example secrets/postgres_password.txt
cp secrets/jwt_secret.txt.example secrets/jwt_secret.txt
```

Then edit the following files and replace the example values with strong, unique secrets:

- `secrets/postgres_password.txt` — PostgreSQL password, injected as a Compose secret
- `secrets/jwt_secret.txt` — JWT signing key; must be long and random in any non-development deployment

Note that the lifecycle scripts (`scripts/start.*`) perform this preparation automatically, generating random secrets when the files are absent.

## 3. Lifecycle Scripts (Mode-Aware)

All scripts accept `--dev` (default) or `--prod` to select the overlay, and are provided in Bash, PowerShell, and `cmd` wrapper variants:

| Operation | Linux / macOS | Windows |
| --- | --- | --- |
| Start | `./scripts/start.sh --dev\|--prod` | `.\scripts\start.ps1 --dev\|--prod` |
| Status | `./scripts/status.sh --dev\|--prod` | `.\scripts\status.ps1 --dev\|--prod` |
| Stop | `./scripts/stop.sh --dev\|--prod [--wipe]` | `.\scripts\stop.ps1 --dev\|--prod [--wipe]` |

`--wipe` removes all named volumes; in **dev** mode it additionally clears `backend/storage/uploads` on the host disk. See [scripts/README.md](scripts/README.md) for the complete behavioral specification.

## 4. Manual Invocations

### Development start

```bash
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml up --build
```

Equivalent script form: `./scripts/start.sh --dev`

### Production-like local start

```bash
docker compose --env-file .env -f compose.yaml -f compose.prod.yaml up --build -d
```

Equivalent script form: `./scripts/start.sh --prod`

### Development with the tools profile (Adminer)

The optional `tools` profile adds [Adminer](https://www.adminer.org/) for database inspection (default host port `8080`, configurable via `ADMINER_PORT`):

```bash
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml --profile tools up --build
```

### Database migrations

```bash
docker compose exec api alembic upgrade head
```

The start scripts run migrations automatically before the API boots, including a bootstrap fallback (`alembic stamp head` followed by `upgrade head`) when a schema already exists without Alembic state.

### Logs

```bash
docker compose logs -f api worker frontend
```

### Reset volumes

```bash
docker compose down -v
```

This removes all named volumes, including the PostgreSQL data directory and the shared uploads volume. The next start therefore begins from an empty database.

## 5. Docker-in-Docker Isolation Model

The platform executes user-submitted builds and Compose deployments inside a dedicated DinD sidecar daemon rather than against the host Docker daemon. The design properties are:

- **TLS-authenticated transport.** The worker communicates with DinD over `tcp://docker:2376` (the DinD network alias) with TLS enabled (`DOCKER_TLS_VERIFY=1`, `DOCKER_CERT_PATH=/certs/client`). Daemon traffic is therefore both encrypted and mutually authenticated.
- **No host exposure.** The DinD daemon is intentionally not published on any host port, and the host Docker socket is never mounted into any service. User workloads cannot reach the host daemon.
- **Privileged mode is confined to DinD.** `privileged: true` remains required for the DinD service itself, because a nested Docker daemon needs unrestricted access to kernel facilities (nested container runtime and storage driver behavior). This privilege is confined to the isolated sidecar; no user workload runs privileged on the host daemon.

## 6. `APP_ENV` Requirement

The backend accepts exactly three values for `APP_ENV`:

- `dev` — permissive CORS (`allow_origins=["*"]`), development conveniences
- `test` — test configuration
- `prod` — restricted CORS, production behavior

Any other value (for example `production`) is rejected at startup. Do not use `APP_ENV=production`.

## Related Documents

- [README.md](README.md) — project overview and architecture
- [scripts/README.md](scripts/README.md) — lifecycle script reference
- [backend/README.md](backend/README.md) — backend configuration details
