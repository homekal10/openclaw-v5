# Signal Verifier Spec

## Verification States
- **VERIFIED_ACTIVE** → May become BUY/SELL (only state that can)
- **VERIFIED_WATCHLIST** → Setup exists but trigger not ready
- **WAIT** → Conditions forming, patience required
- **REJECTED** → No valid trade, do not enter

## 13 Verification Gates
| # | Gate | Pass Condition |
|---|------|---------------|
| 1 | Setup type match | Maps to 1 of 7 approved setups |
| 2 | Trend valid | 4H/1H EMA alignment exists |
| 3 | Structure valid | HH/HL or LH/LL confirmed |
| 4 | Liquidity context | Sweep or pool identified |
| 5 | FVG/retest valid | Imbalance present when required |
| 6 | Session appropriate | London/NY/Overlap for setup type |
| 7 | Macro risk acceptable | No CPI/FOMC/NFP imminent |
| 8 | R:R valid | >= 1.8 minimum |
| 9 | Invalidation clear | Defined stop loss level |
| 10 | Chase detection | Not entering extreme RSI/extended |
| 11 | Data freshness | Candles < 60s old, news < 5min |
| 12 | Provider health | Required providers responding |
| 13 | Veto pass | No hard vetoes fired |

## 7 Approved Setup Types
1. London Sweep Reversal
2. NY Continuation
3. EMA Pullback + FVG
4. Range Sweep Trap
5. Trend Breakout Retest
6. Asian Range Break
7. Liquidity Grab Reversal

## Publication Rule
Only VERIFIED_ACTIVE → BUY/SELL. Everything else stays as-is.
