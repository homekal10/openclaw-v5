# OpenClaw Sprint 001G Worktree Inventory

Generated during Sprint 001G repository hygiene audit.

## Commands Inspected

- `git status --short`
- `git diff --name-only`
- `git ls-files --others --exclude-standard`
- `.gitignore`
- Sprint 001A through 001F acceptance documents
- Local provider and inference files
- Dashboard provider files
- `Modelfile.openclaw-phi3-mini`
- Strategy and env-like files visible in git status

## Accepted Sprint 001A Files

- `lib/providers/local_llm_health.cjs`
- `scripts/check_local_llm_health.cjs`
- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `docs/OPENCLAW_LOCAL_PROVIDER_HEALTH_FOUNDATION.md`
- `docs/OPENCLAW_SPRINT_001A_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_ENDPOINT_DIAGNOSTIC.md`
- `docs/OPENCLAW_SPRINT_001A_EXECUTION_GUARD.md`
- `docs/OPENCLAW_SPRINT_001A_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_RUNTIME_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001A_RUNTIME_REPAIR_REPORT.md`

## Accepted Sprint 001B Files

- `lib/providers/local_llm_router.cjs`
- `scripts/check_local_llm_router.cjs`
- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `docs/OPENCLAW_SPRINT_001B_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001B_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001B_PROVIDER_ROUTER_FOUNDATION.md`

## Accepted Sprint 001C Files

- `Modelfile.openclaw-phi3-mini`
- `docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT.md`
- `docs/OPENCLAW_LOCAL_MODEL_CAPACITY_AUDIT_CORRECTED.md`
- `docs/OPENCLAW_SPRINT_001C_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001C_CAPACITY_GATE_DECISION.md`
- `docs/OPENCLAW_SPRINT_001C_MODEL_PULL_SMOKE_TEST.md`
- `docs/OPENCLAW_SPRINT_001C_PHI_GGUF_IMPORT_REPORT.md`

## Accepted Sprint 001D Files

- `lib/providers/local_llm_policy.cjs`
- `scripts/check_local_llm_policy.cjs`
- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `docs/OPENCLAW_SPRINT_001D_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001D_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001D_OLLAMA_ONLY_POLICY.md`

## Accepted Sprint 001E Files

- `lib/providers/ollama_inference_adapter.cjs`
- `scripts/smoke_ollama_inference_adapter.cjs`
- `dashboard.cjs`
- `docs/OPENCLAW_SPRINT_001E_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001E_CONTROLLED_OLLAMA_INFERENCE_ADAPTER.md`
- `docs/OPENCLAW_SPRINT_001E_FINAL_ACCEPTANCE.md`

## Accepted Sprint 001F Files

- `lib/providers/ollama_golden_prompts.cjs`
- `scripts/test_ollama_inference_safety_harness.cjs`
- `docs/OPENCLAW_SPRINT_001F_BOARD_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_FINAL_ACCEPTANCE.md`
- `docs/OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md`
- `docs/OPENCLAW_SPRINT_001F_LOCAL_INFERENCE_SAFETY_HARNESS.md`

## Generated Reports

- `docs/AUDNZD_H1_CSV_PREFLIGHT.md`
- `docs/AUDNZD_H1_MT5_INGESTION_REPORT.md`
- `docs/REAL_CAMPAIGN_001_EXPERT_POSTMORTEM.md`
- `docs/campaign_001_results.md`
- `docs/real_campaign_001_results.md`
- `docs/OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md`
- `docs/OPENCLAW_SPRINT_001G_WORKTREE_INVENTORY.md`
- `docs/OPENCLAW_SAFE_COMMIT_PLAN.md`
- `docs/OPENCLAW_LOCAL_AI_SAFETY_INVENTORY.md`
- `docs/OPENCLAW_SPRINT_001G_REPO_HYGIENE_REPORT.md`

## Repo Hygiene / Ignore Files

- `.gitignore`
- `.gitignore.backup.before-secret-hardening`
- `.env.example`
- `tsconfig.openclaw.json`
- `tsconfig.openclaw.backup.before-tighten.json`

`.gitignore` now includes protections for `.env.*`, `telegram.env`, `env_vars_export.txt`, `logs/`, archived logs, backups, forensic logs, legacy handoff folders, and local market-data CSV files.

## Potentially Unrelated Files

- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
- `lib/execution/live_trade_engine.cjs`
- `lib/execution/startup_reconciliation.cjs`
- `lib/mt5/mt5_bridge.py`
- `lib/database/PostgresOrchestrator.ts`
- `lib/execution/*.ts`
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

These files are not part of the accepted local Ollama provider foundation and require separate review before staging.

## Must-Review-Before-Commit Files

- `.env.example` because it changed environment template scope.
- `.gitignore` because it changes repository-wide ignore behavior.
- `dashboard.cjs` because it includes local AI endpoints and unrelated campaign API additions in the same diff.
- `dashboard-ui/src/api.js` because it includes local AI helpers and unrelated paper/research helpers in the same diff.
- `dashboard-ui/src/pages/Providers.jsx` because it includes accepted read-only local AI UI additions.
- `package.json` because dependency changes are broader than local AI visibility.
- `scheduler.cjs` because it adds a daily export job.
- `direct_seeder.cjs` because it changed outside local AI scope.
- `lib/execution/live_trade_engine.cjs`, `lib/execution/startup_reconciliation.cjs`, and `lib/mt5/mt5_bridge.py` because MT5/live execution paths are explicitly outside current sprint scope.
- `lib/strategies/Candidate001_AUDNZD.ts` because Strategy V2 remains blocked.
- All `sql/*.sql` files because DB schema changes are blocked for this safety lane.

## Must-Not-Commit Files

- `telegram.env`
- `env_vars_export.txt`
- `.env` or `.env.*` files except `.env.example`
- `logs/**`
- `data/*.json` and `data/*.jsonl` runtime snapshots unless separately approved
- `msg_locks/*.lock`
- `lib/research/data/csv/*.csv`
- `OPENCLAW_CHATGPT_HANDOFF_CURRENT/`
- `OPENCLAW_CHATGPT_HANDOFF_CURRENT.zip`
- Any file containing real credentials, tokens, database URLs, bot tokens, or private service keys

## Secret-Risk Files Observed

- `.env.example` is present and contains credential-shaped keys with blank/template values.
- `telegram.env` is present and contains credential-shaped keys. Values were not printed.
- `env_vars_export.txt` is present and contains credential-shaped keys. Values were not printed.
- `.gitignore.backup.before-secret-hardening` is present and should be manually reviewed before any decision to stage.

## Worktree Readiness

The local AI sprint files are coherent and accepted, but the full worktree is not safe to stage wholesale.

Do not run `git add .`.
