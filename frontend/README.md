# Docker Quality Analyzer Frontend

React 19 + TypeScript SPA for Dockerfile/Compose/project analysis, deploy controls, and runtime monitoring.

## Key behavior

- Project upload currently queues analysis for all detected Docker/Compose files.
- Project upload flow currently communicates automatic image builds.
- Compose runtime deploy remains explicit user action from results/deploy controls.
- Monitoring surfaces running and terminal states (for example exited/failed/stopped) without presenting stopped containers as live.

## Local development

```bash
npm install
npm run dev
```

Vite serves on `http://localhost:5173` by default. Set `VITE_API_BASE_URL` only when you need to target a non-default backend.

## Quality checks

```bash
npm run lint
npm run build
```

Run `npm run build` before merge to verify type-checking and bundling.
