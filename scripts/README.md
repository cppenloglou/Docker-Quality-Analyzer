# Lifecycle Scripts

Cross-platform scripts for starting, inspecting, and stopping the Docker Quality Analyzer Compose stack. They encapsulate the split-overlay Compose invocation documented in [README-compose.md](../README-compose.md) and add environment bootstrapping, migration handling, and health gating.

## Inventory

| Script | Linux / macOS | Windows (PowerShell) | Windows (cmd wrapper) |
| --- | --- | --- | --- |
| Start the stack | `start.sh` | `start.ps1` | `start.cmd` |
| Show status and health | `status.sh` | `status.ps1` | `status.cmd` |
| Stop the stack | `stop.sh` | `stop.ps1` | `stop.cmd` |
| Shared helpers (sourced, not invoked directly) | `common.sh` | `common.ps1` | — |

The `.cmd` files are thin wrappers that delegate to the corresponding `.ps1` script via `powershell -NoProfile -ExecutionPolicy Bypass`. The Bash and PowerShell implementations are behaviorally equivalent.

All scripts change to the repository root before operating, so they may be invoked from any working directory.

## Flags

All three operations accept the same mode flags, parsed by the shared helpers:

| Flag | Effect |
| --- | --- |
| `--dev` | Use `compose.yaml` + `compose.dev.yaml` (default when no flag is given; also via `MODE=dev`) |
| `--prod` | Use `compose.yaml` + `compose.prod.yaml` (production-like local mode) |
| `--tools` | Additionally enable the `tools` Compose profile (Adminer) |
| `--wipe` | (`stop` only) Remove named volumes (`down -v --remove-orphans`); in **dev** mode, additionally delete the contents of `backend/storage/uploads` (and legacy `storage/uploads`) on the host disk |

Any mode value other than `dev` or `prod` is rejected. Stopping without `--wipe` performs a plain `down --remove-orphans`, preserving volumes.

## `start` Behavior

`start.sh` / `start.ps1` perform the following sequence:

1. **Tool verification.** Require `docker`, Docker Compose v2 (`docker compose`), `curl`, and `rg` (ripgrep); abort with a clear error if any is missing.
2. **Environment bootstrapping.** Create `.env` from `.env.example` (or a minimal built-in template) if absent.
3. **Secret bootstrapping.** Create `secrets/postgres_password.txt` and `secrets/jwt_secret.txt` if absent — copied from the `.example` files when available, otherwise filled with a generated 48-character random secret.
4. **Ordered build and boot.** Build the `api`, `worker`, and `frontend` images, then bring up only `postgres` and `redis`, and wait for PostgreSQL readiness (`pg_isready`).
5. **Migrations before API boot.** Run `alembic upgrade head` in a one-off `api` container (so the API lifespan's `create_all` cannot race Alembic, a known hazard after `--wipe`). If the run fails with duplicate-schema errors, the script applies a bootstrap fallback: `alembic stamp head` followed by `alembic upgrade head`.
6. **Full stack start.** Bring up the remaining services.
7. **Health gating.** Wait (with timeouts) for the frontend at `http://127.0.0.1:${FRONTEND_PORT:-3000}`; in dev mode additionally check API health inside the Compose network, in prod mode check `/health` through the frontend proxy. The script returns only when the stack is usable and prints the relevant URLs.

## `status` Behavior

`status.sh` / `status.ps1` print:

- `docker compose ps` for the selected mode,
- API health — queried inside the Compose network in dev mode, or via the frontend proxy (`http://127.0.0.1:${FRONTEND_PORT:-3000}/health`) in prod mode,
- frontend reachability.

## `stop` Behavior

`stop.sh` / `stop.ps1` stop the stack for the selected mode. With `--wipe`, all named volumes are removed (database contents and uploaded files are lost) and, in dev mode only, host-side upload directories are cleared as described above.

## Usage Examples

```bash
./scripts/start.sh                 # start in dev mode
./scripts/start.sh --prod          # start in production-like mode
./scripts/start.sh --dev --tools   # dev mode with Adminer
./scripts/status.sh --prod         # status of the prod-like stack
./scripts/stop.sh --dev --wipe     # full reset: volumes + dev upload dirs
```

```powershell
.\scripts\start.ps1
.\scripts\start.ps1 --prod
.\scripts\status.ps1 --prod
.\scripts\stop.ps1 --dev --wipe
```

## Related Documents

- [README-compose.md](../README-compose.md) — Compose layout, secrets, and manual invocations
- [Root README](../README.md) — quick start and troubleshooting
