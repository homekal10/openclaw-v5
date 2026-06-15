# OpenClaw Safe Staging Manifest: Local AI Lane

## Safety Rule

Do not stage anything yet.

Do not run `git add .`.

## A. Safe Local AI Source Files

- `lib/providers/local_llm_health.cjs`
- `lib/providers/local_llm_router.cjs`
- `lib/providers/local_llm_policy.cjs`
- `lib/providers/ollama_inference_adapter.cjs`
- `lib/providers/ollama_golden_prompts.cjs`
- `Modelfile.openclaw-phi3-mini`

## B. Safe Local AI Scripts

- `scripts/check_local_llm_health.cjs`
- `scripts/check_local_llm_router.cjs`
- `scripts/check_local_llm_policy.cjs`
- `scripts/smoke_ollama_inference_adapter.cjs`
- `scripts/test_ollama_inference_safety_harness.cjs`
- `scripts/validate_audnzd_csv_contract.cjs`
- `scripts/validate_database_schema.cjs`

`validate_audnzd_csv_contract.cjs` and `validate_database_schema.cjs` are supporting validation scripts and should be reviewed before staging if they predate the local AI lane.

## C. Safe Local AI Docs

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

## D. Dashboard Local AI Visibility Files Requiring Review

- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`

Reason: these files contain accepted read-only local AI routes/UI, but current diffs also include unrelated additions. Stage only after human review or after the local AI hunks are isolated.

## E. Repo Hygiene Docs

- `docs/OPENCLAW_SPRINT_001G_WORKTREE_INVENTORY.md`
- `docs/OPENCLAW_SAFE_COMMIT_PLAN.md`
- `docs/OPENCLAW_LOCAL_AI_SAFETY_INVENTORY.md`
- `docs/OPENCLAW_SPRINT_001G_REPO_HYGIENE_REPORT.md`
- `docs/OPENCLAW_SPRINT_001H_COMMIT_BOUNDARY_ISOLATION.md`
- `docs/OPENCLAW_SAFE_STAGING_MANIFEST_LOCAL_AI.md`
- `docs/OPENCLAW_COMMIT_RISK_REGISTER.md`
- `docs/OPENCLAW_SPRINT_001H_VERIFICATION_REPORT.md`

## F. Must-Not-Stage Files

- `telegram.env`
- `env_vars_export.txt`
- `logs/.cd23b65dda8bbfa77a4993e524cb5103dede158d-audit.json`
- `logs/.f3d1e582ab2d223582aee80f7d08f9efe6efee1a-audit.json`
- `logs/.last_livesync_notify`
- `logs/.last_startup_notify`
- `logs/api_counters.json`
- `logs/bridge_log.txt`
- `logs/confidence_calibration.json`
- `logs/execution_log.txt`
- `logs/health_baseline.json`
- `logs/health_history.json`
- `logs/health_metrics.json`
- `logs/health_snapshots.jsonl`
- `logs/learned_patterns.json`
- `logs/model_performance.json`
- `logs/node_err.log`
- `logs/node_out.log`
- `logs/openclaw-*.log`
- `logs/openclaw-*.log.gz`
- `logs/openclaw-error-*.log`
- `logs/openclaw-error-*.log.gz`
- `logs/pm2_combined*.log`
- `logs/pm2_out*.log`
- `logs/pm2_error*.log`
- `logs/provider_health.jsonl`
- `logs/redis_sync.log`
- `logs/scheduler_log.txt`
- `logs/self_healing.jsonl`
- `logs/startup.log`
- `logs/trading_log.json`
- `logs/watchdog.log`
- `logs/watchdog.pid`
- `logs/watchdog__*.log`
- `logs/watchlist.json`
- `data/audit_log.jsonl`
- `data/headlines.json`
- `data/performance.json`
- `data/rwanda.json`
- `data/signals.json`
- `data/snapshots.json`
- `msg_locks/msg_8601.lock`
- `msg_locks/msg_8629.lock`
- `msg_locks/msg_8631.lock`
- `msg_locks/msg_8633.lock`
- `msg_locks/msg_8643.lock`
- `msg_locks/msg_8644.lock`
- `msg_locks/msg_8647.lock`
- `msg_locks/msg_8650.lock`
- `lib/strategies/Candidate001_AUDNZD.ts`
- `sql/v24_research_operations.sql`
- `sql/v37_research_governance.sql`
- `sql/v38_research_factory.sql`
- `sql/v5_trade_consensus_audit.sql`
- `sql/v6_durable_consensus.sql`
- `sql/v7_risk_governance.sql`
- `sql/v8_core_hardening.sql`

## G. Requires-Human-Review Files

- `.env.example`
- `.gitignore`
- `.gitignore.backup.before-secret-hardening`
- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
- `dashboard.cjs`
- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`
- `lib/execution/live_trade_engine.cjs`
- `lib/execution/startup_reconciliation.cjs`
- `lib/mt5/mt5_bridge.py`
- `lib/database/PostgresOrchestrator.ts`
- `lib/execution/BrokerQualityEngine.ts`
- `lib/execution/ConsensusLogger.ts`
- `lib/execution/ConsensusStates.ts`
- `lib/execution/ConsensusTypes.ts`
- `lib/execution/ExecutionAttributionEngine.ts`
- `lib/execution/ExecutionDecayEngine.ts`
- `lib/execution/ExecutionFSM.ts`
- `lib/execution/ExecutionIntelligenceEngine.ts`
- `lib/execution/LatencyAnalyticsEngine.ts`
- `lib/execution/LiquidityStressEngine.ts`
- `lib/execution/LiveExecutionCertificationEngine.ts`
- `lib/execution/OrderBookSimulationEngine.ts`
- `lib/execution/ReconciliationEngine.ts`
- `lib/knowledge/KnowledgeGraphEngine.ts`
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
- `tsconfig.openclaw.json`
- `tsconfig.openclaw.backup.before-tighten.json`
