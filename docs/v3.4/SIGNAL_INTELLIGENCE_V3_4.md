# Signal Intelligence v3.4

## 8-Layer Institutional Model (preserved from v3.3)
1. Trend — bullish/bearish/ranging
2. Structure — HH/HL, LH/LL, breakout
3. Liquidity — pool swept, inducement
4. FVG — Fair Value Gap present/filled
5. Momentum — RSI divergence, MACD cross
6. Session — London/NY/Overlap
7. Macro — event risk, news filter
8. Risk — R:R ratio, invalidation level

## Approved Setup Types (7 — v3.4 adds 2)
- london_sweep_reversal
- ny_continuation
- ema_pullback_fvg
- range_sweep_trap
- trend_breakout_retest
- **asian_range_break** (NEW v3.4)
- **liquidity_grab_reversal** (NEW v3.4)

## New in v3.4: Gate G14 + G15
- G14: Score-alone prevention — no BUY/SELL from score only
- G15: Indicator-alone prevention — no BUY/SELL from indicator only

## 8-Layer Conditions Output (NEW v3.4)
`json
{
  "trend_condition": "bullish",
  "structure_condition": "HH/HL",
  "liquidity_condition": "detected",
  "fvg_condition": "present",
  "session_condition": "london",
  "macro_condition": "clear",
  "risk_condition": "R:R 2.50",
  "momentum_condition": "normal"
}
`

## Hard Rules (unchanged)
- R:R < 1.8 = hard veto (Gate G08)
- Stale data = hard veto (Gate G11)
- No stop = hard veto (Gate G09)
- Score < 60 = REJECTED
- Score < 75 = WAIT (not ACTIVE)
