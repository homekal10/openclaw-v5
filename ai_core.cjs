/**
 * ai_core.cjs — Multi-provider AI reasoning engine
 * Now powered by model_router.cjs (Intelligent Networked LLM System)
 *   1. DeepSeek API (free, reasoning)    DEEPSEEK_API_KEY set in telegram.env
 *   2. Google Gemini (fast, free)        GEMINI_API_KEY — add yours to telegram.env
 *   3. LM Studio (local, private)        http://localhost:1234/v1 confirmed working
 *   4. Puter Grok (free, unlimited)      PUTER_AUTH_TOKEN — optional
 *   5. Grok xAI direct (cloud)           XAI_API_KEY set in telegram.env
 */

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });
const { getKnowledgeRules, saveKnowledgeRule } = require('./database.cjs');
const router = require('./model_router.cjs');

const PROFILE_PATH = path.join(__dirname, 'kaleb_profile.json');
const LOG_PATH     = path.join(__dirname, 'memory_log.json');

function saveInteraction(userQuery, aiResponse, role) {
    let logs = [];
    if (fs.existsSync(LOG_PATH)) {
        try { logs = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch(e) {}
    }
    logs.push({ timestamp: new Date().toISOString(), query: userQuery, role, response: aiResponse.substring(0, 500) });
    if (logs.length > 100) logs = logs.slice(-100);
    fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
}

const ROLES = {
    DIGITAL_TWIN:          "You are the Digital Twin of Kaleb Alemayehu — an expert AI Systems Builder, Startup Architect, and Automation Engineer from Ethiopia. Think and respond as Kaleb would: strategically, technically, and with entrepreneurial vision.",
    SOCIAL_MEDIA_MANAGER:  "You are Kaleb's elite Social Media Manager. Specialize in TikTok, Instagram, YouTube, LinkedIn. Create viral hooks, scripts, and 30-day content calendars. Tone: expert but relatable.",
    TRADING_ANALYST:       "You are an elite Trading Analyst and Quant. Provide structured trade ideas with clear entry, stop loss, take profit, and risk/reward. Always add: 'Analysis only — not financial advice.'",
    BUSINESS_ARCHITECT:    "You are a Senior Business Architect. Specialize in startup ideas, monetization architectures, investor-ready system design, and scalable business models.",
    AUTOMATION_ENGINEER:   "You are an Elite Automation Engineer. Design robust workflows using n8n, APIs, Playwright, and the OpenClaw AI ecosystem."
};

function determineRole(query) {
    if (/trade|btc|eth|crypto|market|stock|buy|sell|forex|signal|gold|xauusd|eurusd/i.test(query)) return 'TRADING_ANALYST';
    if (/tiktok|instagram|youtube|linkedin|social|content|post|growth|viral|hook|reel/i.test(query)) return 'SOCIAL_MEDIA_MANAGER';
    if (/business|startup|monetize|scale|investor|revenue|funding|product/i.test(query)) return 'BUSINESS_ARCHITECT';
    if (/automate|workflow|n8n|api|code|system|bot|script|playwright/i.test(query)) return 'AUTOMATION_ENGINEER';
    return 'DIGITAL_TWIN';
}

function stripThinkTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER 1 — LM Studio (local, free, confirmed working)
// URL: http://localhost:1234/v1 (OpenAI-compatible)
// No API key required. Keep LM Studio app running.
// ═══════════════════════════════════════════════════════════════
const LM_BASE        = process.env.AI_BASE_URL || 'http://localhost:1234';
const LM_MODEL_CHAIN = [
    process.env.MODEL_FAST    || 'google/gemma-3-4b',          // fastest
    process.env.MODEL_FALLBACK || 'zai-org/glm-4.6v-flash',   // medium
    process.env.MODEL_PRIMARY  || 'phi-3.1-mini-128k-instruct' // heavy fallback
];

async function fetchFromLMStudio(messages, timeoutMs = 25000) {
    // Quick ping (3s max)
    try {
        const pingCtrl = new AbortController();
        setTimeout(() => pingCtrl.abort(), 3000);
        const ping = await fetch(`${LM_BASE}/v1/models`, { signal: pingCtrl.signal }).catch(() => null);
        if (!ping?.ok) return null;
        const available = await ping.json().then(d => d?.data?.map(m => m.id) || []).catch(() => []);

        for (const modelId of LM_MODEL_CHAIN) {
            if (available.length > 0 && !available.includes(modelId)) continue;
            try {
                const ctrl  = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), timeoutMs);
                const res   = await fetch(`${LM_BASE}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: ctrl.signal,
                    body: JSON.stringify({ model: modelId, messages, max_tokens: 500, temperature: 0.3, stream: false })
                });
                clearTimeout(timer);
                if (res.ok) {
                    const data = await res.json();
                    const text = stripThinkTags(data.choices?.[0]?.message?.content || '');
                    if (text) { console.log(`[AI] LMStudio → ${modelId}`); return text; }
                }
            } catch(e) {
                if (e.name === 'AbortError') console.log(`[AI] LMStudio: ${modelId} timed out (${timeoutMs/1000}s) — next model`);
            }
        }
    } catch(e) {}
    return null;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER 2 — Puter Grok (free, unlimited via Puter account)
// To enable: Get token from https://puter.com → DevTools Console:
//   localStorage.getItem('puter_auth_token')
// Then add to telegram.env: PUTER_AUTH_TOKEN=your_token_here
// Model: x-ai/grok-4.20 (free via Puter's free tier)
// ═══════════════════════════════════════════════════════════════
async function fetchFromPuterGrok(messages) {
    const token = process.env.PUTER_AUTH_TOKEN;
    if (!token) return null;

    const model = process.env.PUTER_MODEL || 'x-ai/grok-4.20';
    try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        const res   = await fetch('https://api.puter.com/drivers/call', {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`
            },
            signal: ctrl.signal,
            body: JSON.stringify({
                interface: 'puter-chat-completion',
                method:    'complete',
                args: { model, messages, max_tokens: 800, temperature: 0.3 }
            })
        });
        clearTimeout(timer);
        if (res.ok) {
            const data = await res.json();
            const text = stripThinkTags(
                data?.result?.message?.content ||
                data?.result?.choices?.[0]?.message?.content || ''
            );
            if (text) { console.log(`[AI] Puter Grok (${model}) responded`); return text; }
        } else {
            const err = await res.text();
            if (res.status === 401 || res.status === 403) {
                console.warn('[AI] Puter: Token expired. Refresh PUTER_AUTH_TOKEN in telegram.env');
            } else {
                console.warn(`[AI] Puter: ${res.status} — ${err.substring(0, 100)}`);
            }
        }
    } catch(e) {
        if (e.name !== 'AbortError') console.warn('[AI] Puter error:', e.message.substring(0, 60));
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER 3 — Grok xAI Direct (cloud, fast, needs paid credits)
// Add to telegram.env: XAI_API_KEY=xai-...
// ═══════════════════════════════════════════════════════════════
async function fetchFromGrok(messages) {
    const apiKey  = process.env.XAI_API_KEY;
    const baseUrl = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
    const model   = process.env.GROK_MODEL    || 'grok-3-fast';
    if (!apiKey) return null;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            signal:  controller.signal,
            body:    JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.7 })
        });
        clearTimeout(timer);
        if (res.ok) {
            const data = await res.json();
            const text = stripThinkTags(data.choices?.[0]?.message?.content || '');
            if (text) { console.log('[AI] Grok xAI responded'); return text; }
        }
        if (res.status === 403) console.warn('[AI] Grok: Account needs credits at https://console.x.ai');
    } catch(e) {
        if (e.name !== 'AbortError') console.error('[AI] Grok error:', e.message);
    }
    return null;
}


async function infer(prompt, roleKey) {
    let profile = {};
    if (fs.existsSync(PROFILE_PATH)) {
        try { profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8')); } catch(e) {}
    }

    const systemPrompt = `${ROLES[roleKey]}

USER PROFILE (Kaleb Alemayehu):
Name: ${profile.NAME || 'Kaleb'} | Role: ${profile.ROLE || 'AI Systems Builder & Startup Architect'}
Skills: ${(profile.SKILLS || []).slice(0,5).join(', ')}
Projects: ${(profile.PROJECTS || []).join(', ')}
Goals: ${(profile.GOALS || []).join(', ')}

SYSTEM KNOWLEDGE (Learned Rules):
${getKnowledgeRules().map(r => `• ${r.rule}`).join('\n') || 'No rules learned yet.'}

RESPONSE FORMAT (strict):
[ROLE] ${roleKey}
[THINKING] Brief expert reasoning
[STRATEGY] Key strategic insight
[ACTION STEPS]
1. ...
2. ...
3. ...
[AUTOMATION] OpenClaw/n8n/API automation idea

IMPORTANT: Reply ONLY in English. Be concise, expert, and actionable.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
    ];

    // Extract potential rules explicitly stated by the user
    if (/always|never|remember|rule:/i.test(prompt) && prompt.length < 200) {
        saveKnowledgeRule(prompt.trim());
    }

    // Route through the intelligent model router
    const result = await router.route(messages, { taskType: router.TASK_TYPES.GENERAL_CHAT });
    if (result.text) {
        saveInteraction(prompt, result.text, roleKey);
        return `${result.text}\n\n_[Model: ${result.model} | ${result.latencyMs}ms]_`;
    }

    return [
        '❌ No AI provider responded.\n',
        '• DeepSeek: Key set ✅ (check platform.deepseek.com balance)',
        '• LM Studio: Ensure app is running → http://localhost:1234',
        '• Gemini: Add GEMINI_API_KEY to telegram.env',
        '• Puter Grok: Add PUTER_AUTH_TOKEN to telegram.env',
        '• Grok xAI: Add XAI_API_KEY to telegram.env'
    ].join('\n');
}

// Direct trading analysis — uses router's dedicated trading route
async function tradingAnalysis(prompt) {
    const result = await router.routeTrading(prompt);
    return result.text || null;
}

module.exports = {
    infer, determineRole, tradingAnalysis,
    // Router exports — all providers accessible
    router,
    routeTrading:   router.routeTrading,
    routeChat:      router.routeChat,
    routeSentiment: router.routeSentiment,
    getRouterStatus: router.getRouterStatus,
    classifyQuery:  router.classifyQuery,
    // Individual providers (for direct use)
    fetchFromGrok:      router.callGrok,
    fetchFromLMStudio:  router.callLMStudio,
    fetchFromPuterGrok: router.callPuterGrok,
    fetchFromDeepSeek:  router.callDeepSeek,
    fetchFromGemini:    router.callGemini
};
