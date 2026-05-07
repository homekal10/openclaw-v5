# Learning Mode Spec

## Tracked Metrics
| Metric | Source | Purpose |
|--------|--------|---------|
| Setup type win rate | trade_journal | Identify best/worst setups |
| Setup type avg R | trade_journal | Profitability per setup |
| Asset win rate | trade_journal | Asset-specific performance |
| Session win rate | trade_journal | Best trading sessions |
| FVG response quality | tracked_outcomes | FVG reliability per asset |
| Sweep failure rate | tracked_outcomes | Liquidity sweep accuracy |
| Overbought chase failures | tracked_outcomes | RSI extreme entry results |
| Weak ADX failures | tracked_outcomes | Trend strength correlation |
| Event-risk failures | tracked_outcomes | Macro event impact |
| WATCHLIST conversion rate | signals | Setup progression tracking |
| WAIT accuracy | signals | Wait signal quality |
| False-positive rate | signals vs outcomes | News filter effectiveness |

## Weekly Review Output
- Best setup type + worst setup type
- Best session + worst session
- Best asset + weakest asset
- Top veto reason
- Top overtrading pattern
- Recommended weight adjustment (max ±2 per category)
- Warning if sample size < 10 outcomes

## Bounded Rules
1. Never remove hard vetoes
2. Never allow AI to rewrite core scoring logic
3. Max ±2 points per category per week
4. Total scoring model must remain 100 points
5. All changes logged as recommendations unless admin applies
6. Prefer reducing false positives over increasing signal count
7. Min 10 outcomes before any recommendation
