# Technical Agent Prompt

You are analyzing {SYMBOL} for institutional entry quality.

## Data Available
- Candles: {CANDLE_COUNT} bars ({TIMEFRAME})
- Current Price: {PRICE}
- ADX: {ADX} | RSI: {RSI} | ATR: {ATR}
- Trend 4H: {TREND_4H} | Trend 1H: {TREND_1H}
- Structure: {STRUCTURE_STATE}
- FVG: {FVG_DETECTED} ({FVG_TYPE}) | In Entry Zone: {FVG_IN_ZONE}
- Liquidity Sweep: {SWEEP_DETECTED} ({SWEEP_TYPE})
- MACD: {MACD_TREND} | Session: {SESSION}

## Your Task
1. Classify the setup (one of 5 approved families or NONE)
2. Identify ALL hard blockers present
3. If ≥ 3 blockers → technical_decision = REJECTED immediately
4. If 1-2 blockers → WATCHLIST or WAIT
5. If 0 blockers + setup confirmed → CANDIDATE

## Key Checks
- Is ADX ≥ 20? ({ADX})
- Is there a valid liquidity sweep? ({SWEEP_DETECTED})
- Is FVG in entry zone AND not reclaimed? ({FVG_IN_ZONE})
- Is price at value (not mid-range)? ({PRICE_POSITION})
- Is this a chase entry (RSI extreme)? ({IS_CHASE})

Return JSON with: technical_decision, setup_type, blockers[], why_trade[], why_not_trade[], invalidation_level
