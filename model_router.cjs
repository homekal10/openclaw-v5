/**
 * model_router.cjs — OpenClaw Intelligent LLM Router
 *
 * Networked LLM Models (5 providers):
 *   1. DeepSeek API      (reasoning champion — free tier)
 *   2. Google Gemini     (fast, multimodal — free tier)
 *   3. LM Studio         (local, private, always available)
 *   4. Puter Grok        (free unlimited — needs PUTER_AUTH_TOKEN)
 *   5. Grok xAI direct   (cloud, fast — needs credits)
 *
 * Intelligence Features:
 *   - Query classifier (7 task types)
 *   - Per-task model routing table
 *   - Performance tracking (speed, success rate)
 *   - Adaptive learning (boosts reliable models)
 *   - Smart fallback chain
 *   - Response quality validator
 */

'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const PERF_LOG = path.join(__dirname, 'logs', 'model_performance.json');

// ─── Quota Cooldown Cache (in-memory) ────────────────────────────────────────
// When a provider hits quota/rate-limit, skip it for COOLDOWN_MS before retrying
const COOLDOWN_MS  = 60 * 60 * 1000; // 1 hour
const _quotaCooldown = {}; // { modelKey: expiresAtMs }

function markCoolingDown(modelKey, ms = COOLDOWN_MS) {
    _quotaCooldown[modelKey] = Date.now() + ms;
    console.warn(`[Router] ⏳ ${modelKey} quota exceeded — cooling down for ${Math.round(ms/60000)} min`);
}
function isCoolingDown(modelKey) {
    const exp = _quotaCooldown[modelKey];
    if (!exp) return false;
    if (Date.now() > exp) { delete _quotaCooldown[modelKey]; return false; }
    return true;
}
function getCooldownStatus() {
    const now = Date.now();
    return Object.entries(_quotaCooldown)
        .filter(([, exp]) => now < exp)
        .map(([k, exp]) => ({ provider: k, resumesIn: Math.round((exp - now) / 60000) + 'min' }));
}

// ─── Performance Tracker (persisted across restarts) ─────────────────────────
function loadPerf() {
    try { return JSON.parse(fs.readFileSync(PERF_LOG, 'utf8')); }
    catch(e) { return {}; }
}
function savePerf(data) {
    try { fs.writeFileSync(PERF_LOG, JSON.stringify(data, null, 2)); } catch(e) {}
}

function recordResult(modelKey, success, latencyMs) {
    const perf = loadPerf();
    if (!perf[modelKey]) perf[modelKey] = { calls: 0, successes: 0, totalMs: 0, avgMs: 0, rate: 1.0 };
    const p = perf[modelKey];
    p.calls++;
    if (success) p.successes++;
    p.totalMs += latencyMs;
    p.avgMs   = Math.round(p.totalMs / p.calls);
    p.rate    = parseFloat((p.successes / p.calls).toFixed(2));
    p.lastUsed = new Date().toISOString();
    savePerf(perf);
}

function getModelScore(modelKey) {
    const perf = loadPerf();
    const p    = perf[modelKey];
    if (!p || p.calls < 3) return 1.0; // No data yet — trust fully
    // Score = success_rate * (1 - latency_penalty)
    // Latency penalty: 0 for <2s, scales to 0.3 for 30s+
    const latPenalty = Math.min(0.3, p.avgMs / 100000);
    return parseFloat((p.rate * (1 - latPenalty)).toFixed(3));
}

// ─── Task Classifier ──────────────────────────────────────────────────────────
const TASK_TYPES = {
    TRADING_SIGNAL:    'trading_signal',    // /signal, entry/exit decisions
    MARKET_ANALYSIS:   'market_analysis',   // macro, regime, sector analysis
    NEWS_SENTIMENT:    'news_sentiment',    // headline scoring, sentiment
    CODE_REASONING:    'code_reasoning',    // technical/logic problems
    GENERAL_CHAT:      'general_chat',      // /chat, conversational
    CREATIVE:          'creative',          // content, social media posts
    QUICK_CLASSIFY:    'quick_classify'     // fast yes/no, score only tasks
};

function classifyQuery(prompt) {
    const p = (prompt || '').toLowerCase();

    if (/entry|exit|buy|sell|fvg|sweep|rr ratio|stop loss|take profit|signal|setup|structure/i.test(p))
        return TASK_TYPES.TRADING_SIGNAL;

    if (/regime|macro|fomc|cpi|nfp|interest rate|inflation|gdp|central bank|risk.?on|risk.?off/i.test(p))
        return TASK_TYPES.MARKET_ANALYSIS;

    if (/headline|news|sentiment|bullish|bearish|score this|impact|article|press release/i.test(p))
        return TASK_TYPES.NEWS_SENTIMENT;

    if (/code|function|debug|algorithm|script|logic|explain.*code|implement/i.test(p))
        return TASK_TYPES.CODE_REASONING;

    if (/tiktok|instagram|linkedin|post|content|hook|viral|caption|social/i.test(p))
        return TASK_TYPES.CREATIVE;

    if (/score|classify|yes.?or.?no|true.?or.?false|is it|what is the|rank/i.test(p))
        return TASK_TYPES.QUICK_CLASSIFY;

    return TASK_TYPES.GENERAL_CHAT;
}

// ─── Routing Table — Best model per task type ─────────────────────────────────
// Each array is tried in order. Lower index = higher preference.
const ROUTING_TABLE = {
    [TASK_TYPES.TRADING_SIGNAL]:  ['aicc', 'deepseek_reasoner', 'grok', 'lmstudio', 'gemini', 'deepseek'],
    [TASK_TYPES.MARKET_ANALYSIS]: ['aicc', 'grok', 'lmstudio', 'deepseek', 'gemini'],
    [TASK_TYPES.NEWS_SENTIMENT]:  ['aicc', 'deepseek', 'lmstudio', 'gemini', 'grok'],
    [TASK_TYPES.CODE_REASONING]:  ['aicc', 'deepseek_reasoner', 'lmstudio', 'deepseek', 'gemini'],
    [TASK_TYPES.GENERAL_CHAT]:    ['aicc', 'gemini', 'lmstudio', 'deepseek', 'grok'],
    [TASK_TYPES.CREATIVE]:        ['aicc', 'grok', 'lmstudio', 'gemini', 'deepseek'],
    [TASK_TYPES.QUICK_CLASSIFY]:  ['aicc', 'deepseek', 'lmstudio', 'gemini'],
};

// ─── Provider Implementations ─────────────────────────────────────────────────

function stripThink(text) {
    return (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** AICC API (OpenAI Compatible) */
async function callAICC(messages) {
    const key = process.env.AICC_API_KEY;
    if (!key || key.length < 10) return null;
    if (isCoolingDown('aicc')) return null;
    const base = process.env.AICC_BASE_URL || 'https://api.ai.cc/v1';
    const model = process.env.AICC_MODEL || 'gpt-4o-mini';
    try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 35000);
        const res   = await fetch(`${base}/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            signal:  ctrl.signal,
            body:    JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.3 })
        });
        clearTimeout(timer);
        if (res.ok) {
            const d    = await res.json();
            const text = stripThink(d.choices?.[0]?.message?.content || '');
            if (text) return text;
        }
        if (res.status === 402 || res.status === 403) {
            markCoolingDown('aicc', 60 * 60 * 1000); // 1h
            console.warn(`[Router] AICC: ${res.status} — verify credits or key at ai.cc`);
        } else if (res.status === 429) {
            markCoolingDown('aicc');
        } else {
            console.warn('[Router] AICC HTTP status:', res.status);
        }
    } catch(e) {
        if (e.name !== 'AbortError') console.warn('[Router] AICC error:', e.message.substring(0, 60));
    }
    return null;
}

/** DeepSeek Chat — fast, instruction-following, free */
async function callDeepSeek(messages, reasoner = false) {
    const key   = process.env.DEEPSEEK_API_KEY;
    if (!key || key.length < 10) return null;
    const modelKey = reasoner ? 'deepseek_reasoner' : 'deepseek';
    if (isCoolingDown(modelKey)) return null;
    const base  = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
    const model = reasoner
        ? (process.env.DEEPSEEK_REASONER || 'deepseek-reasoner')
        : (process.env.DEEPSEEK_MODEL    || 'deepseek-chat');
    try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        const res   = await fetch(`${base}/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            signal:  ctrl.signal,
            body:    JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.3 })
        });
        clearTimeout(timer);
        if (res.ok) {
            const d    = await res.json();
            const text = stripThink(d.choices?.[0]?.message?.content || '');
            if (text) return text;
        }
        if (res.status === 402) {
            markCoolingDown(modelKey, 24 * 60 * 60 * 1000); // 24h — needs top-up
            console.warn('[Router] DeepSeek: balance $0 — top up at platform.deepseek.com');
        } else if (res.status === 429) {
            markCoolingDown(modelKey);
        } else {
            console.warn('[Router] DeepSeek:', res.status);
        }
    } catch(e) {
        if (e.name !== 'AbortError') console.warn('[Router] DeepSeek error:', e.message.substring(0, 60));
    }
    return null;
}

/** Google Gemini — fast, free, multimodal */
async function callGemini(messages, retry = true) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'PASTE_YOUR_GEMINI_KEY_HERE' || key.length < 10) return null;
    if (isCoolingDown('gemini')) return null;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        const res   = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                signal:  ctrl.signal,
                body:    JSON.stringify({
                    system_instruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
                    contents,
                    generationConfig: { temperature: 0.3, maxOutputTokens: 800 }
                })
            }
        );
        clearTimeout(timer);
        if (res.ok) {
            const d    = await res.json();
            const text = stripThink(d.candidates?.[0]?.content?.parts?.[0]?.text || '');
            if (text) return text;
        }
        if (res.status === 429) {
            if (retry) {
                console.log('[Router] Gemini: rate limited — retrying in 4s...');
                await new Promise(r => setTimeout(r, 4000));
                return callGemini(messages, false);
            }
            // Second 429 = daily quota exhausted — cool down for 1 hour
            markCoolingDown('gemini', COOLDOWN_MS);
            console.warn('[Router] Gemini: daily quota exhausted. Resets at midnight PT.');
            console.warn('[Router] Gemini: enable billing at console.cloud.google.com for higher limits.');
        } else if (res.status === 403) {
            markCoolingDown('gemini', 6 * 60 * 60 * 1000); // 6h for 403
            console.warn('[Router] Gemini: 403 — check API key restrictions');
        } else {
            console.warn('[Router] Gemini:', res.status);
        }
    } catch(e) {
        if (e.name !== 'AbortError') console.warn('[Router] Gemini error:', e.message.substring(0, 60));
    }
    return null;
}

/** LM Studio — local, always available */
const LM_MODELS = [
    process.env.MODEL_FAST     || 'google/gemma-3-4b',
    process.env.MODEL_FALLBACK || 'zai-org/glm-4.6v-flash',
    process.env.MODEL_PRIMARY  || 'phi-3.1-mini-128k-instruct'
];
async function callLMStudio(messages) {
    const base = process.env.AI_BASE_URL || 'http://localhost:1234';
    try {
        const pingCtrl = new AbortController();
        setTimeout(() => pingCtrl.abort(), 3000);
        const ping = await fetch(`${base}/v1/models`, { signal: pingCtrl.signal }).catch(() => null);
        if (!ping?.ok) return null;
        const available = await ping.json().then(d => d?.data?.map(m => m.id) || []).catch(() => []);
        for (const modelId of LM_MODELS) {
            if (available.length > 0 && !available.includes(modelId)) continue;
            try {
                const ctrl  = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 60000);
                const res   = await fetch(`${base}/v1/chat/completions`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal:  ctrl.signal,
                    body:    JSON.stringify({ model: modelId, messages, max_tokens: 500, temperature: 0.3, stream: false })
                });
                clearTimeout(timer);
                if (res.ok) {
                    const d    = await res.json();
                    const text = stripThink(d.choices?.[0]?.message?.content || '');
                    if (text) return text;
                }
            } catch(e) {
                if (e.name === 'AbortError') console.log(`[Router] LMStudio: ${modelId} timed out`);
            }
        }
    } catch(e) {}
    return null;
}

/** Puter Grok — free when PUTER_AUTH_TOKEN is set */
async function callPuterGrok(messages) {
    const token = process.env.PUTER_AUTH_TOKEN;
    if (!token || token.length < 10) return null;
    const model = process.env.PUTER_MODEL || 'x-ai/grok-4.20';
    try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        const res   = await fetch('https://api.puter.com/drivers/call', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            signal:  ctrl.signal,
            body:    JSON.stringify({ interface: 'puter-chat-completion', method: 'complete', args: { model, messages, max_tokens: 800, temperature: 0.3 } })
        });
        clearTimeout(timer);
        if (res.ok) {
            const d    = await res.json();
            const text = stripThink(d?.result?.message?.content || d?.result?.choices?.[0]?.message?.content || '');
            if (text) return text;
        }
        if (res.status === 401 || res.status === 403) console.warn('[Router] Puter: Token expired');
    } catch(e) {}
    return null;
}

/** Grok xAI — cloud, fast */
async function callGrok(messages) {
    const key = process.env.XAI_API_KEY;
    if (!key || key.length < 10) return null;
    const model = process.env.GROK_MODEL || 'grok-3-fast';
    try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        const res   = await fetch(`${process.env.XAI_BASE_URL || 'https://api.x.ai/v1'}/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            signal:  ctrl.signal,
            body:    JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.4 })
        });
        clearTimeout(timer);
        if (res.ok) {
            const d    = await res.json();
            const text = stripThink(d.choices?.[0]?.message?.content || '');
            if (text) return text;
        }
        if (res.status === 403) console.warn('[Router] Grok xAI: Needs credits at console.x.ai');
    } catch(e) {}
    return null;
}

// ─── Provider Map ─────────────────────────────────────────────────────────────
const PROVIDERS = {
    aicc:              (msgs) => callAICC(msgs),
    deepseek_reasoner: (msgs) => callDeepSeek(msgs, true),
    deepseek:          (msgs) => callDeepSeek(msgs, false),
    gemini:            (msgs) => callGemini(msgs),
    lmstudio:          (msgs) => callLMStudio(msgs),
    puter:             (msgs) => callPuterGrok(msgs),
    grok:              (msgs) => callGrok(msgs),
};

// ─── Response Quality Validator ───────────────────────────────────────────────
function validateResponse(text, taskType) {
    if (!text || text.length < 10) return false;
    // Must not be an error message
    if (/error|failed|cannot|unable|sorry/i.test(text) && text.length < 80) return false;
    // Trading signals must have some structure
    if (taskType === TASK_TYPES.TRADING_SIGNAL) {
        return text.length > 30; // At least a short analysis
    }
    return true;
}

// ─── Main Router Function ─────────────────────────────────────────────────────
/**
 * route(messages, options) → { text, model, taskType, latencyMs }
 *
 * Intelligently selects and calls the best available model.
 * Falls back through the chain until a valid response is obtained.
 */
async function route(messages, options = {}) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const taskType    = options.taskType || classifyQuery(lastUserMsg);
    const chain       = options.chain    || ROUTING_TABLE[taskType] || ROUTING_TABLE[TASK_TYPES.GENERAL_CHAT];

    // Sort chain by learned performance score (higher = try first)
    const sortedChain = [...chain].sort((a, b) => getModelScore(b) - getModelScore(a));

    console.log(`[Router] Task: ${taskType} | Chain: ${sortedChain.join(' → ')}`);

    for (const modelKey of sortedChain) {
        const provider = PROVIDERS[modelKey];
        if (!provider) continue;

        const t0 = Date.now();
        try {
            const text    = await provider(messages);
            const elapsed = Date.now() - t0;

            if (text && validateResponse(text, taskType)) {
                recordResult(modelKey, true, elapsed);
                console.log(`[Router] ✅ ${modelKey} responded (${elapsed}ms, ${text.length} chars)`);
                return { text, model: modelKey, taskType, latencyMs: elapsed };
            } else {
                recordResult(modelKey, false, elapsed);
                console.log(`[Router] ❌ ${modelKey} failed or empty (${elapsed}ms)`);
            }
        } catch(e) {
            recordResult(modelKey, false, Date.now() - t0);
            console.log(`[Router] ❌ ${modelKey} threw: ${e.message.substring(0, 50)}`);
        }
    }

    return { text: null, model: 'none', taskType, latencyMs: 0 };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────
async function routeTrading(userPrompt, systemPrompt = 'You are an institutional trading analyst. Reply in JSON only. No preamble.') {
    return route(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { taskType: TASK_TYPES.TRADING_SIGNAL }
    );
}

async function routeChat(userPrompt, systemPrompt = 'You are an expert AI assistant.') {
    return route(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { taskType: TASK_TYPES.GENERAL_CHAT }
    );
}

async function routeSentiment(headline) {
    return route(
        [
            { role: 'system', content: 'You are a financial news sentiment classifier. Reply in JSON: {"score":0.7,"direction":"bullish","confidence":"high","asset":"XAUUSD"}' },
            { role: 'user',   content: `Classify this headline: "${headline}"` }
        ],
        { taskType: TASK_TYPES.NEWS_SENTIMENT }
    );
}

// ─── Status Report ────────────────────────────────────────────────────────────
function getRouterStatus() {
    const perf = loadPerf();
    const status = {};
    for (const [key, fn] of Object.entries(PROVIDERS)) {
        const p = perf[key];
        status[key] = {
            configured: key === 'lmstudio' ? true
                : key === 'aicc'           ? !!(process.env.AICC_API_KEY?.length > 10)
                : key === 'deepseek'       ? !!(process.env.DEEPSEEK_API_KEY?.length > 10)
                : key === 'deepseek_reasoner' ? !!(process.env.DEEPSEEK_API_KEY?.length > 10)
                : key === 'gemini'         ? !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'PASTE_YOUR_GEMINI_KEY_HERE')
                : key === 'puter'          ? !!(process.env.PUTER_AUTH_TOKEN?.length > 10)
                : key === 'grok'           ? !!(process.env.XAI_API_KEY?.length > 10)
                : false,
            calls:   p?.calls      || 0,
            rate:    p?.rate       || 'new',
            avgMs:   p?.avgMs      || 0,
            score:   getModelScore(key)
        };
    }
    return status;
}

module.exports = {
    route, routeTrading, routeChat, routeSentiment,
    classifyQuery, getRouterStatus,
    TASK_TYPES, PROVIDERS,
    callAICC, callDeepSeek, callGemini, callLMStudio, callPuterGrok, callGrok
};
