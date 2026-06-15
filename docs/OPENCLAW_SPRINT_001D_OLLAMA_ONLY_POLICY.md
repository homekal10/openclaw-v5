# OPENCLAW Sprint 001D Ollama-Only Policy

## Files Changed

- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `lib/providers/local_llm_policy.cjs`
- `lib/providers/local_llm_router.cjs`
- `scripts/check_local_llm_policy.cjs`
- `docs/OPENCLAW_PORT_OWNERSHIP.md`
- `docs/OPENCLAW_SPRINT_001B_PROVIDER_ROUTER_FOUNDATION.md`
- `docs/OPENCLAW_SPRINT_001D_OLLAMA_ONLY_POLICY.md`

## Policy Decisions

OpenClaw local LLM policy is now Ollama-only by default.

Policy values:

- `activeProvider`: `ollama`
- `approvedModel`: `openclaw-phi3-mini:latest`
- `maxContext`: `2048`
- `maxPredict`: `64`
- `lmStudioEnabled`: `false`
- `cloudProvidersEnabledByDefault`: `false`
- `allowInferenceByDefault`: `false`

## Why LM Studio Is Disabled

The Sprint 001C board acceptance selected Ollama as the only active local runtime path.

LM Studio can remain visible in provider-health output for operator awareness, but it is disabled by policy and must not be selected by the local router.

## Approved Model

Approved model:

```text
openclaw-phi3-mini:latest
```

The model was imported from a local GGUF and validated by the Sprint 001C controlled smoke test.

## Runtime Safety Limits

The approved local model limits are:

```text
num_ctx 2048
num_predict 64
temperature 0.1
```

Sprint 001D does not run inference, pull models, auto-load models, or wire runtime AI calls into `ai_core.cjs` or `model_router.cjs`.

## Validation Results

Required validation commands for this sprint:

```powershell
npx tsc --noEmit -p .\tsconfig.openclaw.json
node .\scripts\validate_audnzd_csv_contract.cjs
node .\scripts\validate_database_schema.cjs
node .\scripts\check_local_llm_health.cjs
node .\scripts\check_local_llm_router.cjs
node .\scripts\check_local_llm_policy.cjs
```

`DB_NOT_CONNECTED` is acceptable when `DATABASE_URL` is intentionally inactive.

Dashboard-only endpoint acceptance:

```text
http://localhost:5173/api/platform/provider-health
http://localhost:5173/api/platform/local-llm-router
http://localhost:5173/api/platform/local-llm-policy
```

Expected router:

```text
selectedProvider: ollama
reason: ollama_online_policy_primary
```

Expected policy:

```text
activeProvider: ollama
approvedModel: openclaw-phi3-mini:latest
lmStudioEnabled: false
allowInferenceByDefault: false
```

## What Remains Blocked

- Candidate001_AUDNZD_V2
- MT5 live execution
- `mt5.order_send`
- live trading
- DB schema changes
- cloud-provider default routing
- model pulls
- broad inference loops
- OpenClaw runtime inference wiring
