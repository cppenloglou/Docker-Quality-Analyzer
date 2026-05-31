# compose-exits-after-start

Purpose: reproduce the lifecycle where containers start successfully and then exit with runtime errors.

## Behavior

- Both services start and stay up briefly.
- `app` exits with code `1` after ~15s.
- `worker` exits with code `1` after ~22s.
- This is useful to test UI/backend handling of:
  - `container.started` followed by `container.exited`
  - final runtime stop after all containers have exited
  - distinction between user-stop and natural/self-exit

## Files

- `docker-compose.yml` - runnable compose stack with deterministic delayed failures.

## Local dry run (optional)

```bash
docker compose up
```

Expected output includes startup logs, then simulated fatal messages before both containers exit.
