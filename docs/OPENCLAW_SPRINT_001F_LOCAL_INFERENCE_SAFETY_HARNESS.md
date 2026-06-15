# OpenClaw Sprint 001F Local Inference Safety Harness

## Files Changed

- `lib/providers/ollama_golden_prompts.cjs`
- `scripts/test_ollama_inference_safety_harness.cjs`
- `docs/OPENCLAW_SPRINT_001F_LOCAL_INFERENCE_SAFETY_HARNESS.md`
- `docs/OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md`

## Safety Design

Sprint 001F adds a local inference safety harness around the accepted Sprint 001E Ollama adapter.

The harness:

- uses only fixed allowlisted golden prompts
- verifies default inference refusal
- verifies one explicitly allowed smoke request
- verifies adapter payload policy limits
- verifies the dashboard smoke endpoint remains fixed-prompt and disabled by default
- verifies the adapter does not import strategies or database modules
- verifies the adapter does not reference LM Studio or `mt5.order_send`
- verifies `ai_core.cjs` and `model_router.cjs` remain unwired from the adapter

## Checks Implemented

- Adapter refuses without explicit allow flag.
- Adapter accepts exactly one allowed smoke request.
- Allowed smoke response contains `OPENCLAW_OLLAMA_ADAPTER_PASS`.
- Adapter uses only `policy.approvedModel`.
- Adapter uses `policy.maxContext` and `policy.maxPredict`.
- Adapter does not accept arbitrary API prompts.
- Dashboard smoke endpoint refuses without `allowLocalInferenceSmoke`.
- Dashboard smoke endpoint uses a fixed internal prompt only.
- No references to `mt5.order_send` were added in modified provider/adapter files.
- No strategy files are imported by the adapter.
- No DB write modules are imported by the adapter.
- LM Studio is not called by the adapter.

## Validation Commands

```powershell
npx tsc --noEmit -p .\tsconfig.openclaw.json
node .\scripts\validate_audnzd_csv_contract.cjs
node .\scripts\validate_database_schema.cjs
node .\scripts\check_local_llm_health.cjs
node .\scripts\check_local_llm_router.cjs
node .\scripts\check_local_llm_policy.cjs
node .\scripts\smoke_ollama_inference_adapter.cjs
node .\scripts\smoke_ollama_inference_adapter.cjs --allow-local-inference-smoke
node .\scripts\test_ollama_inference_safety_harness.cjs
```

`DB_NOT_CONNECTED` remains acceptable when database environment variables are intentionally inactive.

## Runtime Wiring Confirmation

`ai_core.cjs` and `model_router.cjs` remain unwired from `lib/providers/ollama_inference_adapter.cjs`.

Sprint 001F does not connect local inference to trading decisions, strategy generation, MT5 execution, database writes, UI controls, arbitrary prompt endpoints, or autonomous workflows.

## Remaining Blocked Items

- Strategy V2
- Candidate001_AUDNZD_V2
- MT5 live execution
- `mt5.order_send`
- DB schema changes
- DB writes for inference output
- Arbitrary prompt API endpoints
- UI inference buttons
- Autonomous inference loops
- Cloud-provider default routing
- LM Studio active path
