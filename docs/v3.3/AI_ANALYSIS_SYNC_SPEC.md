# AI Analysis Sync Spec — OpenClaw v3.3

## Trigger
`/analyze <SYMBOL>` in Telegram.

## Pipeline
1. 4-agent pipeline runs (technical, sentiment, news/macro, risk + CIO synthesis).
2. Telegram response formatted and sent.
3. **ANALYSIS snapshot saved** (enriched v3.3 schema).
4. `agent_runs` logged to Supabase.
5. Dashboard `/api/analyses` reads from snapshot store.
6. Run log updated.
7. API counter incremented.

## ANALYSIS Snapshot Schema (v3.3)
```js
{
  result:            string,         // Full agent output (max 2000 chars)
  model_used:        string,         // Extracted from output or fallback
  model_provider:    'ai-core',
  fallback_depth:    number,         // 0 = primary model used
  final_action:      'BUY'|'SELL'|'WAIT'|'HOLD'|null,  // Regex-extracted
  confidence:        number|null,    // 0–100, regex-extracted
  grounded:          boolean,
  grounding_fields:  string[],       // ['price','indicators','sentiment','news']
  data_sources_used: string[],       // Snapshot types used as grounding
  snapshot_ages:     {               // Age of each grounding snapshot
    MARKET:    { age_seconds: number, stale: boolean },
    INDICATOR: { age_seconds: number, stale: boolean },
    ...
  },
  quality_score:     number,         // Provider data quality 0–100
  warnings:          string[]
}
```

## Extraction Logic (best-effort, null fallbacks)
```js
// Final action
outputStr.match(/(?:Action|Signal|Direction)[\s:]*\*?(BUY|SELL|WAIT|HOLD|LONG|SHORT)\*?/i)

// Confidence
outputStr.match(/(?:Confidence)[\s:]*\*?(\d{1,3})(?:\/100|\s*%)?/i)

// Model
outputStr.match(/(?:Model|Powered by)[\s:]*\*?([A-Za-z0-9\-_. ]+)/i)
```

## Dashboard AI Panel Behavior
| State | Display |
|-------|---------|
| No snapshot | Empty state: "Run /analyze BTC to populate" |
| Stale snapshot | Stale badge + last run info |
| Fresh snapshot | Summary, model, run_id, final_action, confidence |

## Rules
- No raw objects in dashboard.
- If news snapshot has no relevant headlines, AI output must say "no relevant news found."
- No hallucinated macro references.
- stale grounding data → AI output is flagged with warning.
