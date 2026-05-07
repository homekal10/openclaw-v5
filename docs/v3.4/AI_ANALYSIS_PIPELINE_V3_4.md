# AI Analysis Pipeline v3.4

## Architecture: 5-Agent Sequential + Snapshot-Injection Pipeline

### Agents (run in parallel)
1. **Technical Analyst** — buildTechnicalPrompt(sym, indicatorData)
2. **Sentiment Analyst** — buildSentimentPrompt(sym) + fearGreedData
3. **News/Macro Analyst** — buildNewsPrompt(sym) + newsHeadlines
4. **Risk Manager** — buildRiskPrompt(sym, null)
5. **CIO Synthesis** — buildSynthesisPrompt(sym, {tech, sent, news, risk})

### Snapshot Injection (v3.4 new)
- INDICATOR snapshot → technical prompt
- NEWS snapshot → news prompt
- FEARGREED snapshot → sentiment prompt
- Stale inputs: confidence reduced by 10% per stale source
- Missing inputs: clearly labeled in warnings

### AiAnalysisSnapshot Schema
`json
{
  "run_id": "agent_1234_abc123",
  "symbol": "XAUUSD",
  "timestamp": "2026-05-03T...",
  "model_used": "...",
  "provider_used": "model_router",
  "fallback_depth": 0,
  "technical_summary": "...",
  "sentiment_summary": "...",
  "news_macro_summary": "...",
  "risk_summary": "...",
  "cio_synthesis": "...",
  "final_action": "ADVISORY",
  "confidence": 80,
  "why_trade": "...",
  "why_not_trade": "...",
  "needed_confirmation": [],
  "source_snapshots_used": ["INDICATOR", "NEWS"],
  "stale_inputs": [],
  "warnings": [],
  "agent_runs": [...],
  "total_latency_ms": 1234
}
`

### Hard Rules
- AI NEVER hallucinates live data — only uses snapshot payloads
- AI cannot approve BUY/SELL — only signal_verifier can
- Missing snapshot → fallback mode + confidence reduction
- final_action is always "ADVISORY" — never BUY/SELL
