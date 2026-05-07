# Changelog v3.4 Expert Intelligence Edition

**Released:** 2026-05-03
**From:** v3.3 Institutional Intelligence (238 tests)
**To:** v3.4 Expert Intelligence Edition (395 tests)

---

## New Modules

### 	est_seed.cjs
Seeds 7 snapshot types for testing. Never pollutes production.

### lib/providers/provider_router.cjs
Smart provider routing: free-first, health-aware, quota-tracked fallback.

### lib/indicators/indicator_intelligence.cjs
Enriches all indicators with squeeze/expansion/exhaustion/regime states.
Generates timing-only confluence summary. Never approves trades alone.

### lib/policy/auto_update_policy.cjs
Policy engine: 6 auto-apply categories, 10 manual-approval categories.
Full JSONL audit trail + pending approvals queue.

### lib/replay/replay_engine.cjs
Re-runs historical signals through current logic. Never republishes.

### lib/replay/backtest_engine.cjs
Simulates TP/SL against candle data. MFE/MAE calculation.
Always labeled APPROXIMATE — NOT LIVE PERFORMANCE.

---

## Enhanced Modules

### 	radingagents_bridge.cjs
- Snapshot injection (INDICATOR, NEWS, FEARGREED)
- agent_runs tracking per agent (model, latency, success)
- Stale input detection → confidence reduction
- AiAnalysisSnapshot saved after every run
- Confidence bar in Telegram output

### lib/verification/signal_verifier.cjs
- 2 new setup types: asian_range_break, liquidity_grab_reversal
- Gate G14: score-only prevention
- Gate G15: indicator-only prevention
- 8-layer conditions summary in output
- needed_confirmation + invalidation_level exported

### lib/learning/learning-engine.cjs
- getLearningStatus() — maturity + safety locks
- getModelScore() — agent performance metrics
- validateWeightChange() — ±2/week guard
- Safety locks: never remove vetoes, never activate broker

### lib/snapshots/snapshot_store.cjs
- REPLAY_RESULT type (1h TTL)
- BACKTEST_RESULT type (1h TTL)
- Total: 17 snapshot types

### smart_health.cjs
- 8 new watchdog detectors
- 3 new self-healing functions

### dashboard.cjs
- CSP + security headers
- sanitizeSymbol()
- /api/v4/provider-router endpoint
- /api/v4/snapshots/seed-test endpoint

### 	elegram_bot.cjs
- Rate limiter: 5 cmd/60s per user
- sanitizeTicker() for all symbol args
- 10 new commands: /learningstatus, /modelscore, /applylearning,
  /replay, /backtest-recent, /securitystatus, /ratelimits,
  /schema, /backupstatus, /indicatorscore

---

## Test Suite
- **Before:** 238 tests (v3.3)
- **After:** 395 tests (v3.4)
- **Added:** 157 new tests
- **Failed:** 0
- **Grade:** 🏆 PERFECT

---

## Breaking Changes
None. All v3.3 functionality preserved.

## Rollback
Restore from git or backup before applying any v3.4 files.
