# Smart Health v3.3 Spec — OpenClaw v3.3

## Monitoring Cycle
- **Interval:** 60s (configurable via `startMonitoring(intervalMs)`)
- **Baseline maturity:** 7 days / 500+ samples → learning active

## Monitored Conditions

### Snapshot Health
| Check | Threshold | Warning Type |
|-------|-----------|--------------|
| Any snapshot EXPIRED | age > 2× TTL | `SNAPSHOT_EXPIRED` |
| Any snapshot STALE | age > TTL | `SNAPSHOT_STALE` |
| FEARGREED missing | Never fetched | `FEARGREED_MISSING` |
| FEARGREED stale | age > 3600s | `FEARGREED_STALE` |
| ANALYSIS missing | No AI analyses run | `AI_MISSING` |
| CANDLE stale | age > 60s | `CANDLE_STALE` |

### System Resources
| Check | Threshold | Warning Type |
|-------|-----------|--------------|
| Heap nearing warn | > 360MB (90% of 400MB) | `MEMORY_APPROACHING` |
| Heap at warn | > 400MB → log warning | `MEMORY_WARNING` |
| Heap critical | > 480MB → force GC | `MEMORY_CRITICAL` → self-heal |

### Provider Health
| Check | Threshold | Warning Type |
|-------|-----------|--------------|
| Provider fail 3× consecutive | `PROVIDER_FAIL_THRESHOLD = 3` | `PROVIDER_FAILOVER` → failover |
| API high error rate | errors > 30% of daily calls | `API_HIGH_ERROR_RATE` |

### Veto Monitoring (NEW v3.3)
| Check | Threshold | Warning Type |
|-------|-----------|--------------|
| Veto spike | > 80% of signals blocked over ≥5 signals | `VETO_SPIKE` |
| Pass-rate anomaly | 0% pass rate over ≥5 signals | `PASS_RATE_ANOMALY` |

### Scheduler Health
| Check | Threshold | Warning Type |
|-------|-----------|--------------|
| Job fails 3× | `JOB_FAIL_THRESHOLD = 3` | `JOB_PAUSED` → pause + alert |

## System Health Status
```
HEALTHY   → no anomalies, no memory warnings, no veto spikes
ATTENTION → ≥1 warning but no anomaly
CRITICAL  → statistical anomaly (>2σ deviation) or memory critical
```

## Self-Healing Actions
| Trigger | Action | Auto? |
|---------|--------|-------|
| SNAPSHOT_EXPIRED | `REFRESH_STALE_SNAPSHOT` | ✅ Auto |
| MEMORY_CRITICAL | `FORCE_GC` (if `--expose-gc`) | ✅ Auto |
| Provider fail 3× | `PROVIDER_FAILOVER` | ✅ Auto |
| Job fail 3× | `JOB_PAUSED` | ✅ Auto |
| VETO_SPIKE | Alert admin | ❌ Admin only |
| PASS_RATE_ANOMALY | Alert admin | ❌ Admin only |
| Trading logic issue | Never auto-fix | ❌ Manual only |

## Self-Healing Log Record
```js
{ action, snapshot_type?, provider?, job?, heapMB?, timestamp }
```
- Written to `logs/self_healing.jsonl`
- Last 100 actions kept in memory
- Last 10 shown in dashboard health panel

## New v3.3 Functions
```js
detectVetoSpike()
// Returns { spike: boolean, detail: string }
// Reads VETO_STATS snapshot
// Spike = blocked/total > 0.80 with total >= 5

detectPassRateAnomaly()
// Returns { anomaly: boolean, detail: string }
// Reads VETO_STATS snapshot
// Anomaly = passed === 0 with total >= 5
```

## Dashboard Health Panel
```
⚡ System Health
Status: HEALTHY | 4h 12m uptime
Heap: 187/512MB | RSS: 310MB
Providers: 15/31 active
Avg Latency: 210ms | Errors (1h): 3
Baseline: 🔄 Building (2d 4h)

⚠️ Warnings (2):
• MACRO snapshot expired (1820s old)
• API high error rate: gnews: 4 errors / 10 calls

🔧 Last self-heal: REFRESH_STALE_SNAPSHOT (42s ago)
```
