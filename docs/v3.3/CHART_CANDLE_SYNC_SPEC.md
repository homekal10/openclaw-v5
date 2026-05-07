# Chart + Candle Data Consistency Spec — OpenClaw v3.3

## Problem Fixed
Chart showed "No candle data" while indicator values were displaying,
because chart engine and indicator engine were not sharing the same CandleSnapshot.

## Solution: Shared CandleSnapshot
Both chart engine and indicator engine read from the same CANDLE snapshot
(TTL 60s, symbol-keyed).

## Write Path
```
Binance/CoinGecko → normalize → snapStore.put('CANDLE', symbol, tf, candles)
```

## Read Path (both consumers)
```js
const candleSnap = snapStore.get('CANDLE', symbol);
if (!candleSnap || candleSnap.stale) { return { stale: true, source: 'none' }; }
const candles = candleSnap.data;
```

## Degradation Rules
| CandleSnapshot state | Chart | Indicators |
|---------------------|-------|-----------|
| Fresh | ✅ Render | ✅ Compute |
| Stale | ⚠️ Stale badge | ⚠️ Stale badge |
| Missing | ❌ Unavailable message | ❌ Unavailable message |
| Fallback used | ⚠️ Fallback label | ⚠️ Fallback label |

Both panels must show the **same stale status** for the same symbol/timeframe.

## Chart Metadata (always shown)
```
Symbol: XAUUSD | TF: M1 | Candles: 200 | Provider: binance
Closed: 2026-05-02T18:30:00Z | Age: 14s | LIVE
```

## Chart Modes
- `candlestick` — default
- `line` — simplified
- `bollinger` — BB overlay
- `vwap` — VWAP line
- `rsi_macd` — oscillators panel
- `composite` — strategy overlay
- `scalp` — M1 scalp mode with ATR bands

## Text Summary Fallback
When chart cannot render (no candle data), show:
```
📊 XAUUSD — M1 Chart Unavailable
Provider: No candle data
Last indicator snapshot: 240s ago (STALE)
Run /signal XAUUSD to refresh
```
