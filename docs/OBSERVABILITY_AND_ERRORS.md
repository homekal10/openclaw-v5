# Observability and Errors Spec

## Run ID System
- UUID generated at start of every signal/command/scheduler job
- Propagated through: fetch → score → verify → veto → deliver
- Stored in: signal_snapshots, agent_runs, system_errors, run_logs
- Module: `lib/observability/run-context.cjs`

## Error Classes
| Class | Stage | Example |
|-------|-------|---------|
| PROVIDER_ERROR | Ingestion | Binance timeout |
| NORMALIZATION_ERROR | Processing | Malformed candle data |
| SCORING_ERROR | Scoring | Missing indicator |
| VERIFICATION_ERROR | Verification | Gate check failure |
| VETO_ERROR | Veto | Unexpected veto state |
| LLM_ERROR | AI | LM Studio timeout |
| PERSISTENCE_ERROR | Storage | Supabase insert fail |
| DELIVERY_ERROR | Delivery | Telegram send fail |
| SCHEDULER_ERROR | Jobs | Missed job run |
| DASHBOARD_ERROR | API | Endpoint crash |
| AUTH_ERROR | Security | Unauthorized user |
| UNKNOWN_ERROR | Any | Unclassified |

## Error Record Fields
error_id, run_id, timestamp, stage, asset, command, provider, severity, retryable, fallback_used, user_visible, human_summary, technical_detail, stack_trace, resolution_hint

## Severity Levels
- INFO: Normal operation logged
- WARN: Degraded but functional  
- CRITICAL: Manual action needed

## Debug Commands
- `/logs` — Recent structured run logs (admin only)
- `/health` — Provider + system health summary
- `/status` — Uptime, memory, errors, modules
- `/providers` — Provider health + paid status
