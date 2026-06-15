# OpenClaw Sprint 001H Commit Boundary Isolation

## Purpose

Sprint 001H isolates the accepted local AI lane from unsafe or unrelated worktree changes.

No files were staged, committed, pushed, reset, cleaned, deleted, or removed.

## Accepted Safe Local AI Files

These files belong to the accepted Sprint 001A through 001F local AI lane and may be considered for explicit path-based staging after final human review:

- `lib/providers/local_llm_health.cjs`
- `lib/providers/local_llm_router.cjs`
- `lib/providers/local_llm_policy.cjs`
- `lib/providers/ollama_inference_adapter.cjs`
- `lib/providers/ollama_golden_prompts.cjs`
- `scripts/check_local_llm_health.cjs`
- `scripts/check_local_llm_router.cjs`
- `scripts/check_local_llm_policy.cjs`
- `scripts/smoke_ollama_inference_adapter.cjs`
- `scripts/test_ollama_inference_safety_harness.cjs`
- `Modelfile.openclaw-phi3-mini`
- accepted Sprint 001A through 001F documentation under `docs/OPENCLAW_SPRINT_001*.md`
- accepted local AI support documentation under `docs/OPENCLAW_LOCAL_*.md`

## Unsafe Files To Exclude

- `telegram.env`
- `env_vars_export.txt`
- `logs/**`
- `data/*.json`
- `data/*.jsonl`
- `msg_locks/*.lock`
- `lib/research/data/csv/*.csv`
- `lib/strategies/Candidate001_AUDNZD.ts`
- `lib/execution/live_trade_engine.cjs`
- `lib/execution/startup_reconciliation.cjs`
- `lib/mt5/mt5_bridge.py`
- `sql/*.sql`

## Manual-Review Files

- `.env.example`
- `.gitignore`
- `.gitignore.backup.before-secret-hardening`
- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
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
- `test_wave1_reliability.cjs`

## Must-Not-Stage Files

- `telegram.env`
- `env_vars_export.txt`
- any `.env` or `.env.*` file except `.env.example`
- all `logs/**` entries, including tracked deletions
- all runtime `data/*.json` and `data/*.jsonl` entries unless separately approved
- all `msg_locks/*.lock` entries
- local CSV market data under `lib/research/data/csv/*.csv`
- any real credential, token, database URL, bot token, or private service key

## Block Reasons By Risky Category

- Secret-risk files are blocked because real credentials must not be printed or committed.
- Log files are blocked because they are runtime state, very large, and include many tracked deletions.
- Runtime data files are blocked because they are generated state, not source.
- MT5/live execution files are blocked because live execution remains outside the accepted local AI lane.
- Strategy files are blocked because Strategy V2 and Candidate001_AUDNZD_V2 remain blocked.
- SQL files are blocked because DB schema changes are forbidden in this safety lane.
- Dashboard files require review because accepted local AI additions are mixed with unrelated campaign/paper-trading additions.
- Package/runtime entrypoint files require review because dependency and scheduler changes are broader than local AI provider safety.

## Boundary Decision

The commit boundary is now documented and separable.

This does not authorize staging, committing, or pushing.

Final verdict:

`SPRINT_001H_COMMIT_BOUNDARY_READY`
