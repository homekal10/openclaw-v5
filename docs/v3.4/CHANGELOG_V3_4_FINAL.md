# Changelog v3.4 Expert Intelligence Edition — FINAL

**Released:** 2026-05-03
**From:** v3.3 Institutional Intelligence (238 tests)
**To:** v3.4 Expert Intelligence Edition (426 tests)

---

## Sprints 1-4 (previously documented)
See CHANGELOG_V3_4.md for full sprint 1-4 details.

---

## Sprint 5: Dashboard UX + Scalper Intelligence (Final)

### Dashboard v3.4 Panels (Phase 10 — complete)
- **3 new HTML panels** added to dashboard grid:
  - 🧠 Learning Engine panel (outcomes/maturity/safety locks)
  - 🔁 Replay & Backtest panel (REPLAY_RESULT + BACKTEST_RESULT snapshots)
  - 📐 Indicator Intelligence panel (enriched BB/Stoch/AO/ATR + confluence)
- **3 new JS loader functions:** loadLearningPanel, loadReplayPanel, loadIndicatorIntel
- All panels: stale/live badge, last-updated timestamp, error state
- 20s auto-refresh for learning + indicator panels
- 60s auto-refresh for replay panel

### 4 New API Endpoints
| Endpoint | Returns |
|----------|---------|
| GET /api/v4/learning-status | outcomes, maturity, safety locks, model score |
| GET /api/v4/replay-results | REPLAY_RESULT + BACKTEST_RESULT snapshots |
| GET /api/v4/indicator-intelligence | enriched INDICATOR snapshot |
| GET /api/v4/auto-update-log | last 20 updates + pending approvals |

### Structured JSON Logging (Phase 11)
- jsonLog() helper appends to logs/dashboard_structured.jsonl
- Format: { ts, source, event, ...meta }
- Used by: /api/v4/learning-status, /replay-results, /indicator-intelligence

### Indicator Intelligence → Gold Scalper (Phase 4 wire-up)
- indicator_intelligence.cjs now wired into gold_scalper.cjs output
- Every scalp signal now includes:
  - BB: squeeze_state, expansion_state, upper/lower stretch, interpretation
  - Stoch: exhaustion_state, cross_state, kd_spread, divergence_signal
  - AO: zero_line_state, flip_state, momentum_shift, velocity
  - ATR: volatility_regime, 0.5x/1.0x/1.5x guides, rr_guard
  - confluence: timing_confirmation, bullish/bearish signals
- _trade_approval: false hard-coded — enrichment is timing context only
- indicator_intelligence_version field stamps every signal ('v3.4' or 'raw')
- Graceful fallback: if intelligence module errors, raw indicators returned

---

## Final Test Result
- **426 total tests** (from 238 at v3.3 start)
- **420 passed | 0 failed | 6 legitimate skips**
- **Grade: 🏆 PERFECT**

## Breaking Changes
None. All v3.3 functionality preserved.

## PM2 Status
- Process: openclaw (ID 0) — online
- Restarts: 0 | Uptime: stable | Memory: ~92MB
