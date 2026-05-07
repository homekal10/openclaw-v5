# Learning Engine v3.4

## New Functions
- getLearningStatus() — sample maturity, setup/asset breakdown
- getModelScore() — agent success rate + latency from ANALYSIS snapshots
- alidateWeightChange(current, proposed) — ±2/week guard

## Safety Locks (IMMUTABLE)
`json
{
  "never_remove_vetoes": true,
  "never_activate_brokers": true,
  "never_activate_paid_providers": true,
  "never_auto_change_trading_logic": true,
  "max_weight_change_per_week": 2
}
`

## Maturity Requirements
- Min 10 tracked outcomes before any recommendation
- Recommendations only — admin must manually approve
- Weight changes: max ±2/week, clamped if exceeded

## Telegram Commands
- /learningstatus — sample sizes, maturity, safety locks
- /modelscore — agent performance aggregate
- /applylearning — shows advisory note (no auto-apply without flag)
- /weeklyreview — existing full weekly analysis

## Dashboard Panel (Phase 10)
- Sample size warning when < 10 outcomes
- Best/worst strategy display
- Best/worst asset display
- Model score gauge
