# Auto-Update Policy v3.3 — OpenClaw v3.3

## Principles
- Auto-apply is limited to non-critical metadata and display fixes only.
- Any change touching trade logic, vetoes, broker execution, or schema requires manual admin approval.
- Every update — auto or manual — requires: changelog entry, rollback point, pre-test, post-test, health check, admin summary.

## Auto-Apply Allowed (8 types)
| Type | Description |
|------|-------------|
| `KEYWORD_LIST` | False-positive keyword updates for news filter |
| `SOURCE_RELIABILITY` | Source quality score updates |
| `CACHE_TTL` | Snapshot TTL adjustments (bounded: ±20%) |
| `DISPLAY_TEXT` | UI label/tooltip text fixes |
| `PROVIDER_METADATA` | Provider endpoint URL, description updates |
| `STRATEGY_WEIGHT` | Bounded indicator bonus weight (±2, admin-enabled only) |
| `NEWS_PENALTY` | Blacklist additions (add-only, never remove) |
| `HEALTH_THRESHOLD` | Non-critical health warning threshold adjustments |

## Manual Approval Required (10 types)
| Type | Description |
|------|-------------|
| `TRADING_LOGIC` | Orchestrator, signal generation |
| `VERIFIER_LOGIC` | Signal verifier, veto rules |
| `SCHEMA_MIGRATION` | Database schema changes |
| `PROVIDER_ACTIVATION` | Enabling any paid or new provider |
| `BROKER_EXECUTION` | Order routing, execution logic |
| `DEPENDENCY_UPGRADE` | Package upgrades |
| `DEPLOYMENT_CHANGE` | PM2 config, ports, env vars |
| `PAID_INTEGRATION` | Any paid provider integration |
| `VETO_THRESHOLD` | R:R minimum, any hard veto parameter |
| `LLM_ROUTING` | AI model selection or routing changes |

## Update Record Schema
```js
{
  id:           UUID,
  type:         string,         // from types above
  description:  string,
  autoApply:    boolean,
  requiresApproval: boolean,
  changelog:    string,
  rollback_id:  UUID,
  pre_test:     string,         // test command run before apply
  post_test:    string,         // test command run after apply
  health_check: string,
  admin_summary: string,
  applied_at:   ISO8601|null,
  applied_by:   string|null,
  status:       'pending' | 'applied' | 'rolled_back' | 'rejected'
}
```

## Guardrail Tests
```
✅ STRATEGY_WEIGHT → autoApply: true, requiresApproval: false
✅ TRADING_LOGIC   → autoApply: false, requiresApproval: true
✅ VERIFIER_LOGIC  → autoApply: false, requiresApproval: true
✅ BROKER_EXECUTION → autoApply: false, requiresApproval: true
✅ 8 types auto-apply | 10 types require approval
```

All guardrail tests verified passing in v3.3 test suite.
