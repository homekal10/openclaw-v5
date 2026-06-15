# OpenClaw Local AI Safety Inventory

## Current Accepted State

- Sprint 001A accepted local provider health visibility.
- Sprint 001B accepted local router visibility.
- Sprint 001C accepted local model capacity and GGUF import path.
- Sprint 001D accepted Ollama-only local provider policy.
- Sprint 001E accepted the controlled one-shot Ollama inference adapter.
- Sprint 001F accepted the local inference safety harness.

## Ollama-Only Policy

- Active provider: `ollama`
- Approved model: `openclaw-phi3-mini:latest`
- Max context: `2048`
- Max predict: `64`
- Inference enabled by default: `false`
- Cloud providers enabled by default: `false`
- LM Studio enabled: `false`

## Approved Model

`Modelfile.openclaw-phi3-mini` points at the local GGUF-backed `openclaw-phi3-mini:latest` model and sets:

- `num_ctx 2048`
- `num_predict 64`
- `temperature 0.1`

No model pull was performed during Sprint 001G.

## Disabled LM Studio Path

LM Studio remains visible only through health reporting and remains disabled by local provider policy.

The router does not select LM Studio as fallback.

The controlled Ollama adapter does not call LM Studio.

## Controlled Adapter Status

`lib/providers/ollama_inference_adapter.cjs`:

- reads policy from `local_llm_policy.cjs`
- uses only `policy.approvedModel`
- calls only Ollama `/api/generate`
- requires explicit per-call allow
- refuses if inference is enabled by default
- enforces `policy.maxContext` and `policy.maxPredict`
- returns structured results

## Safety Harness Status

`scripts/test_ollama_inference_safety_harness.cjs` generated:

`docs/OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md`

Latest accepted verdict:

`SPRINT_001F_SAFETY_HARNESS_PASS`

## Trading Wiring Status

Local inference remains unwired from:

- `ai_core.cjs`
- `model_router.cjs`
- strategy generation
- MT5 execution
- live trading
- database writes
- autonomous workflows

## Still Blocked

- Strategy V2
- Candidate001_AUDNZD_V2
- MT5 live execution
- `mt5.order_send`
- DB schema changes
- DB writes for inference output
- arbitrary prompt API endpoints
- UI inference run buttons
- autonomous inference loops
- cloud-provider default routing
- LM Studio active path

## Sprint 001G Safety Position

The local AI lane remains accepted and bounded.

The repository worktree as a whole is not safe to commit wholesale because it contains unrelated and high-risk changes outside the accepted local AI lane.
