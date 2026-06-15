# OPENCLAW Sprint 001A Runtime Repair Report

## Root Cause

`dashboard.cjs` owns the Express app, API routes, and `app.listen()` implementation, but it only exported `startDashboard()` and did not invoke it when run directly.

As a result, this command:

```powershell
node dashboard.cjs
```

loaded module-level dependencies such as `SnapshotStore`, then exited without opening a listening port.

## Actual Route And Server Ownership

- Unified package entrypoint: `server.cjs`
- PM2 entrypoint: `automation/ecosystem.config.cjs`, which runs `server.cjs`
- Express route owner: `dashboard.cjs`
- Listener owner: `dashboard.cjs`, via `startDashboard()`
- Existing API routes are registered in `dashboard.cjs`

Port behavior:

- Direct dashboard-only run: `node dashboard.cjs` binds `DASHBOARD_PORT` or `5173`.
- Unified server run: `node server.cjs` binds `PORT`, then `DASHBOARD_PORT`, otherwise `3737`.
- PM2 run: `automation/ecosystem.config.cjs` sets `PORT=3847`.

## Repair

Added a direct-run guard to `dashboard.cjs`:

```js
if (require.main === module) {
    startDashboard();
}
```

This preserves the existing import behavior for `server.cjs` and `scheduler.cjs`, while making `node dashboard.cjs` a valid dashboard-only runtime acceptance command.

The provider-health endpoint remains registered in `dashboard.cjs`:

```text
GET /api/platform/provider-health
```

The endpoint is read-only and returns:

```json
{
  "ok": true,
  "generatedAt": "ISO timestamp",
  "providers": []
}
```

## Runtime Acceptance

Acceptance command:

```powershell
node dashboard.cjs
```

Endpoint tested:

```text
http://localhost:5173/api/platform/provider-health
```

Expected provider state for this handoff:

- Ollama: online at `http://localhost:11434`
- LM Studio: offline at `http://localhost:1234`

Verified result:

```json
{
  "ok": true,
  "generatedAt": "2026-06-14T19:40:36.252Z",
  "providers": [
    {
      "provider": "ollama",
      "baseUrl": "http://localhost:11434",
      "online": true,
      "latencyMs": 59,
      "modelCount": 0,
      "models": [],
      "error": null
    },
    {
      "provider": "lmstudio",
      "baseUrl": "http://localhost:1234",
      "online": false,
      "latencyMs": null,
      "modelCount": 0,
      "models": [],
      "error": "fetch_failed"
    }
  ]
}
```

Server startup proof:

```text
[Dashboard] Live at http://localhost:5173
[Dashboard] WebSocket live at ws://localhost:5173/ws
```

## Safety Notes

- No secrets were printed.
- No `.env` files were edited.
- No database schema files were changed.
- No strategy files were edited.
- No MT5 execution paths were edited.
- No live-trading calls were made.
- No Git staging, reset, clean, push, or commit operations were performed.
