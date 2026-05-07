# Smart Health v3.4

## 8 New Watchdog Detectors

| Detector | Condition | Action |
|----------|-----------|--------|
| detectMissingAnalysis() | ANALYSIS snapshot >2h old | Alert admin |
| detectQuotaExhaustion() | Any provider >90% daily quota | Force fallback |
| detectSchedulerDelay() | Heartbeat gap >120s | Alert admin |
| detectPM2RestartSpike() | Process uptime <5min | Alert admin |
| detectSupabaseFailure() | >3 failures/hour | Alert admin |
| detectLLMTimeout() | >3 timeouts/hour | Alert admin |
| detectDashboardSyncLag() | >3 stale snapshot types | Mark stale |
| detectChartCandleMismatch() | Empty CANDLE payload | Refresh candle |

## 3 Self-Healing Actions
- pauseNoisyNews() — suppress news signal generation
- markDashboardStale() — mark dashboard as stale
- orceProviderFallback(provider) — force route away from provider

## Rules
- Self-healing NEVER changes trading logic
- Healing actions require admin confirmation for destructive ops
- All detectors have false-alarm thresholds tested in suite
