# OPENCLAW Sprint 001B Provider Router Foundation

## Files Changed

- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `lib/providers/local_llm_router.cjs`
- `scripts/check_local_llm_router.cjs`
- `docs/OPENCLAW_PORT_OWNERSHIP.md`
- `docs/OPENCLAW_SPRINT_001B_PROVIDER_ROUTER_FOUNDATION.md`

## What Was Added

Sprint 001B adds a safe local LLM router decision surface.

Added capabilities:

- A reusable local router module that reads provider health.
- A CLI script that prints the local provider decision.
- A read-only dashboard/API endpoint for router visibility.
- A compact Providers-page router decision card.
- Port ownership documentation for dashboard-only and unified server startup paths.

## How Router Selection Works

The router reads `lib/providers/local_llm_health.cjs` and applies this order:

1. Select Ollama when Ollama is online.
2. Select LM Studio only when Ollama is offline and LM Studio is online.
3. Select no provider when both local providers are offline.

The router decision shape is:

```json
{
  "ok": true,
  "selectedProvider": "ollama",
  "reason": "ollama_online_primary",
  "generatedAt": "ISO timestamp",
  "providers": []
}
```

## Why No Model Inference Happens Yet

Sprint 001B is a routing foundation only.

It does not:

- call chat endpoints
- call completion endpoints
- call generate endpoints
- pull Ollama models
- load local models
- require cloud API keys
- change `model_router.cjs` inference behavior
- change `ai_core.cjs` inference behavior

This keeps local provider routing observable before any model execution is approved.

## How To Test

Run the validation set:

```powershell
npx tsc --noEmit -p .\tsconfig.openclaw.json
node .\scripts\validate_audnzd_csv_contract.cjs
node .\scripts\validate_database_schema.cjs
node .\scripts\check_local_llm_health.cjs
node .\scripts\check_local_llm_router.cjs
```

`DB_NOT_CONNECTED` is acceptable when `DATABASE_URL` is intentionally inactive.

Run the dashboard-only endpoint test:

```powershell
node dashboard.cjs
```

Then call:

```text
http://localhost:5173/api/platform/provider-health
http://localhost:5173/api/platform/local-llm-router
```

Expected current state:

- Ollama online
- LM Studio offline
- selected provider: `ollama`
- reason: `ollama_online_primary`

## What Remains For Sprint 001C

- Decide whether to wire this router into `ai_core.cjs` or `model_router.cjs`.
- Choose and explicitly approve an Ollama model before any local inference.
- Add provider/model readiness copy once a model is installed.
- Keep cloud providers opt-in and non-default.
- Continue to block Candidate001_AUDNZD_V2, MT5 live execution, and live trading.

## Sprint 001D Supersession Note

Sprint 001D changed the active local provider policy to Ollama-only.

LM Studio may remain visible in provider-health output, but it is disabled by policy and is no longer an active router fallback.
