# Snapshot Truth Layer Spec — OpenClaw v3.3

## Principle
The snapshot store (`lib/snapshots/snapshot_store.cjs`) is the **only** source of truth
for all data across Telegram, Dashboard, and Scheduler. No module may invent live truth.

## Schema — Every Snapshot
```js
{
  id:               string,   // UUID
  run_id:           string,   // UUID shared across same pipeline run
  symbol:           string|null,
  timeframe:        string|null,
  source_provider:  string,
  source_timestamp: ISO8601|null,
  created_at:       ISO8601,
  updated_at:       ISO8601,
  cache_age_seconds: number,
  stale:            boolean,
  stale_level:      'FRESH' | 'STALE' | 'EXPIRED',
  fallback_used:    boolean,
  payload:          object,    // the actual data
  warnings:         string[],
  errors:           string[]
}
```

## TTL Registry (THRESHOLDS in snapshot_store.cjs)
| Type | TTL | Notes |
|------|-----|-------|
| MARKET | 60s | Price ticks expire fast |
| CANDLE | 60s | Shared by chart + indicators |
| INDICATOR | 300s | Computed from candles |
| SIGNAL | 300s | Orchestrator output |
| ANALYSIS | 3600s | AI 4-agent pipeline |
| MACRO | 900s | Global macro regime |
| NEWS | 600s | Headline feed |
| FEARGREED | 3600s | CoinGecko index |
| PROVIDER | 300s | Provider health poll |
| APIUSAGE | 60s | Call counter |
| HEALTH | 120s | System health |
| CRYPTO_TRENDING | 300s | CoinGecko trending |
| CRYPTO_TOP | 180s | CoinGecko top coins |
| STRATEGY_ROUTE | 120s | Strategy classification |
| VETO_STATS | 300s | Veto decomposition stats |

## Staleness Rules
- `stale = cache_age_seconds > THRESHOLD[type]`
- `stale_level`:
  - `FRESH`: age ≤ threshold
  - `STALE`: age ≤ threshold × 2
  - `EXPIRED`: age > threshold × 2
- No `EXPIRED` or `STALE` snapshot may be labeled `LIVE` in any UI component.

## Write Pattern
```js
snapStore.put(type, symbol, timeframe, payload, { provider, source_timestamp });
```

## Read Pattern
```js
const snap = snapStore.get(type, symbol); // null if never written
if (!snap || snap.stale) { /* show stale badge or trigger refresh */ }
```

## Enforcement
- Dashboard JS checks `stale` field on every panel render.
- Telegram bot checks snapshot freshness before using grounding data.
- Smart health checks all types for EXPIRED status every 60s.
