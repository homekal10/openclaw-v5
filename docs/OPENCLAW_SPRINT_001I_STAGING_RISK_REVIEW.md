# OpenClaw Sprint 001I Staging Risk Review

## Why `telegram.env` Is Excluded

`telegram.env` is an env-like file and contains credential-shaped keys. Secret values were not printed.

It must not be staged.

## Why `env_vars_export.txt` Is Excluded

`env_vars_export.txt` is an exported environment file and contains credential-shaped keys. Secret values were not printed.

It must not be staged.

## Why Logs, Data, And Runtime Files Are Excluded

`logs/**`, `data/*.json`, `data/*.jsonl`, and `msg_locks/*.lock` are runtime state.

They are noisy, may include operational detail, and include many tracked modifications/deletions. They are not source for the local AI lane.

They must not be staged.

## Why MT5 / Live Execution Files Are Excluded

MT5 live execution remains blocked.

Files such as `lib/execution/live_trade_engine.cjs`, `lib/execution/startup_reconciliation.cjs`, `lib/mt5/mt5_bridge.py`, and `lib/execution/*.ts` affect live execution or execution governance and require a separate safety sprint.

They must not be staged with local AI work.

## Why Strategy Files Are Excluded

Strategy V2 remains blocked.

`lib/strategies/Candidate001_AUDNZD.ts` must not be staged or implemented as part of this lane.

## Why SQL Files Are Excluded

Database schema changes are forbidden in this safety lane.

All `sql/*.sql` files are excluded until a dedicated DB migration review.

## Why Dashboard Files Require Final Review

`dashboard.cjs`, `dashboard-ui/src/api.js`, and `dashboard-ui/src/pages/Providers.jsx` include accepted read-only local AI visibility.

However, current diffs may also include unrelated campaign, paper-trading, or existing provider-key UI changes. A human should review or isolate hunks before staging.

## Why `package.json`, `direct_seeder.cjs`, And `scheduler.cjs` Require Separate Review

These files affect runtime dependencies, seeding, and scheduling behavior.

They are broader than the accepted local AI lane and should be reviewed under a separate runtime-change plan.

## Summary

The first local-AI checkpoint commit should remain narrow and explicit.

No broad staging commands are safe in the current worktree.
