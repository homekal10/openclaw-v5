# Provider Placeholder v3.3 — OpenClaw v3.3

## Provider Status Values
| Status | Description |
|--------|-------------|
| `healthy` | Active, responding, within quota |
| `unused` | Registered but no calls today |
| `stale` | Not called within expected interval |
| `degraded` | High latency or elevated error rate |
| `failing` | 3+ consecutive failures |
| `disabled` | Not enabled (all paid placeholders by default) |

## Provider Record Schema
```js
{
  id:              string,
  display_name:    string,
  tier:            'free' | 'paid',
  role:            'price' | 'news' | 'macro' | 'analytics' | 'broker' | 'monitoring',
  enabled:         boolean,
  status:          'healthy' | 'unused' | 'stale' | 'degraded' | 'failing' | 'disabled',
  env_flag:        string,      // e.g. 'ENABLE_BLOOMBERG=true'
  api_key_env:     string,      // e.g. 'BLOOMBERG_API_KEY'
  cost_estimate:   string,      // e.g. '$2,000/month'
  calls_today:     number,
  quota_limit:     number|null,
  quota_pct:       number,
  latency_ms:      number,
  last_success:    ISO8601|null,
  last_error:      string|null,
  fallback_priority: number     // lower = preferred
}
```

## Paid Placeholder List (all disabled by default)
| Provider | Role | Estimated Cost |
|----------|------|----------------|
| Bloomberg Terminal | price, macro | $2,000+/mo |
| Refinitiv (LSEG) | price, macro | $1,500+/mo |
| TradingView Pro | chart, signals | $60/mo |
| Polygon.io | price, crypto | $80/mo |
| Twelve Data | price, FX | $50/mo |
| FMP Premium | fundamentals | $40/mo |
| Benzinga Pro | news | $40/mo |
| TradingEconomics | macro | $75/mo |
| RavenPack | news analytics | $2,000+/mo |
| Oanda | FX broker | Variable |
| Exness | CFD broker | Variable |
| Binance Trading | crypto broker | 0.1% fees |
| Alpaca | US equities | Free tier |
| Interactive Brokers | multi-asset | $10/mo min |
| Sentry | monitoring | $26/mo |
| Datadog | monitoring | $15/host/mo |
| Better Stack | uptime | $20/mo |
| PostHog | analytics | Free tier |

## Activation Rules
1. Set `env_flag` to `true` in `telegram.env`.
2. Set `api_key_env` with valid key.
3. PM2 restart required: `pm2 restart openclaw`.
4. Auto-update system **cannot** activate paid providers.
5. Admin must confirm in Telegram: `/activate-provider <name>` (planned).

## Dashboard Behavior
- Paid providers show `disabled` badge with activation instructions.
- `no paid provider shows healthy=true` — verified by test suite.
- Quota bars shown for all active free providers.
- `cost_estimate` shown in provider expansion row.

## Test Verification (from v3.3 suite)
```
✅ inactive paid providers: 16
✅ no paid provider shows healthy=true
✅ providers summary: total 31
```
