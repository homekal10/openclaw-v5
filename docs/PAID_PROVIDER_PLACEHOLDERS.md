# Paid Provider Placeholders Spec

## Overview
16 paid providers registered as disabled placeholders. Each:
- Returns typed disabled response (never crashes pipeline)
- Activated via env flag + API key
- Has healthcheck, quota tracking, setup instructions

## Activation Steps
1. Set category flag in `telegram.env`: `ENABLE_PAID_MARKET_DATA=true`
2. Set provider API key: `POLYGON_IO_API_KEY=pk_xxxxx`
3. Restart: `npx pm2 restart openclaw`
4. Verify: `/providers` command in Telegram
5. Monitor: `/api-usage` for quota tracking

## Environment Flags
| Flag | Controls |
|------|----------|
| ENABLE_PAID_MARKET_DATA | Bloomberg, Refinitiv, TradingView, Polygon, Twelve Data, FMP |
| ENABLE_PAID_NEWS | Benzinga, RavenPack |
| ENABLE_PAID_CALENDAR | TradingEconomics |
| ENABLE_BROKER_EXECUTION | Oanda, Exness, Binance Trading, Alpaca, IBKR |
| ENABLE_CLOUD_LLM | Grok/xAI cloud |
| ENABLE_TELEMETRY | Sentry, Datadog/PostHog |

## Implementation Priority (when ready to activate)
1. **Polygon.io** — Best free tier (5/min), easy upgrade path
2. **Twelve Data** — 800 free/day, covers FX + crypto
3. **Benzinga** — Real-time news, direct asset tagging
4. **TradingEconomics** — Economic calendar for macro filter
5. **Alpaca** — Paper trading for signal validation
