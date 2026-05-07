# QA Test Checklist

## Signal Logic Tests
- [ ] Valid BUY: Score ≥ 85, all gates pass, R:R ≥ 1.8 → VERIFIED_ACTIVE
- [ ] Valid SELL: Score ≥ 85, bearish setup, all gates pass → VERIFIED_ACTIVE
- [ ] WAIT (score): Score 60-74 → WAIT output
- [ ] WAIT (veto): Score 80 but R:R < 1.8 → forced WAIT
- [ ] WATCHLIST: Setup exists but trigger not ready → VERIFIED_WATCHLIST
- [ ] REJECTED (setup): No approved setup type matches → REJECTED
- [ ] Weak ADX block: ADX < 20 for trend setup → block or downgrade
- [ ] Overbought chase: RSI > 80 for BUY → veto fires
- [ ] Poor R:R: R:R 1.2 → hard veto, never bypassed
- [ ] Event risk lockout: FOMC imminent → force WAIT
- [ ] Missing invalidation: No clear SL → REJECTED

## News Filter Tests
- [ ] "GBP PMI data" → does NOT trigger OIL BUY (relevance < 40)
- [ ] "Office leasing report" → IGNORE (blacklisted)
- [ ] "Gold surges on CPI miss" → XAUUSD SIGNAL_CANDIDATE (relevance ≥ 70)
- [ ] "Bitcoin ETF approved" → BTCUSD SIGNAL_CANDIDATE
- [ ] "Sports scores" → IGNORE
- [ ] Old headline (12h) → recency decay reduces score

## Provider Failure Tests
- [ ] Binance timeout → fallback to CoinGecko
- [ ] CoinGecko timeout → cached data with stale warning
- [ ] Yahoo malformed → graceful fallback
- [ ] LM Studio timeout → rule-based explanation
- [ ] Supabase insert fail → JSON queue failover
- [ ] Telegram send fail → retry plain text
- [ ] QuickChart fail → text indicator summary

## System Behavior Tests
- [ ] PM2 restart → bot reconnects, commands work
- [ ] /health → shows provider count, errors, AI mode
- [ ] /status → uptime, memory, error count
- [ ] /providers → free health + paid placeholder status
- [ ] /features → 10 feature flags displayed
- [ ] /logs → structured run logs (admin only)
- [ ] /analyze SYMBOL → formatted output (no [object Object])
- [ ] /regime SYMBOL in VOLATILE → says WAIT, watchlist only
- [ ] /newsignals → filtered, no false-positive BUY/SELL
- [ ] Dashboard at localhost:3737 → loads all panels
- [ ] Netlify site → prices, F&G, trending load

## Learning Tests
- [ ] Weekly review with < 10 outcomes → "insufficient data" warning
- [ ] Weight adjustment capped at ±2 per category
- [ ] Total weights stay at 100
- [ ] Recommendations logged, not auto-applied
- [ ] /weeklyreview → formatted report

## Schema Tests
- [ ] SUPABASE_SCHEMA_PATCH_V4.sql → runs without error
- [ ] Re-running patch → no errors (IF NOT EXISTS)
- [ ] Missing columns → admin warning, not crash
