# Examples — Demonstration and Test Artifacts

This directory contains drop-in artifacts that exercise the three principal workflows of the platform: Dockerfile analysis, Compose analysis with optional deployment, and project archive analysis. Each artifact is annotated (in a leading comment, where the format permits) with its expected analysis outcome, making the set suitable both for manual demonstration and for regression checking of analyzer behavior.

## Prerequisites

Start the stack and open the application:

```bash
./scripts/start.sh          # or: docker compose --env-file .env -f compose.yaml -f compose.dev.yaml up --build
```

Open `http://localhost:3000`, register an account, and use the artifacts described below. See the root [README.md](../README.md) for full installation details.

## Directory Layout

```
examples/
|-- dockerfiles/    # single-file Dockerfile analysis inputs
|-- compose/        # single-file Compose analysis inputs
`-- projects/       # complete project archives (.zip) + one unzipped reference project
```

## Artifact Inventory

### Dockerfiles (`dockerfiles/`)

| Artifact | Character | Expected outcome |
| --- | --- | --- |
| `clean.Dockerfile` | Pinned base image, non-root user, minimal layers | High score (grade A/B), few or no issues |
| `multistage-golang.Dockerfile` | Go microservice, multi-stage build | High score, clean practices |
| `rust-microservice.Dockerfile` | Rust multi-stage build with distroless runtime | Very high score, minimal warnings |
| `dotnet-api.Dockerfile` | .NET 8 Web API, multi-stage build | High score |
| `php-laravel.Dockerfile` | PHP-FPM Laravel production setup | Good score |
| `production-rails.Dockerfile` | Production Ruby on Rails | Good score, minor warnings |
| `python-api.Dockerfile` | Python API with mixed practices | Moderate score, best-practice hints (multi-stage, cache busting) |
| `large-java-spring.Dockerfile` | Large Java Spring Boot application | Medium score, complexity warnings |
| `ml-pipeline.Dockerfile` | CUDA-based ML training image | Medium score, image-size and layer warnings |
| `monolith-legacy.Dockerfile` | Legacy monolith, many layers, no multi-stage | Low-to-medium score, many warnings |
| `issues.Dockerfile` | `:latest` tag, runs as root, hard-coded secret | Low grade (D/F); Hadolint findings (e.g. `DL3007`, `DL3008`) plus security findings |
| `bad-practices-large.Dockerfile` | Deliberately accumulated anti-patterns | Very low score; many errors, warnings, and security issues |

### Compose Manifests (`compose/`)

| Artifact | Character | Expected outcome |
| --- | --- | --- |
| `minimal-valid.yml` | Single pinned-image service | Runnability passes; minimal resource estimate |
| `docker-compose-runnable.yml` | Multi-service stack; pinned non-latest images, no build contexts, bind mounts, `env_file`, external resources, or privileged flags | Runnability passes; deployment permitted |
| `data-pipeline.yml` | Data engineering stack | Runnability passes |
| `full-stack-ecommerce.yml` | Many-service e-commerce stack, fully pinned | Runnability passes |
| `monitoring-stack.yml` | Observability stack | Runnability passes |
| `microservices-platform.yml` | Larger microservices platform definition | Exercises analysis of a realistic multi-service topology |
| `blocked.yml` | Build context, `:latest` tag, bind mount, `env_file`, unresolved `${VAR}`, `privileged`, host network, external volume | Runnability **blocked** with itemized reasons |
| `blocked-many-issues.yml` | Numerous simultaneous runnability blockers | Runnability **blocked** with many reasons |
| `invalid-yaml.yml` | Intentionally malformed YAML | Analysis fails with a parse error (failure-path validation) |

### Project Archives (`projects/`)

| Artifact | Contents | Expected outcome |
| --- | --- | --- |
| `node-hello-dockerfile.zip` | Node.js application with a single Dockerfile | Scan detects the Dockerfile; Hadolint results are produced; the Results page lists the detected files |
| `compose-stack.zip` | Node.js application with Dockerfile and a runnable Compose stack | Both artifacts detected; runnability passes; **Run Containers** enabled |
| `compose-exits-after-start.zip` | Compose stack whose containers exit deterministically after startup | Deploy starts successfully; containers exit with code `1` after a short delay — validates `started → exited` runtime handling and retry UX (see below) |
| `python-webapp.zip` | Python web application with a Compose file using a build context and a bind mount | Compose flagged as not runnable; project jobs are not hard-blocked from deploy, but the blocking reasons are rendered clearly |
| `python-mini-task-app-docker-dind-fixed.zip` | Python task application (Dockerfile + Compose) | Realistic multi-asset project scan and analysis |
| `course-web-docker-main.zip` | Java/Maven course project exported from GitHub | Realistic repository-shaped archive (nested top-level directory, CI configuration) |
| `compose-exits-after-start/` | Unzipped sources of the corresponding archive | Reference and local dry-run — see [its README](projects/compose-exits-after-start/README.md) |

## Procedures

### A. Dockerfile Analysis

1. On the Landing page, drag and drop a file from `examples/dockerfiles/`.
2. Click **Start Analysis**.
3. On the `/analysis` page, observe the live job event stream: `user.analysis.started` → `user.analysis.completed`.
4. The Results page renders the findings, the resource estimate metadata, and the final score and grade.

### B. Compose Analysis and Deployment

1. From the Landing page, upload a file from `examples/compose/`.
2. Click **Start Analysis** and wait for job completion.
3. On the Results page, inspect the **Deploy Runnability** card.

Expected behavior by artifact class:

- **Runnable manifests** (for example `docker-compose-runnable.yml`): the verdict is **Runnable** and **Run Containers** is enabled. Activating it navigates to `/execution`; **Deploy now** issues `POST /api/v1/compose/deploy`, after which the live timeline records `docker.image.pushed`, `container.started`, and `container.metrics` events. Once a container identifier appears, **Watch metrics** opens the real-time CPU/memory charts.
- **Blocked manifests** (for example `blocked.yml`): the verdict is **Blocked** and the Results page itemizes the reasons (build context, `:latest` tag, bind mount, `env_file`, unresolved `${VAR}`, `privileged`, `network_mode: host`, external network/volume). **Run Containers** is disabled for standalone Compose jobs.
- **Malformed manifests** (`invalid-yaml.yml`): the analysis terminates with a parse error, exercising the failure path.

### C. Project Archive Analysis

1. Select **Upload Project Archive** from the Landing page.
2. Choose one of the `examples/projects/*.zip` archives.
3. The browser is forwarded to `/analysis?jobId=...`, which attaches to the queued project job over WebSocket.
4. The Results page lists the detected files and the per-file analysis outcomes; for runnable Compose stacks, deployment remains an explicit action from the results controls.

### D. WebSocket Event Stream (Programmatic Access)

While a job is running, its event feed is available at:

```
ws://localhost:3000/ws/jobs/<job_id>?token=<access_token>
```

through the Nginx proxy. The UI subscribes automatically; this endpoint is documented here for scripted clients (the Phase B evaluation runner in [README-evaluation.md](../README-evaluation.md) uses the polling-based HTTP equivalent).

## Maintenance Notes

- The `.zip` archives are tracked in version control so demonstrations remain reproducible.
- `compose-exits-after-start/` is the only archive whose unzipped sources are tracked alongside the zip; if its sources change, regenerate the archive with:

```bash
cd examples/projects/compose-exits-after-start
zip -qr ../compose-exits-after-start.zip .
```

## Related Documents

- [Root README](../README.md) — platform overview and workflows
- [projects/compose-exits-after-start/README.md](projects/compose-exits-after-start/README.md) — deterministic post-start failure stack
- [README-evaluation.md](../README-evaluation.md) — large-scale evaluation against public artifacts
