# Docker Compose Runbook

This project now uses a split Compose layout:

- `compose.yaml` (base)
- `compose.dev.yaml` (development overrides)
- `compose.prod.yaml` (production-like local overrides)

Lifecycle scripts (mode-aware) are available:

- `./scripts/start.sh --dev`
- `./scripts/start.sh --prod`
- `./scripts/status.sh --dev|--prod`
- `./scripts/stop.sh --dev|--prod [--wipe]`

## 1) Prepare environment and secrets

```bash
cp .env.example .env
mkdir -p secrets
cp secrets/postgres_password.txt.example secrets/postgres_password.txt
cp secrets/jwt_secret.txt.example secrets/jwt_secret.txt
```

Edit:

- `secrets/postgres_password.txt`
- `secrets/jwt_secret.txt`

## 2) Development start

```bash
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml up --build
```

or

```bash
./scripts/start.sh --dev
```

## 3) Production-like local start

```bash
docker compose --env-file .env -f compose.yaml -f compose.prod.yaml up --build -d
```

or

```bash
./scripts/start.sh --prod
```

## 4) Development with tools profile (Adminer)

```bash
docker compose --env-file .env -f compose.yaml -f compose.dev.yaml --profile tools up --build
```

## 5) Logs

```bash
docker compose logs -f api worker frontend
```

## 6) Reset volumes

```bash
docker compose down -v
```

## Why DinD uses TLS (and still needs privileged mode)

- Worker and DinD communicate over `tcp://docker:2376` (DinD network alias) with TLS (`DOCKER_TLS_VERIFY=1`, `DOCKER_CERT_PATH=/certs/client`), so Docker daemon traffic is encrypted and authenticated.
- DinD is intentionally not exposed to host ports.
- `privileged: true` is still required for Docker-in-Docker daemon operation (nested container runtime and storage driver behavior).

## APP_ENV requirement

The backend only accepts:

- `dev`
- `test`
- `prod`

Do not use `APP_ENV=production`.
