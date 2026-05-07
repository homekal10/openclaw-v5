# Test Plan v3.3 — OpenClaw v3.3

## Result Summary
```
🏆 PERFECT
238 passed | 0 failed | 8 skipped (246 total)
```

Executed: `node test_runner.cjs` against `http://localhost:3737`

---

## Test Suites

### 1. 📦 Snapshot Store (9 tests)
| Test | Status |
|------|--------|
| snapStore.put exists | ✅ |
| snapStore.get exists | ✅ |
| snapStore.getSyncHealth exists | ✅ |
| put/get roundtrip | ✅ |
| run_id generated | ✅ |
| cache_age computed | ✅ |
| stale_level computed: FRESH | ✅ |
| getSyncHealth returns array | ✅ |
| 15 snapshot types defined | ✅ |

### 2. 📰 News Filter (9 tests)
| Test | Status |
|------|--------|
| Gold headline scores high for XAUUSD | ✅ |
| iPhone headline filtered for XAUUSD | ✅ |
| FOMC macro event detected | ✅ |
| Transmission path validated | ✅ |
| Blacklisted topic ignored | ✅ |
| classifyHeadline: SIGNAL_CANDIDATE | ✅ |
| asset_relevance populated | ✅ |
| Duplicate detected | ✅ |
| canGenerateSignal exists | ✅ |

### 3. 🚩 Feature Flags (5 tests)
| Test | Status |
|------|--------|
| isEnabled exists | ✅ |
| 17 flags defined | ✅ |
| snapshot_store enabled | ✅ |
| paid_providers disabled (correct) | ✅ |
| 3 data flags | ✅ |

### 4. 🌐 Dashboard API Endpoints (19 tests)
All endpoints return HTTP 200. Verified: HTML, sync-health, snapshot-stats,
snapshot/HEALTH, news, signals, providers (31 entries), api-usage (17 quotas),
system health, feargreed, performance, rwanda, paid providers, run-logs, version.

### 5. 📊 Snapshot Population (10 tests, 4 skip)
Fresh snapshots: NEWS, HEALTH, PROVIDER, APIUSAGE, FEARGREED, MACRO.  
Skipped (on-demand): MARKET, INDICATOR, SIGNAL, ANALYSIS.

### 6. 📝 JS Syntax Validation (8 tests)
Dashboard JS extracted (49,774 chars). Validates: staleBadge, loadSyncHealth,
panelState, sync-status, freshness CSS, fresh-live, fresh-stale.

### 7. ⚡ Gold M1 Scalper (16 tests)
All indicator functions present. BB, Stochastic, AO computed correctly.
Insufficient-data guard triggers WAIT. Strategy tag correct. Telegram format OK.

### 8. 🔄 Freshness Enforcement (6 tests)
No stale data marked FRESH. Fear & Greed fresh. Analyses served from snapshot_store.

### 9. 📊 Candle Snapshot Sharing (7 tests, 2 skip)
CANDLE TTL = 60s. Chart + indicator endpoints return stale field.
Skipped: source field when no candles available.

### 10. 🎯 Expert Indicators (17 tests)
BB squeeze_state, pct_b, bandwidth. Stochastic K/D/zone. AO value/color.
ATR 0.5x/1.0x/1.5x. DI+/DI- values.

### 11. 📈 API Counter Extensions (4 tests)
lastSuccess tracked. caller tracking active. cache_hits + fallback_calls tracked.

### 12. 🔐 Auto-Update Guardrails (10 tests)
STRATEGY_WEIGHT autoApply=true, requiresApproval=false.
TRADING_LOGIC, VERIFIER_LOGIC, SCHEMA_MIGRATION, BROKER_EXECUTION blocked.
8 auto-apply types, 10 require approval.

### 13. 📦 Snapshot Store v2 (5 tests)
CANDLE roundtrip, UUID id, ANALYSIS threshold 3600s, sync health 15 types.

### 14. 📰 News Filter v2 (3 tests)
High-confidence gold/FOMC: SIGNAL_CANDIDATE (75). Proximity boost. Blacklist floor 0.

### 15. 🖥️ Dashboard JS v2 (12 tests)
Floating panel, control groups, chart status, active TF button, squeeze/expansion CSS,
indicator highlight/warn CSS, setTF(), currentTF, chart-updated, no `[object Object]`.

### 16. 🪙 Crypto Snapshot Backing (13 tests, 2 skip)
Trending + Top: stale, stale_level, source: coingecko, CRYPTO_TOP/CRYPTO_TRENDING
in snapshot store. Skipped: cache_age_seconds when CoinGecko rate-limited.

### 17. 🧭 Strategy Router v3.2 (25 tests)
getTimingConfirmation, getATRGuides, listStrategies exist. MAX_INDICATOR_BONUS=15,
MIN_RR=1.8. 7 strategies. Bonus range 0–15. ATR auto-veto at R:R < 1.8.
No direction/action in timing result.

### 18. 🔌 Provider Panel Metadata (12 tests)
providers is array, has status/calls_today/quota_pct/latency_ms/last_error.
16 inactive paid providers, none healthy. Summary total: 31.

### 19. 📡 Signal Ticker Freshness (7 tests)
allStale detection, 2h stale threshold, stale ticker warning text,
timeAgo in ticker, trend-updated, top-updated, cache_age_seconds in JS.

---

## New v3.3 Test Suites

### 20. 🧭 Strategy Router v3.3 (16 tests)
| Test | Status |
|------|--------|
| classifyStrategies exists | ✅ |
| getStrategySnapshot exists | ✅ |
| All strategies have session requirements | ✅ |
| classifyStrategies returns array | ✅ |
| 7 strategies classified | ✅ |
| All states valid (ACTIVE/WATCHLIST/AVOID) | ✅ |
| London Sweep ACTIVE/WATCHLIST in london_open | ✅ |
| NY Continuation AVOID in london_open | ✅ |
| All classifications have reason | ✅ |
| All have timing_label | ✅ |
| No strategy outputs BUY/SELL | ✅ |
| snapshot.session populated | ✅ |
| snapshot.active is array | ✅ |
| snapshot.watchlist is array | ✅ |
| snapshot.avoid is array | ✅ |
| Asian session: 7/7 AVOID | ✅ |

### 21. 🖥️ Strategy Dashboard Panel (11 tests)
| Test | Status |
|------|--------|
| /api/v4/strategy-router returns 200 | ✅ |
| strategies array present | ✅ |
| session field present | ✅ |
| 7 strategies in response | ✅ |
| strategy has state | ✅ |
| strategy has name | ✅ |
| strategy has reason | ✅ |
| strat-route-panel in HTML | ✅ |
| Strategy Router title in HTML | ✅ |
| loadStrategyPanel in JS | ✅ |
| strat-updated element present | ✅ |

### 22. ⛔ Veto Decomposition v3.3 (6 tests)
| Test | Status |
|------|--------|
| VETO_STATS type in sync health | ✅ |
| STRATEGY_ROUTE type in sync health | ✅ |
| veto-panel element in HTML | ✅ |
| PASS RATE label in veto panel | ✅ |
| BLOCKED label in veto panel | ✅ |
| loadVetoPanel in JS | ✅ |

### 23. 🏥 Smart Health v3.3 (8 tests)
| Test | Status |
|------|--------|
| detectVetoSpike exists | ✅ |
| detectPassRateAnomaly exists | ✅ |
| veto spike: no false alarm (no VETO_STATS data) | ✅ |
| pass-rate: no false alarm (no VETO_STATS data) | ✅ |
| health.warnings is array | ✅ |
| health.status is string | ✅ |
| snapshot.heapUsedMB present | ✅ |
| snapshot.errorRate present | ✅ |

### 24. 📦 Snapshot Consistency v3.3 (6 tests)
| Test | Status |
|------|--------|
| 15 snapshot types registered | ✅ |
| STRATEGY_ROUTE type registered | ✅ |
| VETO_STATS type registered | ✅ |
| CRYPTO_TRENDING type registered | ✅ |
| CRYPTO_TOP type registered | ✅ |
| No stale data marked FRESH | ✅ |

---

## Legitimate Skips (8 total)
| Skip | Reason |
|------|--------|
| MARKET snapshot | On-demand — requires `/signal` or `/analyze` |
| INDICATOR snapshot | On-demand |
| SIGNAL snapshot | On-demand |
| ANALYSIS snapshot | On-demand |
| chart source | No Binance candle data in test environment |
| indicators source | No Binance candle data |
| trending cache_age | CoinGecko rate-limited at test time |
| top cache_age | CoinGecko rate-limited at test time |

## Running the Suite
```powershell
cd C:\Users\Homekal\.antigravity\extensions\OpenClaw
node test_runner.cjs
```

> Dashboard must be running via PM2 before executing.
> `pm2 restart openclaw` after any code changes.

## Pass/Fail Criteria
- **0 failures** required for release.
- Skips are allowed **only** for on-demand snapshots and documented rate-limit conditions.
- Any new feature must add ≥3 new tests before merge.
