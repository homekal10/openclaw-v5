# OPENCLAW Port Ownership

## Summary

OpenClaw currently has one Express route owner and multiple startup paths.

- `dashboard.cjs` owns the Express app, API routes, static dashboard serving, WebSocket attachment, and direct route testing.
- `node dashboard.cjs` starts the dashboard-only server on `DASHBOARD_PORT` when set, otherwise `5173`.
- `server.cjs` is the broader unified operational entrypoint. It starts `dashboard.cjs`, then may wake bot, scheduler, MT5 monitor, bridge-health monitor, and system-health loops.
- Narrow provider endpoint tests should use `node dashboard.cjs` unless a unified runtime test is explicitly required.

## Dashboard API

Direct dashboard startup:

```powershell
node dashboard.cjs
```

Default direct port:

```text
5173
```

Direct provider endpoints:

```text
http://localhost:5173/api/platform/provider-health
http://localhost:5173/api/platform/local-llm-router
http://localhost:5173/api/platform/local-llm-policy
```

## Unified Server

Package startup:

```powershell
node server.cjs
```

Port selection:

```text
PORT -> DASHBOARD_PORT -> 3737
```

`server.cjs` sets `process.env.DASHBOARD_PORT` before calling `startDashboard()`, so the dashboard binds the unified server port.

## PM2

PM2 startup is configured in `automation/ecosystem.config.cjs`.

Current PM2 behavior:

```text
script: server.cjs
PORT: 3847
```

That means a PM2-managed OpenClaw process should expose dashboard/API routes on:

```text
http://localhost:3847
```

## Frontend And Vite Port Ambiguity

The built dashboard is served by `dashboard.cjs` from `dashboard-ui/dist`.

The Vite dev server config uses:

```text
frontend dev server: http://localhost:8080
proxy target: http://127.0.0.1:3737
```

This creates a known ambiguity:

- direct dashboard tests use `5173`
- unified server default uses `3737`
- Vite dev proxy targets `3737`
- PM2 uses `3847`

For Sprint 001A, Sprint 001B, and Sprint 001D provider endpoint acceptance, use direct `dashboard.cjs` testing on `5173`. Do not use `server.cjs` for narrow provider endpoint checks unless the broader bot/monitor runtime is intentionally part of the test.
