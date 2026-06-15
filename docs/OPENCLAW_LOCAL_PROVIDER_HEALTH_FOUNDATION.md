# OPENCLAW Local Provider Health Foundation

## What Was Added

Sprint 001A adds a safe, read-only health foundation for local LLM providers used by OpenClaw.

Added capabilities:

- A reusable local provider health module for Ollama and LM Studio.
- A non-fatal CLI checker for local provider visibility.
- A read-only backend API endpoint for dashboard consumption.
- A small dashboard panel that shows local provider availability, latency, and discovered models.
- A direct dashboard-only acceptance path so `node dashboard.cjs` starts the Express API owner.

This sprint does not send prompts, mutate provider configuration, or alter trading behavior.

## Active Server And Route Ownership

OpenClaw has a unified process entrypoint and a separate dashboard route owner:

- Unified package entrypoint: `server.cjs`
- PM2 entrypoint: `automation/ecosystem.config.cjs` runs `server.cjs`
- Express route/listener owner: `dashboard.cjs`
- Direct dashboard-only acceptance command: `node dashboard.cjs`

Port behavior:

- `node dashboard.cjs` uses `DASHBOARD_PORT` when set, otherwise `5173`.
- `node server.cjs` uses `PORT`, then `DASHBOARD_PORT`, otherwise `3737`, and passes that value into `dashboard.cjs`.
- PM2 sets `PORT=3847`, so the managed process binds the dashboard API on `3847`.

The Sprint 001A provider-health endpoint is registered in `dashboard.cjs` because that file owns the Express `app` and existing API routes. It is reachable at:

```text
GET /api/platform/provider-health
```

## Files Changed

- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `lib/providers/local_llm_health.cjs`
- `scripts/check_local_llm_health.cjs`
- `docs/OPENCLAW_LOCAL_PROVIDER_HEALTH_FOUNDATION.md`
- `docs/OPENCLAW_SPRINT_001A_RUNTIME_REPAIR_REPORT.md`

## How To Test Ollama

1. Start Ollama locally.
2. Confirm the default endpoint is available at `http://localhost:11434`.
3. Run:

```powershell
node .\scripts\check_local_llm_health.cjs
```

4. Verify the Ollama section reports:

- `ONLINE`
- a latency value
- discovered model names from `GET /api/tags`

Optional override:

```powershell
$env:OLLAMA_BASE_URL='http://localhost:11434'
node .\scripts\check_local_llm_health.cjs
```

## How To Test LM Studio

1. Start LM Studio local server mode.
2. Confirm the default endpoint is available at `http://localhost:1234`.
3. Run:

```powershell
node .\scripts\check_local_llm_health.cjs
```

4. Verify the LM Studio section reports:

- `ONLINE`
- a latency value
- discovered model ids from `GET /v1/models`

Optional override:

```powershell
$env:LMSTUDIO_BASE_URL='http://localhost:1234'
node .\scripts\check_local_llm_health.cjs
```

## Why Offline Providers Are Not Fatal

Local providers are optional operator-side infrastructure, not a repository integrity requirement.

For Sprint 001A:

- Offline local LLM services must not fail repository validation.
- The checker exits `0` even when providers are offline.
- The dashboard endpoint returns structured offline status instead of throwing fatal errors.

This keeps development, CI-style checks, and non-local workflows stable when Ollama or LM Studio are intentionally not running.

## What Remains For Sprint 001B

- Integrate local provider health more deeply with provider registry status surfaces if approved.
- Add richer operator guidance for model selection and mismatch diagnostics.
- Consider read-only routing visibility between local health and model router behavior.
- Evaluate whether local provider status should influence dashboard aggregate summaries.
