# Learning Engine v3.3 Spec — OpenClaw v3.3

## Purpose
Convert trade journal data into bounded, audited performance intelligence.
Learning never modifies trading logic, vetoes, or broker execution automatically.

## Tracked Metrics

### Setup-Level
| Metric | Description |
|--------|-------------|
| `setup_win_rate` | % of tracked outcomes that were profitable |
| `setup_avg_r` | Average R-multiple achieved |
| `setup_failure_rate` | % stopped out at full loss |
| `fvg_response_quality` | % of FVG setups that hit target |
| `sweep_failure_rate` | % of liquidity sweeps that failed to reverse |
| `weak_adx_failure` | % of trend setups with ADX < 20 that failed |

### Strategy-Level
| Metric | Description |
|--------|-------------|
| `strategy_win_rate[name]` | Per strategy win rate |
| `strategy_avg_r[name]` | Per strategy average R |

### Session-Level
| Metric | Description |
|--------|-------------|
| `session_win_rate[session]` | Win rate by session (london, ny, asian) |
| `session_avg_r[session]` | Average R by session |

### Asset-Level
| Metric | Description |
|--------|-------------|
| `asset_win_rate[symbol]` | Win rate by asset |

### Signal Quality
| Metric | Description |
|--------|-------------|
| `wait_accuracy` | % of WAIT signals where entry would have been bad |
| `watchlist_conversion` | % of WATCHLIST that became valid signals next cycle |
| `veto_regret_rate` | % of vetoed setups that would have been profitable (manual review) |
| `news_false_positive_rate` | % of news-triggered watchlists that had no follow-through |

### AI Model
| Metric | Description |
|--------|-------------|
| `model_usefulness_score` | 1–10; admin-assigned based on final_action accuracy |
| `confidence_accuracy` | Correlation between confidence field and actual outcome |

## Telegram Commands
| Command | Description |
|---------|-------------|
| `/weeklyreview` | Summary of tracked outcomes this week |
| `/applylearning` | Preview bounded recommendations (requires admin confirm) |
| `/replay SIGNAL_ID` | Re-display signal card + outcome (read-only, never re-publishes) |
| `/backtest-recent` | Apply current filters to last 50 candle sets (paper only) |
| `/modelscore` | Show model usefulness scores |

## Safety Rules
- Never remove hard vetoes.
- Never auto-enable paid providers.
- Never auto-change veto thresholds.
- Never auto-change broker/execution logic.
- Never change structural trading logic without admin approval.
- Only suggest bounded weight adjustments: ±2 per metric per week.
- **Minimum 10 tracked outcomes** before any recommendation is generated.
- `/applylearning` requires explicit admin confirmation message.
- Replay is read-only — never re-publishes or creates new signals.

## Dashboard Learning Panel
```
📊 Learning Engine
Sample size: 24 outcomes (min: 10 ✅)
Best setup: EMA Pullback (73% WR, +2.4R avg)
Worst setup: Range Sweep (38% WR, –0.7R avg)
Best session: London Open (68% WR)
False positive rate (news): 12%
WAIT accuracy: 81%
Recommendation: Consider reducing RANGE regime signals. [Admin confirm required]
```

## Recommendation Format
```js
{
  type:          'WEIGHT_ADJUSTMENT' | 'AVOID_CONDITION',
  target:        'strategy_weight' | 'news_score' | 'session_multiplier',
  current_value: number,
  suggested_value: number,
  delta:         number,      // max ±2
  reason:        string,
  sample_size:   number,
  confidence:    'LOW' | 'MEDIUM' | 'HIGH',
  requires_admin: true
}
```
