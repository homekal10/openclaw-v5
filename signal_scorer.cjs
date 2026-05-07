/**
 * signal_scorer.cjs — OpenClaw News Intelligence Scorer
 *
 * IMPORTANT SECURITY NOTE:
 * AI analysis results are CONTEXT ONLY — never a direct trade execution trigger.
 * Output of this module: WATCHLIST | INTELLIGENCE | IGNORED
 * Actual BUY/SELL decisions require the full orchestrator (8-layer scoring + veto engine).
 *
 * Flow: Headline → AI analysis → Relevance filter → Save WATCHLIST → Alert user
 * AI confidence ≥75 → WATCHLIST (not BUY/SELL)
 * AI confidence 60-74 → INTELLIGENCE (saved, not alerted)
 * AI confidence <60 → IGNORED
 */

const https = require('https');
const path  = require('path');
const { saveSignal, recordSignalSent, getAssetWinRate } = require('./database.cjs');
const { analyzeRwandaHeadline, analyzeGlobalHeadline } = require('./rwanda_engine.cjs');
const { getCoinMarketData } = require('./coingecko.cjs');
const { scoreHeadlineRelevance, canGenerateSignal } = require('./lib/filters/expert_news_filter.cjs');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const AI_BASE_URL = process.env.AI_BASE_URL || 'http://localhost:1234';
const AI_MODEL    = process.env.MODEL_PRIMARY || 'local-model';

// Minimum entry signals per asset (priority order as specified)
const ASSET_PRIORITY = ['XAUUSD', 'BTCUSD', 'EURUSD', 'GBPUSD', 'US30', 'NAS100', 'OIL', 'COFFEE', 'COPPER', 'COLTAN'];

// ─── AI Analysis via LM Studio ────────────────────────────────────────────────
async function analyzeWithAI(headline) {
    const prompt = `You are a hedge fund macro analyst. Analyze this headline and return ONLY valid JSON:

Headline: "${headline.title}"
Source: ${headline.source || 'Financial News'}
Category: ${headline.category || 'global'}

Return JSON exactly:
{
  "summary": "1-2 sentence summary",
  "sentiment": "BULLISH|BEARISH|NEUTRAL",
  "affected_assets": ["XAUUSD","BTCUSD","EURUSD","OIL"],
  "rwanda_relevance": "none|low|medium|high",
  "trade_setups": [
    {
      "asset": "XAUUSD",
      "direction": "BUY",
      "entry_logic": "Break above resistance or market order",
      "stop_loss_logic": "Below recent swing low / 1.5 ATR",
      "take_profit_logic": "1R and 2R targets"
    }
  ],
  "confidence": 72
}`;

    try {
        const url  = new URL(`${AI_BASE_URL}/v1/chat/completions`);
        const body = JSON.stringify({
            model:       AI_MODEL,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens:  600
        });

        const data = await new Promise((resolve) => {
            const opts = {
                hostname: url.hostname,
                port:     url.port || 80,
                path:     url.pathname,
                method:   'POST',
                headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                timeout:  20000
            };
            const req = require('http').request(opts, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(d);
                        const text   = parsed.choices?.[0]?.message?.content || '';
                        const jsonMatch = text.match(/\{[\s\S]*\}/);
                        if (jsonMatch) resolve(JSON.parse(jsonMatch[0]));
                        else resolve(null);
                    } catch(e) { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.write(body); req.end();
        });

        return data;
    } catch(e) {
        return null;
    }
}

// ─── Rule-based scoring (fallback when AI unavailable) ───────────────────────
function ruleBasedScore(headline) {
    const text = `${headline.title} ${headline.description || ''}`.toLowerCase();

    // Rwanda headlines get priority boost
    let base = headline.isRwanda ? 60 : 50;

    // Source credibility boost
    const highCredSources = ['reuters', 'bloomberg', 'financial times', 'cnbc'];
    if (highCredSources.some(s => headline.source?.toLowerCase().includes(s))) base += 10;

    // Urgency keywords
    const urgentKeywords = ['breaking', 'just in', 'alert', 'urgent', 'crash', 'surge', 'record', 'crisis'];
    if (urgentKeywords.some(k => text.includes(k))) base += 12;

    // High-impact event keywords
    const highImpact = ['fed', 'fomc', 'rate decision', 'nfp', 'cpi', 'gdp', 'war', 'sanction', 'bitcoin etf'];
    if (highImpact.some(k => text.includes(k))) base += 15;

    // Asset detected boost
    if (headline.assets?.length > 0) base += 8;

    return Math.min(100, base);
}

// ─── News Intelligence formatter (NOT a trade signal) ────────────────────────
function formatSignalMessage(signal) {
    // SAFETY: These are news intelligence alerts, not trade signals
    // They do NOT include entry/SL/TP — those require full institutional analysis
    const sentiment = signal.direction === 'BUY' ? '🟢 Bullish' : signal.direction === 'SELL' ? '🔴 Bearish' : '⚪ Neutral';
    const tag   = signal.category === 'rwanda' ? '#Rwanda #EastAfrica' :
                  signal.category === 'crypto'  ? '#Crypto #BTC' :
                  signal.category === 'forex'   ? '#Forex' : '#Macro #News';
    const conf  = signal.confidence;
    const confBar = Math.round(conf / 10);
    const bar   = '█'.repeat(confBar) + '░'.repeat(10 - confBar);

    return `📰 *NEWS INTELLIGENCE*

_"${signal.headline?.substring(0, 120)}_"

*Asset:* \`${signal.asset}\`
*Sentiment:* ${sentiment}
*Relevance:* \`${bar}\` *${conf}%*
*Source:* ${signal.source}

*Context:* ${signal.reason}

${signal.rwandaBoost ? '🇷🇼 Rwanda Intelligence\n' : ''}⚠️ *This is news context — NOT a trade signal.*
Run /signal ${signal.asset} for full institutional analysis.

${tag}`;
}

// ─── Cross-Verification ──────────────────────────────────────────────────────
async function crossVerifySignal(signal) {
    let conf = signal.confidence;
    
    // 1. Learning Loop Feedback
    const winRate = getAssetWinRate(signal.asset);
    if (winRate < 0.4) conf -= 10; // Penalize bad performing assets
    if (winRate > 0.6) conf += 5;  // Boost historically good ones

    // 2. Momentum Alignment (Crypto)
    if (['BTC', 'ETH', 'SOL', 'BTCUSD'].includes(signal.asset)) {
        try {
            const m = await getCoinMarketData(signal.asset);
            if (m) {
                const ch = m.change24h || 0;
                if (signal.direction === 'BUY' && ch < -5) conf -= 15; // Buying a heavy crash
                if (signal.direction === 'SELL' && ch > 5)  conf -= 15; // Shorting a heavy pump
                if (signal.direction === 'BUY' && ch > 2)   conf += 5;  // Momentum aligns
            }
        } catch(e) {}
    }

    signal.confidence = Math.min(100, Math.max(0, conf));
    return signal;
}

// ─── Process a batch of headlines ────────────────────────────────────────────
async function processHeadlines(headlines, sendToTelegram) {
    const signalsSent = [];

    for (const headline of headlines.slice(0, 30)) {
        try {
            let signals = [];

            // Rwanda logic (rule-based, instant)
            if (headline.isRwanda || headline.region === 'rwanda') {
                const rwSignals = analyzeRwandaHeadline(headline);
                signals.push(...rwSignals.map(s => ({
                    ...s,
                    confidence: Math.min(100, 65 + (s.confidence_boost || 10)),
                    headline: headline.title,
                    source:   headline.source
                })));
            }

            // Global rule-based signals
            const globalSignals = analyzeGlobalHeadline(headline);
            signals.push(...globalSignals);

            // AI enhancement — CONTEXT ONLY, no direct trade execution
            if (signals.length === 0 || signals.some(s => s.confidence >= 60)) {
                const aiResult = await analyzeWithAI(headline);
                if (aiResult?.trade_setups?.length > 0) {
                    for (const setup of aiResult.trade_setups) {
                        // FIXED: AI suggestions become INTELLIGENCE context, not BUY/SELL signals
                        // They do NOT include entry/SL/TP prices — those require institutional analysis
                        signals.push({
                            asset:      setup.asset,
                            direction:  setup.direction,  // used for sentiment label only
                            confidence: Math.min(aiResult.confidence || 60, 74), // cap at 74 — forces INTELLIGENCE, not WATCHLIST alert
                            headline:   headline.title,
                            source:     headline.source,
                            reason:     aiResult.summary || 'AI context analysis',
                            category:   headline.category || 'ai',
                            aiAnalyzed: true,
                            isIntelligence: true,  // FLAG: prevents direct BUY/SELL formatting
                            timeframe:  'context'
                        });
                    }
                }
            }

            // Score, verify and filter — with expert relevance check
            for (let signal of signals) {
                if (!signal.confidence) signal.confidence = ruleBasedScore(headline);
                if (!ASSET_PRIORITY.includes(signal.asset)) continue;

                // ── Expert News Filter: Block false-positive asset mappings ──
                const relevance = scoreHeadlineRelevance(
                    headline.title, signal.asset,
                    { source: headline.source, publishedAt: headline.publishedAt || headline.savedAt, assets: headline.assets }
                );
                signal.relevance_score  = relevance.score;
                signal.relevance_action = relevance.action;
                signal.relevance_reasons = relevance.reasons;
                signal.macro_event = relevance.macroEvent;

                // Hard block: irrelevant headlines cannot generate signals
                if (relevance.action === 'IGNORE') continue;
                if (relevance.score < 40 && !headline.isRwanda) continue;

                // Cross-verify before accepting
                if (signal.confidence >= 60) {
                    signal = await crossVerifySignal(signal);
                }

                // Relevance gate: only SIGNAL_CANDIDATE (≥70) can become watchlist alerts
                if (signal.confidence >= 75 && !signal.isIntelligence && relevance.score >= 70) {
                    // High relevance + high confidence → WATCHLIST alert
                    const saved = saveSignal({ ...signal, status: 'watchlist' });
                    if (saved && sendToTelegram) {
                        const msg = formatSignalMessage(signal);
                        await sendToTelegram(msg);
                        recordSignalSent(signal.asset, signal.source);
                        signalsSent.push(signal);
                    }
                } else if (signal.confidence >= 75 && relevance.score < 70) {
                    // High confidence but low relevance → downgrade to intelligence only
                    saveSignal({ ...signal, status: 'intelligence', downgrade_reason: 'Low relevance: ' + relevance.reasons.join('; ') });
                } else if (signal.confidence >= 60) {
                    // INTELLIGENCE context — save silently, no Telegram alert
                    saveSignal({ ...signal, status: 'intelligence' });
                }
                // < 60 → ignored
            }
        } catch {
            // Silent fail per headline
        }
    }
    return signalsSent;
}

module.exports = { processHeadlines, formatSignalMessage, analyzeWithAI, ruleBasedScore };
