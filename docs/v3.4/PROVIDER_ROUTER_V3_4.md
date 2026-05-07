# Provider Router v3.4

## File: lib/providers/provider_router.cjs

## Provider Status Taxonomy
- HEALTHY — low errors, quota headroom available
- UNUSED — zero calls, no error history
- STALE — no recent calls (>30min)
- DEGRADED — 2+ errors
- FAILING — 5+ errors
- DISABLED — paid placeholder (never healthy)

## Routing Algorithm
1. Score each free provider: health(0-50) + quota_headroom(0-50)
2. Sort by score descending
3. Skip FAILING and DISABLED
4. Use highest-scored healthy provider
5. On failure: log fallback, try next provider
6. Paid placeholder: only if provider.tier != 'paid_placeholder'

## Fallback Log (200-entry rolling buffer)
`json
{
  "from": "coingecko",
  "to": "coinapi",
  "reason": "coingecko failing, using coinapi",
  "timestamp": "..."
}
`

## Dashboard Endpoint
GET /api/v4/provider-router
Returns: all provider statuses, quota usage, predicted exhaustion

## Paid Provider Rules
- Always DISABLED by default
- Never appear as healthy unless explicitly activated
- Show: env flag, API key env name, estimated cost, role
