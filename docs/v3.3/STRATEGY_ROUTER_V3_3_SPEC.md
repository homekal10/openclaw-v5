# Strategy Router v3.3 Spec — OpenClaw v3.3

## Overview
Strategy classification is **read-only and observational**. It cannot generate
BUY/SELL signals. Its output feeds the dashboard and aids the orchestrator context.

## 7 Strategies

### 1. London Sweep Reversal (`london_sweep_reversal`)
- **Sessions:** london_open, london
- **Regimes:** BULLISH, BEARISH, VOLATILE
- **Structures:** liquidity_sweep, market_structure_shift
- **BB:** pct_b > 0.8 (overbought) or < 0.2 (oversold)
- **Stoch:** k < 20 or k > 80
- **AO:** flip = true
- **Avoid:** RANGE regime, asian session

### 2. NY Continuation (`ny_continuation`)
- **Sessions:** ny, ny_overlap
- **Regimes:** BULLISH, BEARISH
- **Structures:** trend, market_structure_shift
- **BB:** squeeze_state = EXPANSION
- **AO:** value > 0 (LONG) or < 0 (SHORT), color aligned
- **Avoid:** RANGE, CONSOLIDATING, london_only

### 3. EMA Pullback + FVG (`ema_pullback_fvg`)
- **Sessions:** london, ny, london_open, ny_overlap
- **Regimes:** BULLISH, BEARISH
- **Structures:** fvg, retest
- **BB:** price at middle band (pct_b 0.4–0.6)
- **Stoch:** neutral zone
- **Avoid:** RANGE, asian, mid_range price

### 4. Range Sweep Trap (`range_sweep_trap`)
- **Sessions:** any
- **Regimes:** RANGE, CONSOLIDATING
- **Structures:** liquidity_sweep
- **BB:** pct_b > 0.95 or < 0.05
- **Stoch:** k > 80 or k < 20
- **Avoid:** BULLISH, BEARISH trending regimes

### 5. Trend Breakout Retest (`trend_breakout_retest`)
- **Sessions:** london, ny, london_open
- **Regimes:** BULLISH, BEARISH
- **Structures:** trend, retest
- **BB:** squeeze_state = EXPANSION (expanding bandwidth)
- **AO:** color aligned with direction
- **Avoid:** RANGE, consolidation, SQUEEZE BB

### 6. Asian Range Break (`asian_range_break`)
- **Sessions:** asian, london_open
- **Regimes:** RANGE, CONSOLIDATING
- **Structures:** breakout
- **BB:** bandwidth < 0.003 (tight range)
- **Stoch:** k 40–60 (mid-range)
- **Avoid:** already trending, EXPANSION state

### 7. Liquidity Grab Reversal (`liquidity_grab_reversal`)
- **Sessions:** any
- **Regimes:** any
- **Structures:** liquidity_sweep, market_structure_shift
- **Stoch:** k > 85 or k < 15
- **AO:** flip = true
- **Avoid:** no liquidity grab present

## Classification Logic
```
ACTIVE:    session ✅ + regime ✅ + ≥1 structure requirement met + timing ≥ PARTIAL
WATCHLIST: session ✅ + regime ✅ + structures incomplete or timing UNCONFIRMED
AVOID:     wrong session || wrong regime || invalidation triggered
```

## Router Output
```js
{
  session:    string,
  regime:     string,
  timestamp:  ISO8601,
  strategies: [
    {
      key:          string,
      name:         string,
      state:        'ACTIVE' | 'WATCHLIST' | 'AVOID',
      reason:       string,       // human-readable explanation
      timing_label: string,       // CONFIRMED / PARTIAL / UNCONFIRMED
      sessions:     string[],
      structures:   string[]
    }
  ],
  active:    string[],    // keys of ACTIVE strategies
  watchlist: string[],    // keys of WATCHLIST strategies
  avoid:     string[]     // keys of AVOID strategies
}
```

## Hard Rules
- No strategy outputs `direction`, `action`, `buy`, or `sell`.
- Classification is for context only.
- Orchestrator still decides final signal state.
- ATR R:R < 1.8 → auto-veto regardless of strategy state.
- Min indicator bonus cap: 15 points max.
