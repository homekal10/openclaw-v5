# Dashboard UX v3.3 — OpenClaw v3.3

## Panel Inventory

| Panel | ID | Source | Refresh |
|-------|-----|--------|---------|
| Signal Ticker | `signal-ticker` | `/api/signals/history` | 20s |
| Session Strip | `session-bar` | client UTC time | 10s |
| Rwanda Intel | `rwanda-panel` | `/api/rwanda` | 60s |
| News Feed | `news-panel` | `/api/news` | 20s |
| Fear & Greed | `fg-panel` | `/api/feargreed` | 20s |
| AI Analyses | `analyses-panel` | `/api/analyses` | 20s |
| System Health | `health-panel` | `/api/health` | 20s |
| Providers | `providers-panel` | `/api/providers` | 20s |
| Strategy Router | `strat-route-panel` | `/api/v4/strategy-router` | 60s ← **NEW v3.3** |
| Veto Decomposition | `veto-panel` | `/api/signals/history` | 60s |
| Event Risk | `event-risk-panel` | `/api/news` | 20s |
| Run Logs | `logs-panel` | `/api/v4/run-logs` | 20s |
| Feature Flags | `flags-panel` | `/api/v4/features` | 20s |
| API Usage | `api-usage-panel` | `/api/api-usage` | 20s |
| Chart Viewer | `chart-frame` | `/api/chart/:symbol` | on-demand |
| Indicators | `ind-grid` | `/api/indicators/:symbol` | on-demand |
| Crypto Trending | `trending-panel` | `/api/v4/crypto/trending` | 60s |
| Top Market Cap | `top-panel` | `/api/v4/crypto/top` | 60s |
| Signal History | `history-panel` | `/api/signals/history` | 60s |
| Trade Journal | `journal-panel` | `/api/journal` | 60s |

## Every Panel Must Show
- **Source label** (e.g. `coingecko`, `snapshot_store`, `ai-core`)
- **Last updated** timestamp or `timeAgo()`
- **Stale/Live badge** — no expired data labeled LIVE
- **Error/fallback state** when data unavailable

## Strategy Router Panel (NEW v3.3)
```
🧭 Strategy Router                    [12:34:05]
ACTIVE: 2  WATCHLIST: 3  AVOID: 2

Session: london_open | Regime: BULLISH

🟢  London Sweep Reversal     ACTIVE
    Session ✅ structure ✅ timing CONFIRMED

🟡  EMA Pullback + FVG        WATCHLIST
    Session ✅ regime ✅ FVG not confirmed yet

🔴  Asian Range Break         AVOID
    Session: NY — wrong session for this setup
```

## Veto Decomposition Panel
```
⛔ Veto Decomposition          [12:34:05]
  47%         23          26
PASS RATE    BLOCKED     PASSED

TOP REJECTION REASONS
R:R < 1.8            ████████ 8
No setup type        ██████   6
Chase entry          ████     4
Stale data           ███      3
```

## Chart UI Controls
- Symbol selector (dropdown + free text)
- Timeframe selector: M1 M5 M15 H1 H4 D1
- Indicator toggles: EMA | BB | VWAP | RSI | MACD | Stoch | AO | ATR
- Strategy overlay selector (optional)
- Refresh button
- Stale badge if candle data > 60s

## Stale/Live Badge Rules
| Condition | Badge |
|-----------|-------|
| age ≤ TTL | 🟢 LIVE |
| age ≤ TTL × 2 | 🟡 STALE |
| age > TTL × 2 | 🔴 EXPIRED |
| Never fetched | ⚫ NO DATA |

## No Raw Objects
- All panels render via `safeRender()` which stringifies unknown types.
- `[object Object]` appearing in HTML → test failure.
- Verified: `No [object Object] in rendered HTML` — ✅ passing.

## Mobile / Responsive
- Grid breakpoints: 320px → 1 col, 768px → 2 col, 1200px → 3 col
- Panels collapse gracefully on small screens
- Font: JetBrains Mono (monospace data) + system sans (labels)
