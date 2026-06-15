# OpenClaw Commit Risk Register

## Secret-Risk Tracked Files

- `.env.example`
- `telegram.env`
- `env_vars_export.txt`

Risk: credential-shaped keys are present. Values were not printed during audit.

Recommended next action: keep `telegram.env` and `env_vars_export.txt` out of staging. Review `.env.example` manually to confirm it contains placeholders only.

## Log And Runtime-State Files

- `logs/**`
- `data/*.json`
- `data/*.jsonl`
- `msg_locks/*.lock`

Risk: generated runtime state, large tracked log churn, and many visible deletions. These can overwhelm the commit and may leak operational details.

Recommended next action: do not stage. Create a separate log hygiene sprint if tracked logs must be removed from version control.

## MT5 / Live Execution Files

- `lib/execution/live_trade_engine.cjs`
- `lib/execution/startup_reconciliation.cjs`
- `lib/mt5/mt5_bridge.py`
- `lib/execution/*.ts`

Risk: live execution and MT5 paths are explicitly outside the accepted local AI lane. MT5 live execution remains blocked.

Recommended next action: do not stage with local AI work. Review separately under a live-execution safety sprint.

## Strategy Files

- `lib/strategies/Candidate001_AUDNZD.ts`

Risk: Strategy V2 and Candidate001_AUDNZD_V2 remain blocked.

Recommended next action: do not stage.

## SQL / Schema Files

- `sql/v24_research_operations.sql`
- `sql/v37_research_governance.sql`
- `sql/v38_research_factory.sql`
- `sql/v5_trade_consensus_audit.sql`
- `sql/v6_durable_consensus.sql`
- `sql/v7_risk_governance.sql`
- `sql/v8_core_hardening.sql`

Risk: database schema changes are blocked in this lane.

Recommended next action: do not stage. Review only in a DB migration sprint.

## Package / Runtime Entrypoint Files

- `package.json`
- `scheduler.cjs`
- `direct_seeder.cjs`
- `dashboard.cjs`

Risk: dependency, scheduler, seeder, and route-owner changes can alter runtime behavior beyond local AI visibility.

Recommended next action: review manually and stage only explicitly approved hunks.

## Dashboard Provider Files

- `dashboard-ui/src/api.js`
- `dashboard-ui/src/pages/Providers.jsx`

Risk: accepted read-only local AI visibility is mixed with existing provider-key UI and possibly unrelated additions.

Recommended next action: human review before staging. Confirm no UI inference run button was added.

## No Destructive Commands

Do not run:

- `git add .`
- `git reset`
- `git clean`
- `git rm`
- broad delete commands

No destructive command was run during Sprint 001H.
