# OPENCLAW Sprint 001E Controlled Ollama Inference Adapter

## Files Changed

- `dashboard.cjs`
- `lib/providers/ollama_inference_adapter.cjs`
- `scripts/smoke_ollama_inference_adapter.cjs`
- `docs/OPENCLAW_SPRINT_001E_CONTROLLED_OLLAMA_INFERENCE_ADAPTER.md`

## Safety Design

Sprint 001E adds a controlled one-shot Ollama adapter only.

The adapter:

- reads policy from `lib/providers/local_llm_policy.cjs`
- uses only `policy.approvedModel`
- uses only Ollama `/api/generate`
- refuses if `policy.activeProvider` is not `ollama`
- refuses if `policy.allowInferenceByDefault` is ever set to `true`
- requires an explicit per-call allow flag
- enforces `policy.maxContext` and `policy.maxPredict`
- performs exactly one request per allowed call
- returns structured output

## Why Inference Is Still Disabled By Default

OpenClaw runtime inference wiring is still blocked.

`allowInferenceByDefault` remains `false`, and the adapter refuses unless a caller provides an explicit one-shot smoke-test allow flag. This prevents accidental model execution from dashboard load, provider polling, router status checks, or trading logic.

## CLI Usage

Blocked default check:

```powershell
node .\scripts\smoke_ollama_inference_adapter.cjs
```

One-shot allowed smoke check:

```powershell
node .\scripts\smoke_ollama_inference_adapter.cjs --allow-local-inference-smoke
```

The allowed smoke uses this fixed prompt:

```text
Reply with exactly this text and nothing else: OPENCLAW_OLLAMA_ADAPTER_PASS
```

## Endpoint Usage

Disabled-by-default endpoint:

```text
POST /api/platform/ollama-inference-smoke
```

Without this body, the endpoint refuses safely:

```json
{}
```

Allowed one-shot body:

```json
{
  "allowLocalInferenceSmoke": true
}
```

The endpoint does not accept arbitrary prompts in Sprint 001E.

## Validation Results

Commands run:

```powershell
npx tsc --noEmit -p .\tsconfig.openclaw.json
node .\scripts\validate_audnzd_csv_contract.cjs
node .\scripts\validate_database_schema.cjs
node .\scripts\check_local_llm_health.cjs
node .\scripts\check_local_llm_router.cjs
node .\scripts\check_local_llm_policy.cjs
node .\scripts\smoke_ollama_inference_adapter.cjs
node .\scripts\smoke_ollama_inference_adapter.cjs --allow-local-inference-smoke
```

Results:

- TypeScript check passed.
- AUDNZD CSV preflight passed and wrote `docs/AUDNZD_H1_CSV_PREFLIGHT.md`.
- Database validator returned `DB_NOT_CONNECTED`, which is acceptable when `DATABASE_URL` is intentionally inactive.
- Local provider health passed with Ollama online and LM Studio offline.
- Local router selected Ollama with `ollama_online_policy_primary`.
- Local policy confirmed Ollama-only defaults and `allowInferenceByDefault: false`.
- Default adapter smoke refused safely with `local_inference_requires_explicit_allow`.
- Explicit one-shot adapter smoke returned `OPENCLAW_OLLAMA_ADAPTER_PASS`.
- Runtime endpoint tests passed for provider health, router, policy, refused smoke, and allowed one-shot smoke on `http://localhost:5173`.

## Remaining Blocked Items

- runtime inference wiring into `ai_core.cjs`
- runtime inference wiring into `model_router.cjs`
- trading decision inference
- Strategy V2
- MT5 live execution
- `mt5.order_send`
- DB writes for inference output
- model pulls
- broad inference loops
- cloud-provider default routing
