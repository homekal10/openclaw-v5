# OpenClaw v4.0 Expert Edition — Changelog

## Release Date: 2026-05-03

### 🔴 CRITICAL FIXES

#### Confidence Cap (Phase 4)
- **FIXED**: AI analysis could output 100% confidence — now hard-capped at 88%
- Added `CONFIDENCE_CAP = 88` constant in `tradingagents_bridge.cjs`
- Missing news data: -15% confidence + warning "claims unverifiable"
- Missing source snapshots: -20% confidence + warning "analysis is speculative"

#### News Filter Cross-Contamination (Phase 5)
- **FIXED**: GBP/USD headlines were scoring OIL/XAUUSD as relevant
- Added cross-asset contamination guard: FX pair headlines blocked from unrelated commodities
- WAR keyword now requires actual conflict evidence (invasion, missile, troops, sanctions)
- Rwanda headlines capped at CONTEXT_ONLY (score ≤ 65, never SIGNAL_CANDIDATE)

#### Version Consistency (Phase 1)
- **FIXED**: `/start` said "v3.0 Expert" — now says "v4.0 Expert" everywhere
- Updated: telegram_bot.cjs (lines 46, 308, 346, 1515)
- Updated: dashboard.cjs header → "OpenClaw v4.0 Intelligence | EXPERT EDITION"
- Updated: smart_health.cjs → "Smart Health Monitor v4.0"

### 🟡 DASHBOARD TRUTH LAYER (Phase 2, 3, 8)

#### Stale/LIVE Badge Fix
- **RULE**: If `stale=true`, badge NEVER shows LIVE — shows ⚠ STALE or ❌ EXPIRED
- freshnessBadge() now checks `data.stale` field before age-based logic
- Fear & Greed already separates provider_timestamp vs fetch_timestamp

#### Panel Loading Fix
- panelState() now shows: source, last attempt, retry button
- New states: 'stale', 'nodata' (in addition to loading, error, empty, offline)
- Error/stale panels get ↻ Retry button that calls loadAll()

### 🟢 SCHEDULER HARDENING (Phase 9)

#### Job Timeout
- All jobs wrapped with `withTimeout()` — max 60s per job
- Jobs exceeding 30s logged as [SLOW]
- Jobs exceeding 60s safely aborted with [TIMEOUT] log

#### Overlap Guard
- `_jobLocks` prevents same job type from running concurrently
- Overlapping jobs logged as [SKIP] — no double-execution

#### Circuit Breaker
- `_circuitBreakers` tracks provider failures
- 3 failures in 15 minutes → provider paused for 5 minutes
- Auto-reset after pause window expires
- Exposed via `checkCircuitBreaker()`, `recordProviderFailure()`

### 🟢 SMART HEALTH v4.0 (Phase 10)

#### New Detectors
- `detectConfidenceCapViolation()` — scans ANALYSIS snapshots for confidence >88
- `detectStaleRefreshLoop()` — flags MACRO snapshot >2h old and still stale
- `detectNewsFalsePositive()` — detects GBP→OIL/XAUUSD cross-contamination
- `detectSchedulerTimeout()` — checks circuit breaker and job lock state

#### Health Output
- `/health` now includes v4.0 Watchdogs section
- All 4 new detectors integrated into `formatSmartHealth()`

### 📊 TEST SUITE

| Version | Tests | Passed | Failed | Skips |
|---------|-------|--------|--------|-------|
| v3.3    | 246   | 238    | 0      | 8     |
| v3.4    | 426   | 420    | 0      | 6     |
| **v4.0**| **458** | **452** | **0** | **6** |

#### New Test Functions (6)
- `testConfidenceCapV40` — 4 tests
- `testNewsFilterV40` — 6 tests
- `testVersionConsistencyV40` — 5 tests
- `testSmartHealthV40` — 6 tests
- `testSchedulerV40` — 6 tests
- `testDashboardTruthLayerV40` — 5 tests

### Safety Invariants (Preserved)
- `_trade_approval: false` on all indicator enrichment
- Signal verifier remains sole BUY/SELL authority
- 15 gates + 17 hard vetoes unchanged
- 0 paid providers active
- 0 broker connections
- 0 auto-trading
- All AI output is ADVISORY only
- Backtest results labeled APPROXIMATE
