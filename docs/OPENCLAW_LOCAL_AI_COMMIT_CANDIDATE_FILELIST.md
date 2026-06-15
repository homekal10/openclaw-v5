# OpenClaw Local AI Commit Candidate Filelist

This file lists the proposed first local-AI checkpoint commit boundary.

No file is staged by this document.

## A. Provider / Policy Source

- `lib/providers/local_llm_health.cjs`
- `lib/providers/local_llm_router.cjs`
- `lib/providers/local_llm_policy.cjs`
- `Modelfile.openclaw-phi3-mini`

## B. Controlled Inference Source

- `lib/providers/ollama_inference_adapter.cjs`
- `lib/providers/ollama_golden_prompts.cjs`

## C. Local LLM Scripts

- `scripts/check_local_llm_health.cjs`
- `scripts/check_local_llm_router.cjs`
- `scripts/check_local_llm_policy.cjs`
- `scripts/smoke_ollama_inference_adapter.cjs`
- `scripts/test_ollama_inference_safety_harness.cjs`

## D. Dashboard Local AI Visibility Files

Candidate after final review only:

- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`

These files should not be staged until a human confirms the local AI hunks are not mixed with unrelated campaign or paper-trading changes.

## E. Sprint Acceptance And Safety Docs

- `docs/OPENCLAW_LOCAL_PROVIDER_HEALTH_FOUNDATION.md`
- `docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT.md`
- `docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT_CORRECTED.md`
- `docs/OPENCLAW_SPRINT_001A_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_ENDPOINT_DIAGNOSTIC.md`
- `docs/OPENCLAW_SPRINT_001A_EXECUTION_GUARD.md`
- `docs/OPENCLAW_SPRINT_001A_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_RUNTIME_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_RUNTIME_REPAIR_REPORT.md`
- `docs/OPENCLAW_SPRINT_001B_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001B_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001B_PROVIDER_ROUTER_FOUNDATION.md`
- `docs/OPENCLAW_SPRINT_001C_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001C_CAPACITY_GATE_DECISION.md`
- `docs/OPENCLAW_SPRINT_001C_MODEL_PULL_SMOKE_TEST.md`
- `docs/OPENCLAW_SPRINT_001C_PHI_GGUF_IMPORT_REPORT.md`
- `docs/OPENCLAW_SPRINT_001D_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001D_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001D_OLLAMA_ONLY_POLICY.md`
- `docs/OPENCLAW_SPRINT_001E_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001E_CONTROLLED_OLLAMA_INFERENCE_ADAPTER.md`
- `docs/OPENCLAW_SPRINT_001E_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md`
- `docs/OPENCLAW_SPRINT_001F_LOCAL_INFERENCE_SAFETY_HARNESS.md`
- `docs/AUDNZD_H1_CSV_PREFLIGHT.md`

## F. Repo Hygiene Docs

- `docs/OPENCLAW_LOCAL_AI_SAFETY_INVENTORY.md`
- `docs/OPENCLAW_SAFE_COMMIT_PLAN.md`
- `docs/OPENCLAW_SPRINT_001G_REPO_HYGIENE_REPORT.md`
- `docs/OPENCLAW_SPRINT_001G_WORKTREE_INVENTORY.md`
- `docs/OPENCLAW_COMMIT_RISK_REGISTER.md`
- `docs/OPENCLAW_SAFE_STAGING_MANIFEST_LOCAL_AI.md`
- `docs/OPENCLAW_SPRINT_001H_COMMIT_BOUNDARY_ISOLATION.md`
- `docs/OPENCLAW_SPRINT_001H_VERIFICATION_REPORT.md`
- `docs/OPENCLAW_SPRINT_001I_MANUAL_SELECTIVE_STAGING_PLAN.md`
- `docs/OPENCLAW_LOCAL_AI_COMMIT_CANDIDATE_FILELIST.md`
- `docs/OPENCLAW_SPRINT_001I_STAGING_RISK_REVIEW.md`
- `docs/OPENCLAW_SPRINT_001I_VERIFICATION_REPORT.md`

## G. Files Excluded From This Commit

- `telegram.env`
- `env_vars_export.txt`
- `.env` and `.env.*` except reviewed `.env.example`
- `logs/**`
- `data/*.json`
- `data/*.jsonl`
- `msg_locks/*.lock`
- `lib/strategies/Candidate001_AUDNZD.ts`
- `lib/execution/**`
- `lib/mt5/mt5_bridge.py`
- `lib/database/**`
- `lib/knowledge/**`
- `lib/research/**`
- `lib/risk/**`
- `lib/system/**`
- `sql/*.sql`
- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
- `scripts/apply_v38_schema.cjs`
- `scripts/campaign_001_runner.cjs`
- `scripts/export_daily_results.cjs`
- `scripts/generate_handoff.cjs`
- `scripts/mt5_data_ingestion_pipeline.cjs`
- `scripts/postmortem_real_campaign_001.cjs`
- `scripts/run_real_campaign_001.cjs`
- `test_wave1_reliability.cjs`
