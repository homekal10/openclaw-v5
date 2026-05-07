/**
 * tradingagents_bridge.cjs — OpenClaw Multi-Agent Analysis Engine
 *
 * v3.0 — Replaced broken Python/langgraph dependency with a native
 * Node.js multi-agent pipeline powered by model_router (AICC + Grok + LMStudio).
 *
 * Agents:
 *   1. Technical Analyst — Price structure, indicators, momentum
 *   2. Sentiment Analyst — Fear/Greed, social, on-chain signals
 *   3. News Analyst      — Macro news context, event risk
 *   4. Risk Manager      — R:R, position sizing, invalidation
 *   5. Synthesis         — Final weighted decision with conviction score
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Provider configuration abstraction
const PROVIDER_CONFIG_PATH = path.join(__dirname, 'providers.json');
let _providerCache = null;
function loadProviders() {
    if (_providerCache) return _providerCache;
    try {
        const raw = fs.readFileSync(PROVIDER_CONFIG_PATH, 'utf8');
        _providerCache = JSON.parse(raw);
    } catch {
        _providerCache = {};
    }
    return _providerCache;
}
function getProvider(name) {
    const cfg = loadProviders();
    return cfg[name] || null;
}

// getProvider exported at bottom of file
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const { route } = require('./model_router.cjs');

// ── Agent Prompts ─────────────────────────────────────────────────────────────

function buildTechnicalPrompt(ticker, priceData) {
    return `You are a professional Technical Analyst at an institutional hedge fund.

Analyze ${ticker} with this current market data:
${priceData ? JSON.stringify(priceData, null, 2) : 'Use your knowledge of current market conditions.'}

Provide a concise technical analysis covering:
1. Trend direction (Bullish/Bearish/Neutral) and strength
2. Key support and resistance levels
3. Momentum (RSI zone, MACD signal)
4. Volume analysis
5. Your technical bias (BUY/SELL/WAIT) with confidence %

Format: Use bullet points. Max 200 words. Be specific about price levels.`;
}

function buildSentimentPrompt(ticker) {
    return `You are a Sentiment Analyst at a crypto/forex trading desk.

Analyze current market sentiment for ${ticker}:
1. Retail vs institutional positioning
2. Fear & Greed conditions
3. Social media momentum (bullish/bearish discourse)
4. Options/derivatives market signals (if applicable)
5. Overall sentiment score: Bullish / Neutral / Bearish

Format: Bullet points. Max 150 words. Include specific sentiment indicators.`;
}

function buildNewsPrompt(ticker) {
    return `You are a Macro News Analyst covering global financial markets.

Analyze the macro news environment for ${ticker} right now (April 2026):
1. Key economic events affecting ${ticker}
2. Geopolitical risks that could move price
3. Central bank / regulatory impact
4. Sector-specific news
5. Event risk level: HIGH / MEDIUM / LOW

Format: Bullet points. Max 150 words. Be specific about catalysts.`;
}

function buildRiskPrompt(ticker, technicalBias) {
    return `You are a Risk Manager at an institutional trading firm.

For a potential ${technicalBias || 'directional'} trade on ${ticker}:
1. What is the optimal risk-reward ratio for current conditions?
2. Key invalidation levels (where to cut the loss)
3. Position sizing recommendation (% of portfolio, assuming moderate risk tolerance)
4. Maximum recommended trade duration
5. Overall risk rating: HIGH / MEDIUM / LOW

Format: Bullet points. Max 150 words. Focus on capital preservation.`;
}

function buildSynthesisPrompt(ticker, agentOutputs) {
    return `You are the Chief Investment Officer synthesizing agent research for ${ticker}.

Agent reports:
--- TECHNICAL ---
${agentOutputs.technical}

--- SENTIMENT ---
${agentOutputs.sentiment}

--- NEWS/MACRO ---
${agentOutputs.news}

--- RISK ---
${agentOutputs.risk}

Provide a final institutional-grade synthesis:
1. Consensus Direction: BUY / SELL / WAIT
2. Conviction Score: X/100
3. Primary Catalyst (1 line)
4. Key Risk to this view (1 line)
5. Recommended action in 1-2 sentences

Be direct and concise. Max 150 words.`;
}

// ── Main Analysis Function (v3.4 hardened) ───────────────────────────────────

async function runAgentAnalysis(ticker, date = null, priceData = null) {
    const sym = ticker.toUpperCase();
    const runId = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const agentRuns = [];
    const staleInputs = [];
    const warnings = [];
    const sourceSnapshotsUsed = [];

    // Inject snapshot data if available
    let indicatorData = null, newsData = null, fearGreedData = null;
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const indSnap = snapStore.getLatest('INDICATOR', sym);
        if (indSnap) { indicatorData = indSnap.payload; sourceSnapshotsUsed.push('INDICATOR'); if (indSnap.stale) staleInputs.push('INDICATOR'); }
        const newsSnap = snapStore.getLatest('NEWS');
        if (newsSnap) { newsData = newsSnap.payload; sourceSnapshotsUsed.push('NEWS'); if (newsSnap.stale) staleInputs.push('NEWS'); }
        const fgSnap = snapStore.getLatest('FEARGREED');
        if (fgSnap) { fearGreedData = fgSnap.payload; sourceSnapshotsUsed.push('FEARGREED'); if (fgSnap.stale) staleInputs.push('FEARGREED'); }
    } catch {}

    // Helper: extract text + metadata
    const extractResult = (settled, agentName, fallback) => {
        const run = { agent: agentName, model: 'unknown', latency_ms: 0, success: false };
        if (settled.status === 'fulfilled') {
            const val = settled.value;
            run.success = true;
            run.model = val?.model || 'unknown';
            run.latency_ms = val?.latencyMs || 0;
            if (typeof val === 'string') return { text: val, run };
            if (val && typeof val === 'object' && val.text) return { text: val.text, run };
            if (val && typeof val === 'object') return { text: JSON.stringify(val), run };
        }
        run.error = settled.reason?.message || 'unknown';
        return { text: fallback, run };
    };

    const sentExtra = fearGreedData ? `\nFear & Greed: ${JSON.stringify(fearGreedData)}` : '';
    const newsExtra = newsData ? `\nRecent headlines: ${JSON.stringify((newsData.headlines || []).slice(0, 5))}` : '';

    const startMs = Date.now();
    const [techR, sentR, newsR, riskR] = await Promise.allSettled([
        route([{ role: 'system', content: 'You are a professional Technical Analyst.' }, { role: 'user', content: buildTechnicalPrompt(sym, priceData || indicatorData) }], { taskType: 'trading_signal' }),
        route([{ role: 'system', content: 'You are a Sentiment Analyst.' }, { role: 'user', content: buildSentimentPrompt(sym) + sentExtra }], { taskType: 'news_sentiment' }),
        route([{ role: 'system', content: 'You are a Macro News Analyst.' }, { role: 'user', content: buildNewsPrompt(sym) + newsExtra }], { taskType: 'news_sentiment' }),
        route([{ role: 'system', content: 'You are a Risk Manager.' }, { role: 'user', content: buildRiskPrompt(sym, null) }], { taskType: 'market_analysis' }),
    ]);

    const tech = extractResult(techR, 'technical', '⚠️ Technical analysis unavailable.');
    const sent = extractResult(sentR, 'sentiment', '⚠️ Sentiment data unavailable.');
    const nws  = extractResult(newsR, 'news_macro', '⚠️ News analysis unavailable.');
    const rsk  = extractResult(riskR, 'risk', '⚠️ Risk assessment unavailable.');
    agentRuns.push(tech.run, sent.run, nws.run, rsk.run);

    if (!tech.run.success) warnings.push('Technical agent failed');
    if (!sent.run.success) warnings.push('Sentiment agent failed');
    if (!nws.run.success) warnings.push('News agent failed');
    if (!rsk.run.success) warnings.push('Risk agent failed');

    // CIO Synthesis
    let synthesis, synthRun;
    try {
        const synStart = Date.now();
        const synResult = await route([{ role: 'system', content: 'You are a CIO synthesizing research.' }, { role: 'user', content: buildSynthesisPrompt(sym, { technical: tech.text, sentiment: sent.text, news: nws.text, risk: rsk.text }) }], { taskType: 'trading_signal' });
        synthesis = (typeof synResult === 'string') ? synResult : synResult?.text || '⚠️ Synthesis unavailable.';
        synthRun = { agent: 'cio_synthesis', model: synResult?.model || 'unknown', latency_ms: Date.now() - synStart, success: true };
    } catch(e) {
        synthesis = '⚠️ Synthesis unavailable.';
        synthRun = { agent: 'cio_synthesis', model: 'unknown', latency_ms: 0, success: false, error: e.message };
    }
    agentRuns.push(synthRun);

    const successCount = agentRuns.filter(r => r.success).length;
    let confidence = Math.round(successCount / agentRuns.length * 100);
    if (staleInputs.length > 0) { confidence = Math.max(0, confidence - staleInputs.length * 10); warnings.push('Stale inputs: ' + staleInputs.join(', ')); }

    // v4.0: Hard confidence cap — AI must never claim certainty
    const CONFIDENCE_CAP = 88;
    if (confidence > CONFIDENCE_CAP) { confidence = CONFIDENCE_CAP; }

    // v4.0: Missing data honesty — penalize if macro/news snapshots are empty/stale
    if (!nws.text || nws.text.includes('unavailable') || nws.text.length < 20) {
        confidence = Math.max(0, confidence - 15);
        warnings.push('No recent news data — claims unverifiable');
    }
    if (sourceSnapshotsUsed.length === 0) {
        confidence = Math.max(0, confidence - 20);
        warnings.push('No source snapshots available — analysis is speculative');
    }


    // Build & save AiAnalysisSnapshot
    const analysisSnapshot = {
        run_id: runId, symbol: sym, timestamp: new Date().toISOString(),
        model_used: synthRun.model, provider_used: 'model_router',
        fallback_depth: agentRuns.filter(r => r.model !== agentRuns[0]?.model).length,
        technical_summary: tech.text.substring(0, 500), sentiment_summary: sent.text.substring(0, 500),
        news_macro_summary: nws.text.substring(0, 500), risk_summary: rsk.text.substring(0, 500),
        cio_synthesis: synthesis.substring(0, 500),
        final_action: 'ADVISORY', confidence,
        why_trade: 'See CIO synthesis', why_not_trade: warnings.length > 0 ? warnings.join('; ') : 'No issues',
        needed_confirmation: [], source_snapshots_used: sourceSnapshotsUsed,
        stale_inputs: staleInputs, warnings, agent_runs: agentRuns,
        total_latency_ms: Date.now() - startMs
    };

    try { require('./lib/snapshots/snapshot_store.cjs').put('ANALYSIS', sym, null, analysisSnapshot, { provider: 'tradingagents_bridge', source_timestamp: analysisSnapshot.timestamp }); } catch {}
    try { const { recordCall } = require('./api_counter.cjs'); agentRuns.forEach(r => { if (r.success) recordCall('lmstudio', true, r.latency_ms); }); } catch {}

    return formatAgentReport(sym, { technical: tech.text, sentiment: sent.text, news: nws.text, risk: rsk.text, synthesis }, analysisSnapshot);
}

function formatAgentReport(ticker, agents, snapshot = {}) {
    const { technical, sentiment, news, risk, synthesis } = agents;
    const now = new Date().toUTCString();
    const staleWarn = (snapshot.stale_inputs || []).length > 0 ? `\n⚠️ _Stale inputs: ${snapshot.stale_inputs.join(', ')}_` : '';
    const confBar = snapshot.confidence ? `\n📊 Confidence: ${'█'.repeat(Math.round((snapshot.confidence || 0) / 10))}${'░'.repeat(10 - Math.round((snapshot.confidence || 0) / 10))} ${snapshot.confidence}%` : '';

    return `🤖 *OpenClaw Multi-Agent Analysis: ${ticker}*
_5-Agent Pipeline: Technical + Sentiment + News + Risk + CIO_
_${now}_ | _Run: ${snapshot.run_id || 'N/A'}_${staleWarn}${confBar}

━━━━━━━━━━━━━━━━━━━━━━━
📐 *TECHNICAL ANALYST*
━━━━━━━━━━━━━━━━━━━━━━━
${technical}

━━━━━━━━━━━━━━━━━━━━━━━
💬 *SENTIMENT ANALYST*
━━━━━━━━━━━━━━━━━━━━━━━
${sentiment}

━━━━━━━━━━━━━━━━━━━━━━━
📰 *NEWS & MACRO ANALYST*
━━━━━━━━━━━━━━━━━━━━━━━
${news}

━━━━━━━━━━━━━━━━━━━━━━━
⚖️ *RISK MANAGER*
━━━━━━━━━━━━━━━━━━━━━━━
${risk}

━━━━━━━━━━━━━━━━━━━━━━━
🏛 *CIO SYNTHESIS*
━━━━━━━━━━━━━━━━━━━━━━━
${synthesis}

_Analysis only — not financial advice_`;
}

async function checkEnvironment() { return true; }

// ─── v5.1 Continuous Expert Reasoning Engine (Grounded + Safe) ────────────────
let _reasoningInterval = null;

async function startContinuousReasoningLoop() {
    if (_reasoningInterval) return;
    console.log('[ReasoningEngine] 🧠 v5.1 Background Reasoning Loop started (grounded, safe)');
    
    _reasoningInterval = setInterval(async () => {
        try {
            const syms = ['XAUUSD', 'BTC', 'EURUSD'];
            const target = syms[Math.floor(Math.random() * syms.length)];
            const snapStore = require('./lib/snapshots/snapshot_store.cjs');
            
            // v5.1: Check snapshot freshness before reasoning
            const mSnap = snapStore.get('MARKET', target);
            const iSnap = snapStore.get('INDICATOR', target);
            const staleInputs = [];
            if (!mSnap || mSnap.stale) staleInputs.push('MARKET');
            if (!iSnap || iSnap.stale) staleInputs.push('INDICATOR');
            
            // Build grounding context from live data
            let grounding = '';
            if (mSnap && !mSnap.stale) grounding += `Current price: $${mSnap.data?.price}. `;
            if (iSnap && !iSnap.stale) grounding += `RSI: ${iSnap.data?.rsi}, Trend: ${iSnap.data?.trend}. `;
            if (!grounding) grounding = 'No live data available — use general knowledge only. ';
            
            const prompt = `${grounding}\nAnalyze ${target} for institutional patterns (Wyckoff, ICT FVG, Order Blocks, Liquidity Sweeps). ` +
                `IMPORTANT: Do NOT invent specific prices or indicator values. If no live data above, say "insufficient data". ` +
                `Output JSON: { "pattern_detected": string, "confidence": number (max 70), "rationale": string, "data_quality": "LIVE"|"STALE"|"NONE" }`;
            
            const { callLLM } = require('./lib/llm_router.cjs');
            const res = await callLLM([{ role: 'user', content: prompt }], 'REASONING_LOOP');
            
            if (res && res.text) {
                snapStore.put('BACKGROUND_REASONING', target, null, {
                    thought: res.text,
                    target,
                    model: res.model,
                    grounded: !!grounding,
                    stale_inputs: staleInputs,
                    data_quality: staleInputs.length === 0 ? 'LIVE' : staleInputs.length <= 1 ? 'PARTIAL' : 'NONE',
                    is_trade_signal: false,
                    status: 'ADVISORY_ONLY',
                    disclaimer: 'Background reasoning — not a trade signal'
                }, { provider: 'llm_reasoning' });
                
                console.log(`[ReasoningEngine] Thought saved for ${target}. Model: ${res.model} | Quality: ${staleInputs.length === 0 ? 'LIVE' : 'PARTIAL'}`);
            }
        } catch (e) {
            console.log(`[ReasoningEngine] Minor reasoning loop hiccup: ${e.message}`);
        }
    }, 10 * 60 * 1000); // Every 10 minutes
}

// Added critical reasoning request function
async function requestCriticalReasoning(symbol) {
    try {
        const prompt = `Analyze ${symbol} for complex institutional patterns (Wyckoff, ICT Fair Value Gaps, Order Blocks, Liquidity Sweeps) with high confidence. Output JSON { pattern, confidence, rationale }.`;
        const { callLLM } = require('./lib/llm_router.cjs');
        const res = await callLLM([{ role: 'user', content: prompt }], 'CRITICAL_REASONING');
        if (res && res.text) {
            // Save as critical snapshot
            const snapStore = require('./lib/snapshots/snapshot_store.cjs');
            snapStore.put('CRITICAL_REASONING', symbol, null, { thought: res.text, model: res.model }, { provider: 'llm_reasoning', critical: true });
            return { success: true, data: res.text };
        }
    } catch (e) {
        console.error('[CriticalReasoning] error', e);
    }
    return { success: false };
}

module.exports = {
    runAgentAnalysis,
    checkEnvironment,
    startContinuousReasoningLoop,
    requestCriticalReasoning,
    getProvider
};
