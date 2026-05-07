# Replay + Backtest Specification v3.4

## Replay Engine (lib/replay/replay_engine.cjs)
### Function: eplaySignal(signalId)
- Finds signal in logs/trading_log.json by timestamp or run_id
- Re-runs through current signal_verifier.verify()
- Re-runs through current eto_engine.applyVetoes()
- Compares old_decision vs new_decision
- **NEVER republishes to Telegram**
- Saves REPLAY_RESULT snapshot

### REPLAY_RESULT Schema
`json
{
  "signal_id": "...",
  "symbol": "XAUUSD",
  "original_timestamp": "...",
  "replay_timestamp": "...",
  "old_decision": "BUY",
  "new_decision": "WAIT",
  "decision_changed": true,
  "diff_summary": "Decision changed: BUY → WAIT",
  "_republished": false,
  "_telegram_sent": false
}
`

## Backtest Engine (lib/replay/backtest_engine.cjs)
### Function: acktestRecent(symbol)
- Fetches fresh candles (8s timeout) OR uses CANDLE snapshot
- Finds last 10 BUY/SELL signals from trading log
- Calculates MFE/MAE per trade
- Reports win rate, avg MFE, avg MAE, MFE/MAE ratio
- **Label: APPROXIMATE — NOT LIVE PERFORMANCE**
- Saves BACKTEST_RESULT snapshot

## Commands
- /replay SIGNAL_ID — admin only
- /backtest-recent XAUUSD — admin only
