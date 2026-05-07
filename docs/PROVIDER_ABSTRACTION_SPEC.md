# Provider Abstraction Spec

## Free Providers (Active)
| Provider | Type | Rate Limit | Fallback |
|----------|------|------------|----------|
| Binance | Candles/prices | 1200/min | CoinGecko |
| CoinGecko | Crypto prices | 30/min | Binance |
| Yahoo Finance | FX/commodities | 100/hour | Cached |
| Reddit | Social sentiment | 60/min | Cached |
| RSS feeds | News headlines | unlimited | Cached |
| Rwanda public | East Africa intel | unlimited | None |
| QuickChart.io | Chart images | 500/min | Text summary |
| LM Studio | Local LLM | unlimited | Rule-based |
| Supabase | Database | 500/min | JSON queue |

## Paid Placeholders (16 — All Disabled)
| Provider | Category | Env Flag | API Key Env |
|----------|----------|----------|-------------|
| Bloomberg | Market Data | ENABLE_PAID_MARKET_DATA | BLOOMBERG_API_KEY |
| Refinitiv | Market Data | ENABLE_PAID_MARKET_DATA | REFINITIV_API_KEY |
| TradingView | Market Data | ENABLE_PAID_MARKET_DATA | TRADINGVIEW_API_KEY |
| Polygon.io | Market Data | ENABLE_PAID_MARKET_DATA | POLYGON_IO_API_KEY |
| Twelve Data | Market Data | ENABLE_PAID_MARKET_DATA | TWELVE_DATA_API_KEY |
| FMP | Market Data | ENABLE_PAID_MARKET_DATA | FINANCIAL_MODELING_PREP_API_KEY |
| Benzinga | News | ENABLE_PAID_NEWS | BENZINGA_API_KEY |
| TradingEconomics | Calendar | ENABLE_PAID_CALENDAR | TRADINGECONOMICS_API_KEY |
| RavenPack | Sentiment | ENABLE_PAID_NEWS | RAVENPACK_API_KEY |
| Oanda | Broker | ENABLE_BROKER_EXECUTION | OANDA_API_KEY |
| Exness | Broker | ENABLE_BROKER_EXECUTION | EXNESS_API_KEY |
| Binance Trading | Broker | ENABLE_BROKER_EXECUTION | BINANCE_TRADING_API_KEY |
| Alpaca | Broker | ENABLE_BROKER_EXECUTION | ALPACA_API_KEY |
| IBKR | Broker | ENABLE_BROKER_EXECUTION | IBKR_API_KEY |
| Sentry | Telemetry | ENABLE_TELEMETRY | SENTRY_API_KEY |
| Datadog | Telemetry | ENABLE_TELEMETRY | DATADOG_API_KEY |

## Activation: Set env flag + API key → restart PM2 → verify with /providers
