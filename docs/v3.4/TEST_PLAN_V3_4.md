# Test Plan v3.4

## Total: 395 tests | 388 pass | 0 fail | 7 legitimate skips

## Test Suites (36 total)

### Core (v3.0-v3.2): 7 suites
- Snapshot Store, News Filter, Feature Flags, Dashboard Endpoints
- Snapshot Population, JS Syntax, Gold Scalper

### Phase 14 Extensions: 7 suites
- Freshness, Candle Sharing, Expert Indicators, API Counter Extensions
- Auto-Update Guardrails, Snapshot Store v2, News Filter v2, Dashboard JS v2

### v3.2 Suites: 4
- Crypto Snapshot Backing, Strategy Router, Provider Metadata, Signal Ticker Freshness

### v3.3 Suites: 8
- Strategy Router v3.3, Strategy Dashboard Panel, Veto Decomposition
- Smart Health v3.3, Snapshot Consistency, CoinGecko Backoff
- Dashboard UI, Snapshot Cache Hit Tracking

### v3.4 Sprint 1: 4 suites (41 tests)
- Seeded Snapshots (14), Provider Router (7), Smart Health v3.4 (14), Security (6)

### v3.4 Sprint 2+3: 4 suites (34 tests)
- AI Pipeline (8), Signal Intelligence (9), Learning Engine (11), Replay/Backtest (6)

### v3.4 Sprint 4: 3 suites (52 tests)
- Indicator Intelligence (27), Auto-Update Policy (14), Telegram Commands (11)

## Legitimate Skips (7)
1. MARKET snapshot — requires /signal trigger
2. INDICATOR snapshot — requires live market data
3. SIGNAL snapshot — requires active signal run
4. ANALYSIS snapshot — requires /analyze trigger
5. chart/indicator source — may skip without Binance candles
6. crypto cache age — may skip when CoinGecko rate-limited
7. candle snapshot sharing — partial without live data

## Release Requirement
- 0 failed tests
- Any new feature must add ≥3 tests
- Skips must be documented
