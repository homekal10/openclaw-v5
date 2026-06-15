# OpenClaw Sprint 001I Manual Selective Staging Plan

## Verdict

`SPRINT_001I_STAGING_PLAN_READY`

This is a human-reviewed staging plan only. It does not authorize automatic staging, committing, pushing, reset, clean, delete, or `git rm`.

No files were staged before this sprint started.

## Explicit Warning

Do not run `git add .`.

The worktree contains secret-risk files, logs, runtime data, MT5/live execution changes, blocked strategy work, and SQL/schema files.

The Windows/System32 popup watcher finding increases the need for conservative manual staging. Treat all future commands as human-reviewed only.

## Exact Safe File List For Local AI Lane

### Provider And Policy Source

- `lib/providers/local_llm_health.cjs`
- `lib/providers/local_llm_router.cjs`
- `lib/providers/local_llm_policy.cjs`
- `lib/providers/ollama_inference_adapter.cjs`
- `lib/providers/ollama_golden_prompts.cjs`
- `Modelfile.openclaw-phi3-mini`

### Local LLM Scripts

- `scripts/check_local_llm_health.cjs`
- `scripts/check_local_llm_router.cjs`
- `scripts/check_local_llm_policy.cjs`
- `scripts/smoke_ollama_inference_adapter.cjs`
- `scripts/test_ollama_inference_safety_harness.cjs`

### Local AI Acceptance And Safety Docs

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

### Repo Hygiene And Commit-Boundary Docs

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

## Exact Files That Require Review Before Staging

- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `.env.example`
- `.gitignore`
- `.gitignore.backup.before-secret-hardening`
- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
- `tsconfig.openclaw.json`
- `tsconfig.openclaw.backup.before-tighten.json`
- `scripts/validate_audnzd_csv_contract.cjs`
- `scripts/validate_database_schema.cjs`

Review reason: these files are either mixed with unrelated changes, affect repo-wide behavior, or may predate the local AI lane.

## Exact Must-Not-Stage List

- `telegram.env`
- `env_vars_export.txt`
- any `.env` or `.env.*` file except `.env.example`
- `logs/**`
- `data/audit_log.jsonl`
- `data/headlines.json`
- `data/performance.json`
- `data/rwanda.json`
- `data/signals.json`
- `data/snapshots.json`
- `msg_locks/*.lock`
- `lib/strategies/Candidate001_AUDNZD.ts`
- `lib/execution/live_trade_engine.cjs`
- `lib/execution/startup_reconciliation.cjs`
- `lib/mt5/mt5_bridge.py`
- `lib/execution/*.ts`
- `lib/database/*.ts`
- `lib/knowledge/*.ts`
- `lib/research/**`
- `lib/risk/**`
- `lib/system/**`
- `sql/*.sql`
- `scripts/apply_v38_schema.cjs`
- `scripts/campaign_001_runner.cjs`
- `scripts/export_daily_results.cjs`
- `scripts/generate_handoff.cjs`
- `scripts/mt5_data_ingestion_pipeline.cjs`
- `scripts/postmortem_real_campaign_001.cjs`
- `scripts/run_real_campaign_001.cjs`
- `test_wave1_reliability.cjs`

## Future Staging Commands

DO NOT RUN YET.

```powershell
git diff --cached --name-only
git add -- lib/providers/local_llm_health.cjs
git add -- lib/providers/local_llm_router.cjs
git add -- lib/providers/local_llm_policy.cjs
git add -- lib/providers/ollama_inference_adapter.cjs
git add -- lib/providers/ollama_golden_prompts.cjs
git add -- Modelfile.openclaw-phi3-mini
git add -- scripts/check_local_llm_health.cjs
git add -- scripts/check_local_llm_router.cjs
git add -- scripts/check_local_llm_policy.cjs
git add -- scripts/smoke_ollama_inference_adapter.cjs
git add -- scripts/test_ollama_inference_safety_harness.cjs
git add -- docs/OPENCLAW_LOCAL_PROVIDER_HEALTH_FOUNDATION.md
git add -- docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT.md
git add -- docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT_CORRECTED.md
git add -- docs/OPENCLAW_SPRINT_001A_BOARD_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001A_ENDPOINT_DIAGNOSTIC.md
git add -- docs/OPENCLAW_SPRINT_001A_EXECUTION_GUARD.md
git add -- docs/OPENCLAW_SPRINT_001A_FINAL_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001A_RUNTIME_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001A_RUNTIME_REPAIR_REPORT.md
git add -- docs/OPENCLAW_SPRINT_001B_BOARD_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001B_FINAL_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001B_PROVIDER_ROUTER_FOUNDATION.md
git add -- docs/OPENCLAW_SPRINT_001C_BOARD_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001C_CAPACITY_GATE_DECISION.md
git add -- docs/OPENCLAW_SPRINT_001C_MODEL_PULL_SMOKE_TEST.md
git add -- docs/OPENCLAW_SPRINT_001C_PHI_GGUF_IMPORT_REPORT.md
git add -- docs/OPENCLAW_SPRINT_001D_BOARD_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001D_FINAL_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001D_OLLAMA_ONLY_POLICY.md
git add -- docs/OPENCLAW_SPRINT_001E_BOARD_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001E_CONTROLLED_OLLAMA_INFERENCE_ADAPTER.md
git add -- docs/OPENCLAW_SPRINT_001E_FINAL_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001F_BOARD_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001F_FINAL_ACCEPTANCE.md
git add -- docs/OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md
git add -- docs/OPENCLAW_SPRINT_001F_LOCAL_INFERENCE_SAFETY_HARNESS.md
git add -- docs/OPENCLAW_LOCAL_AI_SAFETY_INVENTORY.md
git add -- docs/OPENCLAW_SAFE_COMMIT_PLAN.md
git add -- docs/OPENCLAW_SPRINT_001G_REPO_HYGIENE_REPORT.md
git add -- docs/OPENCLAW_SPRINT_001G_WORKTREE_INVENTORY.md
git add -- docs/OPENCLAW_COMMIT_RISK_REGISTER.md
git add -- docs/OPENCLAW_SAFE_STAGING_MANIFEST_LOCAL_AI.md
git add -- docs/OPENCLAW_SPRINT_001H_COMMIT_BOUNDARY_ISOLATION.md
git add -- docs/OPENCLAW_SPRINT_001H_VERIFICATION_REPORT.md
git add -- docs/OPENCLAW_SPRINT_001I_MANUAL_SELECTIVE_STAGING_PLAN.md
git add -- docs/OPENCLAW_LOCAL_AI_COMMIT_CANDIDATE_FILELIST.md
git add -- docs/OPENCLAW_SPRINT_001I_STAGING_RISK_REVIEW.md
git add -- docs/OPENCLAW_SPRINT_001I_VERIFICATION_REPORT.md
```

Dashboard files are intentionally excluded from the future commands above until reviewed.

## Future Verification Commands After Staging

DO NOT RUN YET.

```powershell
git diff --cached --name-only
git diff --cached --check
npx tsc --noEmit -p .\tsconfig.openclaw.json
node .\scripts\validate_audnzd_csv_contract.cjs
node .\scripts\validate_database_schema.cjs
node .\scripts\check_local_llm_health.cjs
node .\scripts\check_local_llm_router.cjs
node .\scripts\check_local_llm_policy.cjs
node .\scripts\test_ollama_inference_safety_harness.cjs
```
