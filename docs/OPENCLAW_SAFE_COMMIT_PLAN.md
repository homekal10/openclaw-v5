# OpenClaw Safe Commit Plan

## Safety Rule

Do not run `git add .` yet.

This worktree contains accepted local AI files mixed with runtime logs, secret-risk files, blocked strategy work, MT5/live execution changes, SQL schema files, and unrelated runtime data. Staging must be explicit and file-by-file.

## Proposed Commit Groups

### Commit 1: Local Provider Health and Router Foundation

Stage later only after final manual review:

- `lib/providers/local_llm_health.cjs`
- `lib/providers/local_llm_router.cjs`
- `scripts/check_local_llm_health.cjs`
- `scripts/check_local_llm_router.cjs`
- `docs/OPENCLAW_LOCAL_PROVIDER_HEALTH_FOUNDATION.md`
- `docs/OPENCLAW_SPRINT_001A_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_ENDPOINT_DIAGNOSTIC.md`
- `docs/OPENCLAW_SPRINT_001A_EXECUTION_GUARD.md`
- `docs/OPENCLAW_SPRINT_001A_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_RUNTIME_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_RUNTIME_REPAIR_REPORT.md`
- `docs/OPENCLAW_SPRINT_001B_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001B_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001B_PROVIDER_ROUTER_FOUNDATION.md`

### Commit 2: Ollama-Only Policy and Model Acceptance

Stage later only after final manual review:

- `lib/providers/local_llm_policy.cjs`
- `scripts/check_local_llm_policy.cjs`
- `Modelfile.openclaw-phi3-mini`
- `docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT.md`
- `docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT_CORRECTED.md`
- `docs/OPENCLAW_SPRINT_001C_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001C_CAPACITY_GATE_DECISION.md`
- `docs/OPENCLAW_SPRINT_001C_MODEL_PULL_SMOKE_TEST.md`
- `docs/OPENCLAW_SPRINT_001C_PHI_GGUF_IMPORT_REPORT.md`
- `docs/OPENCLAW_SPRINT_001D_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001D_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001D_OLLAMA_ONLY_POLICY.md`

### Commit 3: Controlled Ollama Adapter and Safety Harness

Stage later only after final manual review:

- `lib/providers/ollama_inference_adapter.cjs`
- `lib/providers/ollama_golden_prompts.cjs`
- `scripts/smoke_ollama_inference_adapter.cjs`
- `scripts/test_ollama_inference_safety_harness.cjs`
- `docs/OPENCLAW_SPRINT_001E_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001E_CONTROLLED_OLLAMA_INFERENCE_ADAPTER.md`
- `docs/OPENCLAW_SPRINT_001E_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md`
- `docs/OPENCLAW_SPRINT_001F_LOCAL_INFERENCE_SAFETY_HARNESS.md`

### Commit 4: Dashboard Read-Only Local AI Visibility

Stage later only after separating or accepting unrelated diff content:

- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`

These files currently include accepted local AI changes. Some diffs also include unrelated campaign or paper-trading helpers, so review before staging.

### Commit 5: Repository Hygiene Documentation

Stage later:

- `docs/OPENCLAW_SPRINT_001G_WORKTREE_INVENTORY.md`
- `docs/OPENCLAW_SAFE_COMMIT_PLAN.md`
- `docs/OPENCLAW_LOCAL_AI_SAFETY_INVENTORY.md`
- `docs/OPENCLAW_SPRINT_001G_REPO_HYGIENE_REPORT.md`

### Commit 6: Ignore and Template Hardening

Stage later only after security review:

- `.gitignore`
- `.env.example`

Do not stage `.gitignore.backup.before-secret-hardening` unless explicitly approved.

## Files Not To Stage Yet

- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
- `lib/execution/live_trade_engine.cjs`
- `lib/execution/startup_reconciliation.cjs`
- `lib/mt5/mt5_bridge.py`
- `lib/execution/*.ts`
- `lib/database/*.ts`
- `lib/knowledge/*.ts`
- `lib/research/**`
- `lib/risk/**`
- `lib/system/**`
- `scripts/apply_v38_schema.cjs`
- `scripts/campaign_001_runner.cjs`
- `scripts/export_daily_results.cjs`
- `scripts/generate_handoff.cjs`
- `scripts/mt5_data_ingestion_pipeline.cjs`
- `scripts/postmortem_real_campaign_001.cjs`
- `scripts/run_real_campaign_001.cjs`
- `sql/*.sql`
- `test_wave1_reliability.cjs`

## Files Requiring Manual Review

- `.env.example`
- `.gitignore`
- `.gitignore.backup.before-secret-hardening`
- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
- `lib/execution/live_trade_engine.cjs`
- `lib/execution/startup_reconciliation.cjs`
- `lib/mt5/mt5_bridge.py`
- `lib/strategies/Candidate001_AUDNZD.ts`
- `sql/*.sql`

## Files That Should Remain Ignored

- `.env`
- `.env.*` except `.env.example`
- `telegram.env`
- `env_vars_export.txt`
- `logs/**`
- `data/*.json`
- `data/*.jsonl`
- `msg_locks/*.lock`
- `lib/research/data/csv/*.csv`
- `OPENCLAW_CHATGPT_HANDOFF_CURRENT/`
- `OPENCLAW_CHATGPT_HANDOFF_CURRENT.zip`
- local model GGUF files
- local market-data inbox/archive folders

## Exact Staging Guidance

Use explicit paths only, for example:

```powershell
git add -- lib/providers/local_llm_health.cjs scripts/check_local_llm_health.cjs
```

Do not use broad pathspecs until the must-not-commit files are fully isolated.

Do not run `git add .` yet.
