# compose-exits-after-start

A minimal Compose stack engineered to reproduce, deterministically, the container lifecycle in which services start successfully and subsequently terminate with runtime errors. It exists to validate that the platform's backend and UI handle post-start failures honestly, as distinct from both startup failures and user-initiated stops.

This directory holds the unzipped reference sources; the corresponding upload artifact is `examples/projects/compose-exits-after-start.zip` (see [examples/README.md](../../README.md) for the upload procedure).

## Behavior

The stack defines two `busybox:1.36.1` services whose commands sleep for a fixed interval and then exit with a non-zero status:

| Service | Startup | Termination |
| --- | --- | --- |
| `app` | Logs `[app] started` immediately | Exits with code `1` after approximately 15 seconds, logging a simulated fatal error to stderr |
| `worker` | Logs `[worker] started` immediately | Exits with code `1` after approximately 22 seconds, logging a simulated fatal error to stderr |

Both images are pinned and the manifest contains no build contexts, bind mounts, `env_file` references, or privileged options, so the runnability precheck passes and deployment proceeds normally before the failures occur.

## Validated Platform Behavior

This artifact exercises the following lifecycle handling:

- The event sequence `container.started` followed by `container.exited` for each service, with staggered exit times.
- The final runtime stop after **all** containers have exited (terminal stack state), as opposed to a partially running stack.
- The distinction between a **user-initiated stop** (`stopped_by_user`) and a **natural self-exit** (`exited`/`failed`) — the UI must not conflate the two.
- Retry/redeploy UX after a stack has terminated on its own.

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Runnable Compose stack with deterministic delayed failures |
| `README.md` | This document |

## Local Dry Run (Optional)

The stack can be executed directly against any local Docker daemon, outside the platform:

```bash
docker compose up
```

Expected output: both startup log lines, followed (after roughly 15 and 22 seconds respectively) by the simulated fatal messages on stderr, after which both containers exit with code `1` and `docker compose` returns.

## Maintenance

If the sources in this directory change, regenerate the tracked archive so uploads stay in sync:

```bash
cd examples/projects/compose-exits-after-start
zip -qr ../compose-exits-after-start.zip .
```
