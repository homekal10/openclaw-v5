# OpenClaw v4.0 — System Upgrade Plan

## Architecture (12 Layers)

1. **Ingestion** — Binance, CoinGecko, Yahoo, Reddit, RSS, Rwanda
2. **Provider Adapter** — Free active, 16 paid placeholders disabled
3. **Normalization** — Raw data → stable internal formats
4. **Cache** — Candles, indicators, news, macro, crypto, health
5. **Scoring** — 8-layer institutional (Trend 20, Liquidity 20, FVG 20, Momentum 10, Session 10, Macro 10, Risk 10)
6. **Verification** — 13-gate signal verifier
7. **Veto** — 17 hard rules (R:R < 1.8, no SL, chase entry, etc.)
8. **Synthesis** — BUY/SELL/WAIT/WATCHLIST/REJECTED
9. **Persistence** — Supabase + SQLite + JSON failover
10. **Delivery** — Telegram + Dashboard API + Netlify
11. **Learning** — Weekly bounded review, max ±2 weight adjustment
12. **Observability** — run_id, structured errors, provider health

## Modules: 33 root + 31 lib = 64 total (~580KB)

## Phases Completed
- Phase 1: Expert news filter, regime fix, AI formatter ✅
- Phase 2: Data contracts, run_id correlation, CORS ✅
- Phase 3: Pattern routing active/watchlist/avoid ✅
- Phase 4: 16 paid placeholders, feature flags ✅
- Phase 5: /providers, /features, /logs commands ✅
- Phase 6: Supabase schema patch, 10 documentation files ✅
