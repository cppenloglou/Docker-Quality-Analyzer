# Docker Quality Analyzer — Frontend

React 19 + TypeScript single-page application for Dockerfile, Compose, and project archive analysis, deployment controls, and runtime monitoring. The SPA is served by Nginx in containerized deployments, where Nginx also reverse-proxies API and WebSocket traffic so browser clients only address a single origin.

For the system-level architecture see the root [README.md](../README.md); for the backend API surface see [backend/README.md](../backend/README.md).

## 1. Technology Stack

| Concern | Technology |
| --- | --- |
| UI framework | React 19 with TypeScript |
| Build tooling | Vite |
| Styling | Tailwind CSS v4 with CSS variables; semantic tokens (`bg-card`, `text-foreground`, `border-border`) |
| UI primitives | Radix-based components under `src/components/ui/` |
| Charts | Recharts (CPU/memory monitoring) |
| Real-time transport | Native WebSockets (job events, container metrics, logs) |

## 2. Source Organization

| Path | Content |
| --- | --- |
| `src/main.tsx` | Application entrypoint |
| `src/routes.tsx` | Route definitions |
| `src/pages/` | Page-level components (landing, analysis, results, execution, history, research analytics) |
| `src/components/` | Shared UI components |
| `src/components/ui/` | Radix-based design-system primitives |
| `src/auth/AuthProvider.tsx` | Authentication context (JWT session handling) |
| `src/utils/api.ts` | The **sole** API access point (`jobs`, `dockerfile`, `compose`, `project`, `research`, `auth`, `ws`, …) |
| `src/hooks/`, `src/types/`, `src/styles/`, `src/assets/` | Hooks, shared types, global styles, static assets |

All HTTP and WebSocket communication must go through `src/utils/api.ts`; components never issue raw `fetch` calls to backend endpoints.

## 3. Current Product Behavior

The following behaviors are code-backed and may evolve; treat this section as documentation of current behavior:

- **Project upload** queues analysis for **all** detected Dockerfiles and Compose files in the archive — there is no manual selection step.
- **Image builds** are communicated as automatic in the project upload flow (the upload payload defaults `build_selected_images=true`; the worker gates actual build execution on this flag).
- **Compose runtime deploy** remains an explicit user action, triggered from the results/deploy controls; it is never started automatically.
- **Monitoring honesty**: monitoring surfaces both running and terminal container states (`exited`, `failed`, `unhealthy`, `partial`, `stopped_by_user`) and never presents a stopped or exited container as live.

## 4. Local Development

```bash
npm install
npm run dev
```

Vite serves on `http://localhost:5173` by default. With `VITE_API_BASE_URL` unset, the API client targets `http://localhost:8000`, which the backend's permissive development CORS policy (`APP_ENV=dev`) allows. Set `VITE_API_BASE_URL` only when targeting a non-default backend.

In the containerized deployment the SPA is served at `http://localhost:3000`, with `/api`, `/auth`, `/health`, `/metrics`, `/docs`, `/redoc`, `/openapi.json`, and `/ws/*` proxied to the `api` service by Nginx.

## 5. Styling Conventions

- Prefer semantic design tokens over raw color utilities (`bg-card`, `text-foreground`, `border-border`).
- Maintain adequate contrast in both themes; follow the conventions defined in the project styling rules (native selects, chart palettes).

## 6. Quality Gates

There is no test runner for the frontend; validation is performed through linting and type-checked builds:

```bash
npm run lint    # ESLint
npm run build   # TypeScript type-checking + production bundling
```

`npm run build` (not only `lint`) must pass before merge so that type-checking and bundling remain green in CI.

## Related Documents

- [Root README](../README.md) — system overview and workflows
- [backend/README.md](../backend/README.md) — API surface and event channels
- [examples/README.md](../examples/README.md) — artifacts for exercising every UI workflow
