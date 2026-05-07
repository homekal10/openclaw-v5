# Auto-Update Policy v3.4

## File: lib/policy/auto_update_policy.cjs

## Auto-Apply Categories (no approval needed)
- alse_positive_keywords
- provider_endpoint_metadata
- cache_ttl
- display_text
- source_reliability_score
- score_weight_recommendation (only if ADMIN_LEARNING_APPLY=true)

## Manual Approval Required
- 	rading_logic
- signal_verifier_gates
- eto_engine_rules
- schema_migration
- paid_provider_activation
- roker_execution
- dependency_upgrade
- deployment_change
- eature_flag_enable
- hard_veto_remove

## Audit Trail
Each update logged to logs/auto_update_log.jsonl:
`json
{
  "id": "upd_1234",
  "category": "display_text",
  "timestamp": "...",
  "source": "system",
  "before": "old value",
  "after": "new value",
  "changelog": "...",
  "applied": true,
  "rollback_point": "...",
  "pre_test_status": "passed",
  "post_test_status": "passed"
}
`

## Pending Approvals Queue
Stored in logs/pending_approvals.json
Max 50 entries (rolling).

## Commands
- /securitystatus — shows policy summary + pending count
- /ratelimits — rate limit status
