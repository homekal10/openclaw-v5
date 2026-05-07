# News Filter v3.3 Spec — OpenClaw v3.3

## Classification Tiers

| Tier | Score Range | Description |
|------|-------------|-------------|
| `IGNORE` | 0–9 | Irrelevant, blacklisted, or no asset match |
| `CONTEXT_ONLY` | 10–29 | Low-relevance macro; background info only |
| `WATCHLIST_CANDIDATE` | 30–49 | Moderate relevance; monitor but no action |
| `SIGNAL_CANDIDATE` | 50–74 | High relevance; may confirm technical setup |
| `VERIFIED_SIGNAL` | 75–100 | Direct match + high-quality source + macro event |

**Hard Rule:** No tier below `SIGNAL_CANDIDATE` can contribute to a BUY/SELL signal.
Even `VERIFIED_SIGNAL` requires technical confirmation.

## Scoring Breakdown

| Factor | Max Points |
|--------|------------|
| Direct asset mention | +20 |
| Ticker/synonym match | +15 |
| Source quality (tier A/B/C) | +10 |
| Macro category match | +10 |
| Keyword proximity score | +10 |
| Transmission path validity | +8 |
| Event relevance | +8 |
| Recency (within 1h) | +5 |
| Duplicate penalty | –20 |
| Blacklist penalty | –100 (floor 0) |
| False-positive penalty | –10 |

## Hard Filtering Rules
- No news-only BUY/SELL under any circumstances.
- No macro headline becomes a trade without technical structure confirmation.
- No `WAR`, `FED`, `OIL` keyword match without transmission path validation.
- No random equity headline enters XAUUSD or BTC context.

## Rwanda Panel Strict Filter

### ALLOW
- Rwanda Finance, BNR (National Bank of Rwanda)
- MINECOFIN, RDB (Rwanda Development Board)
- EAC (East African Community) policy
- IMF Rwanda-specific releases
- Rwanda credit ratings (Moody's, Fitch, S&P on Rwanda)
- Rwanda fiscal/monetary policy
- Rwanda/EAC commodity relevance (tea, coffee, minerals)

### REJECT
- Unrelated global corporate news
- Generic earnings (non-Rwanda entities)
- Random equity headlines
- Non-Rwanda global noise
- Any headline without "Rwanda" or verified EAC context

## Duplicate Detection
- MD5 hash of normalized headline text.
- Duplicate within 6h window → `IGNORE` regardless of score.
- Duplicate within 24h → –10 penalty applied.

## Source Quality Tiers
| Tier | Sources | Bonus |
|------|---------|-------|
| A | Reuters, AP, Bloomberg, FT | +10 |
| B | CNBC, MarketWatch, WSJ | +7 |
| C | CoinDesk, CryptoSlate | +4 |
| D | Unknown blogs, social | 0 |
