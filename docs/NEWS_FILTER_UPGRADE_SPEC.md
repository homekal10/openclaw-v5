# News Filter Upgrade Spec

## Problem
Headlines like "GBP PMI data" were triggering OIL BUY signals. Office leasing headlines triggered XAUUSD BUY.

## Solution: Expert Relevance Engine
File: `lib/filters/expert_news_filter.cjs`

### Scoring (0-100)
| Factor | Weight | Description |
|--------|--------|-------------|
| Direct ticker mention | +40 | "gold", "bitcoin", "XAUUSD" in headline |
| Synonym match | +35 | "precious metal", "digital gold", etc. |
| Macro transmission path | +20 | CPI→XAUUSD (direct), CPI→BTCUSD (indirect +10) |
| Source quality | +3 to +15 | Reuters +15, Reddit +5 |
| Tagged asset match | +15 | Pre-tagged by collector |
| Recency decay | -2/hr | After 6 hours old |
| False-positive blacklist | IGNORE | "office leasing", "sports", etc. |

### Action States
| Score | Action | Can Generate Signal? |
|-------|--------|---------------------|
| 0-14 | IGNORE | ❌ |
| 15-39 | CONTEXT_ONLY | ❌ |
| 40-69 | WATCHLIST_CANDIDATE | ❌ (saved as intelligence) |
| 70-100 | SIGNAL_CANDIDATE | ✅ (if confidence ≥ 75) |

### Macro Transmission Paths
- CPI → XAUUSD, DXY, US30 (direct) | EURUSD, BTCUSD (indirect)
- FOMC → XAUUSD, DXY, US30, NAS100 (direct) | EURUSD, BTCUSD, OIL (indirect)
- NFP → DXY, XAUUSD, EURUSD (direct)
- PMI → EURUSD, GBPUSD, DXY (direct) — NOT OIL
- WAR → XAUUSD, OIL (direct) — only if genuinely geopolitical
- OPEC → OIL (direct)

### False-Positive Blacklist
office leasing, real estate, sports, entertainment, celebrity, restaurant, lifestyle, car review, fashion, pet, travel tips
