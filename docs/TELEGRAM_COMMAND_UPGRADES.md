# Telegram Command Upgrades

## Signal Commands
| Command | Output | Notes |
|---------|--------|-------|
| `/signal SYMBOL` | BUY/SELL/WAIT/WATCHLIST/REJECTED | 8-layer scored |
| `/signal SYMBOL debug` | + Score breakdown, vetoes, run_id | Admin only |
| `/newsignals` | Filtered news intelligence | Expert filter blocks false-positives |
| `/analyze SYMBOL` | 4-agent deep analysis | Formatted (no [object Object]) |

## Market Commands
| Command | Output |
|---------|--------|
| `/market` | Overview with bias labels (not BUY lists) |
| `/daily` | Separated: BIAS / WATCHLIST / VERIFIED |
| `/regime SYMBOL` | Regime + active/watchlist/avoid strategies |
| `/patterns SYMBOL` | FVG, sweep, structure, zones |
| `/indicators SYMBOL` | RSI, MACD, EMA, ATR, ADX |
| `/chart SYMBOL [type]` | Candlestick/line/BB/VWAP/RSI |

## Crypto Commands
| Command | Output |
|---------|--------|
| `/crypto SYMBOL` | Price + RSI + F&G + chart |
| `/cryptomarket` | Top 10 live |
| `/trending` | CoinGecko trending |
| `/feargreed` | F&G index with gauge |

## v4.0 Debug Commands (NEW)
| Command | Output | Access |
|---------|--------|--------|
| `/providers` | Free provider health + 16 paid placeholder status | All users |
| `/features` | Feature flag status (10 flags) | All users |
| `/logs` | Structured run logs with run_id | Admin only |
| `/health` | Smart health + anomaly detection | All users |
| `/status` | Uptime, memory, errors, modules | All users |
| `/api-usage` | API quota dashboard | All users |

## Admin Commands
| Command | Output |
|---------|--------|
| `/adduser ID NAME` | Add authorized user |
| `/removeuser ID` | Remove user |
| `/users` | List users |
| `/weeklyreview` | Weekly learning report |

## Output Rules
- BUY/SELL: Must include asset, setup type, entry, SL, TP, RR, score, confidence, verification
- WAIT: Includes reason, conflict, needed confirmation
- WATCHLIST: Includes trigger zone, confirmation needed, session priority
- REJECTED: Includes missing criteria, veto reason
- All: Concise, mobile-readable, no hype, analysis only
