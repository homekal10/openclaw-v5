# AI Analyst Formatter Spec

## Problem
`/analyze` returned `[object Object]` for each agent section because raw JS objects were sent directly to Telegram without formatting.

## Solution
File: `lib/formatters/analysis_formatter.cjs`

### Formatter Functions
| Function | Input | Output |
|----------|-------|--------|
| `formatAgentAnalysis(result, mode)` | Full analysis object | Formatted string |
| `formatTechnicalAgent(data)` | Technical agent output | Trend, structure, setup, entry/SL/TP |
| `formatSentimentAgent(data)` | Sentiment output | Mood, F&G, social, sources |
| `formatNewsMacroAgent(data)` | News/macro output | Headlines, event risk, macro regime |
| `formatRiskAgent(data)` | Risk output | R:R, position size, stop validation |
| `formatCioSynthesis(data)` | Synthesis output | Final action, score, confidence, vetoes |

### Output Modes
- **telegram**: Concise mobile-first with emojis
- **dashboard**: Detailed with metadata
- **debug**: Full JSON dump (admin only)

### Safety Rules
1. Never output raw JS objects to Telegram
2. `safe()` function handles null, undefined, nested objects
3. Every field has fallback: `—` if missing
4. Arrays formatted as bullet lists (max 5 items)
5. Bias shown with emoji: 🟢 Bullish, 🔴 Bearish, ⚪ Neutral

### AI Output Schema
```json
{
  "run_id": "uuid",
  "symbol": "BTCUSD",
  "timestamp": "ISO",
  "model_used": "lm-studio/qwen",
  "fallback_depth": 0,
  "technical": { "bias", "trend", "structure", "setup_type", "entry", "sl", "tp1", "score" },
  "sentiment": { "bias", "mood", "fear_greed", "social_sentiment", "confidence" },
  "news_macro": { "bias", "macro_regime", "event_risk", "headlines", "confidence" },
  "risk": { "approval", "rr", "position_size", "stop_loss", "invalidation" },
  "synthesis": { "final_action", "setup_type", "score", "confidence", "why_trade", "why_not", "vetoes" },
  "stale": false,
  "warnings": []
}
```
