# API Counter Repair Spec — OpenClaw v3.3

## Scope
Every code path that touches a provider, cache, or external service must be
recorded by `api_counter.cjs`.

## Tracked Call Types
| call_type | Description |
|-----------|-------------|
| `provider` | Live API call to data provider |
| `cache_hit` | Served from snapshot store |
| `cache_miss` | Snapshot stale or missing, live call needed |
| `fallback` | Primary failed, fallback used |
| `llm` | LLM/AI model call |
| `chart` | Chart/candle generation |
| `supabase_read` | Supabase SELECT |
| `supabase_write` | Supabase INSERT/UPSERT |
| `paid_check` | Paid placeholder verification |
| `telegram_cmd` | Telegram command triggered |
| `dashboard_refresh` | Dashboard panel API call |
| `scheduler` | Scheduled job provider call |

## Record Schema
```js
{
  provider:          string,
  caller:            string,       // 'telegram', 'dashboard', 'scheduler', etc.
  call_type:         string,       // from table above
  success:           boolean,
  latency_ms:        number,
  cache_hit:         boolean,
  fallback_used:     boolean,
  quota_limit:       number|null,
  quota_used:        number,
  quota_pct:         number,
  predicted_exhaustion: ISO8601|null,
  last_success:      ISO8601|null,
  last_error:        string|null
}
```

## Dashboard Endpoints
- `GET /api/api-usage` — per-provider quota summary
- `GET /api/providers` — provider health + quota bars

## Quota Panel Display
```
CoinGecko  [████████░░] 72%  calls_today: 360/500  latency: 210ms
```

## Rules
- Dashboard showing 0 calls = counter not being incremented from that path.
- Fix: every `apiFetch()` call in dashboard.cjs must pass `caller: 'dashboard'`.
- Every provider call from scheduler must pass `caller: 'scheduler'`.
- `cache_hits` and `fallback_calls` tracked per provider and per caller.
