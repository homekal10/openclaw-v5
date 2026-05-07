/**
 * api_counter.cjs — OpenClaw Smart API Usage Counter v1.0
 *
 * Features:
 *   1. Per-provider call tracking (hourly, daily, monthly)
 *   2. Quota prediction: "At current rate, exhausts in X hours"
 *   3. Smart throttling: Auto-slow when approaching quota
 *   4. Cost tracking for paid providers
 *   5. Dashboard widget data
 *   6. /api-usage Telegram command
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const COUNTER_FILE = path.join(__dirname, 'logs', 'api_counters.json');
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ─── Quota Definitions ────────────────────────────────────────────────────────
const QUOTAS = {
    coinapi:     { daily: 100,    monthly: 3000,   cost: 0,       name: 'CoinAPI',        tier: 'free' },
    coingecko:   { daily: 10000,  monthly: 300000, cost: 0,       name: 'CoinGecko',      tier: 'free' },
    binance:     { daily: 86400,  monthly: null,   cost: 0,       name: 'Binance',        tier: 'free' },
    yahoo:       { daily: 2000,   monthly: 60000,  cost: 0,       name: 'Yahoo Finance',  tier: 'free' },
    deepseek:    { daily: 200,    monthly: 6000,   cost: 0.002,   name: 'DeepSeek',       tier: 'free' },
    gemini:      { daily: 1500,   monthly: 45000,  cost: 0,       name: 'Google Gemini',  tier: 'free' },
    puter_grok:  { daily: null,   monthly: null,   cost: 0,       name: 'Puter Grok',     tier: 'free' },
    lm_studio:   { daily: null,   monthly: null,   cost: 0,       name: 'LM Studio',      tier: 'local' },
    grok_xai:    { daily: 1000,   monthly: 30000,  cost: 0.005,   name: 'Grok xAI',       tier: 'free' },
    massive_api: { daily: 500,    monthly: 15000,  cost: 0,       name: 'Massive API',    tier: 'free' },
    remora:      { daily: 200,    monthly: 6000,   cost: 0,       name: 'Remora Risk',    tier: 'free' },
    quickchart:  { daily: null,   monthly: null,   cost: 0,       name: 'QuickChart',     tier: 'free' },
    supabase:    { daily: 500,    monthly: 15000,  cost: 0,       name: 'Supabase',       tier: 'free' },
    snapshot_store: { daily: null, monthly: null,  cost: 0,       name: 'Snapshot Store', tier: 'local' },
    // Paid placeholders
    polygon:     { daily: 5000,   monthly: 150000, cost: 0.00001, name: 'Polygon.io',     tier: 'paid_placeholder' },
    twelve_data: { daily: 800,    monthly: 24000,  cost: 0,       name: 'Twelve Data',    tier: 'paid_placeholder' },
    tradingview: { daily: null,   monthly: null,   cost: 15,      name: 'TradingView',    tier: 'paid_placeholder' },
    alpaca:      { daily: 10000,  monthly: 300000, cost: 0,       name: 'Alpaca',         tier: 'paid_placeholder' }
};

// ─── Counter Storage ──────────────────────────────────────────────────────────

function loadCounters() {
    try {
        const data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
        // Reset daily/hourly if date changed
        const today = new Date().toISOString().split('T')[0];
        if (data._date !== today) {
            for (const key of Object.keys(data)) {
                if (key.startsWith('_')) continue;
                data[key].hourly = 0;
                data[key].daily  = 0;
                if (data._month !== new Date().getMonth()) {
                    data[key].monthly = 0;
                }
            }
            data._date  = today;
            data._month = new Date().getMonth();
            saveCounters(data);
        }
        return data;
    } catch {
        return { _date: new Date().toISOString().split('T')[0], _month: new Date().getMonth() };
    }
}

function saveCounters(data) {
    try { fs.writeFileSync(COUNTER_FILE, JSON.stringify(data, null, 2)); } catch {}
}

// ─── Record API Call ──────────────────────────────────────────────────────────

/**
 * Record an API call with extended tracking.
 * @param {string} provider - Provider key
 * @param {boolean} success - Whether the call succeeded
 * @param {number} latencyMs - Call latency
 * @param {object} opts - { type: 'fetch'|'cache_hit'|'cache_miss'|'fallback'|'error', caller: 'scheduler'|'telegram'|'dashboard'|'manual' }
 */
function recordCall(provider, success = true, latencyMs = 0, opts = {}) {
    const counters = loadCounters();
    if (!counters[provider]) {
        counters[provider] = {
            hourly: 0, daily: 0, monthly: 0, total: 0, errors: 0,
            avgLatency: 0, lastCall: null, lastError: null, lastSuccess: null,
            cache_hits: 0, cache_misses: 0, fallback_calls: 0, failed_calls: 0,
            callers: {}
        };
    }

    const c = counters[provider];
    c.hourly++;
    c.daily++;
    c.monthly++;
    c.total++;
    if (!success) {
        c.errors++;
        c.failed_calls++;
        c.lastError = new Date().toISOString();
    } else {
        c.lastSuccess = new Date().toISOString();
    }
    c.avgLatency = c.total > 1 ? Math.round((c.avgLatency * (c.total - 1) + latencyMs) / c.total) : latencyMs;
    c.lastCall = new Date().toISOString();

    // Extended tracking
    const callType = opts.type || 'fetch';
    if (callType === 'cache_hit')   c.cache_hits = (c.cache_hits || 0) + 1;
    if (callType === 'cache_miss')  c.cache_misses = (c.cache_misses || 0) + 1;
    if (callType === 'fallback')    c.fallback_calls = (c.fallback_calls || 0) + 1;

    // Caller tracking
    const caller = opts.caller || 'unknown';
    if (!c.callers) c.callers = {};
    c.callers[caller] = (c.callers[caller] || 0) + 1;

    saveCounters(counters);
    return c;
}

// ─── Quota Prediction ─────────────────────────────────────────────────────────

function predictQuota(provider) {
    const counters = loadCounters();
    const c = counters[provider];
    const q = QUOTAS[provider];

    if (!c || !q) return null;

    const hourlyRate = c.hourly || 1;
    const result = { provider, name: q.name, tier: q.tier };

    if (q.daily) {
        const remaining = q.daily - c.daily;
        const hoursLeft = remaining / hourlyRate;
        result.daily = {
            used: c.daily,
            limit: q.daily,
            remaining,
            pct: Math.round((c.daily / q.daily) * 100),
            exhaustsIn: hoursLeft > 0 ? `${hoursLeft.toFixed(1)}h` : 'EXHAUSTED',
            status: c.daily >= q.daily ? 'EXHAUSTED' : c.daily > q.daily * 0.8 ? 'WARNING' : 'OK'
        };
    }

    if (q.monthly) {
        result.monthly = {
            used: c.monthly,
            limit: q.monthly,
            remaining: q.monthly - c.monthly,
            pct: Math.round((c.monthly / q.monthly) * 100),
            status: c.monthly >= q.monthly ? 'EXHAUSTED' : c.monthly > q.monthly * 0.8 ? 'WARNING' : 'OK'
        };
    }

    if (q.cost > 0) {
        result.estimatedCost = {
            today: (c.daily * q.cost).toFixed(4),
            month: (c.monthly * q.cost).toFixed(4),
            currency: 'USD'
        };
    }

    return result;
}

// ─── Smart Throttling ─────────────────────────────────────────────────────────

function shouldThrottle(provider, callerContext = 'background') {
    const prediction = predictQuota(provider);
    if (!prediction) return { throttle: false };

    if (prediction.daily?.status === 'EXHAUSTED') {
        return { throttle: true, reason: 'Daily quota exhausted', suggestion: 'Switch to fallback provider' };
    }
    
    // v5.0 Predictive Throttling: Reserve last 15% for critical signals
    if (prediction.daily && prediction.daily.pct > 85) {
        if (callerContext !== 'critical_signal') {
            return { 
                throttle: true, 
                reason: `Daily quota ${prediction.daily.pct}% used. Hoarding remaining for critical signals.`, 
                suggestion: 'Non-critical background fetch throttled' 
            };
        }
    }

    if (prediction.daily?.status === 'WARNING') {
        return { throttle: false, warning: true, reason: `Daily quota ${prediction.daily.pct}% used`, suggestion: 'Reduce call frequency' };
    }
    
    return { throttle: false };
}

// ─── Format for Telegram ──────────────────────────────────────────────────────

function formatApiUsage(adminMode = false) {
    const counters = loadCounters();
    const lines = ['📊 *API Usage Dashboard*\n'];

    const providers = Object.keys(QUOTAS).filter(p => counters[p]?.daily > 0 || QUOTAS[p].tier === 'free');

    for (const p of providers) {
        const q = QUOTAS[p];
        const c = counters[p] || { daily: 0, monthly: 0, errors: 0 };

        if (q.tier === 'paid_placeholder' && c.daily === 0) continue; // Skip unused paid placeholders

        const tierIcon = q.tier === 'local' ? '🏠' : q.tier === 'paid_placeholder' ? '🔲' : '🆓';
        let bar = '';
        if (q.daily) {
            const pct = Math.min(100, Math.round((c.daily / q.daily) * 100));
            const filled = Math.round(pct / 10);
            bar = '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${pct}%`;
        } else {
            bar = '∞ unlimited';
        }

        lines.push(`${tierIcon} *${q.name}*`);
        lines.push(`  ${bar}  (${c.daily || 0}/${q.daily || '∞'} today)`);

        if (adminMode && c.errors > 0) {
            lines.push(`  ⚠️ Errors: ${c.errors} | Latency: ${c.avgLatency}ms`);
        }
    }

    // Cost summary
    const totalCost = providers.reduce((sum, p) => {
        const c = counters[p]?.monthly || 0;
        return sum + c * (QUOTAS[p].cost || 0);
    }, 0);
    if (totalCost > 0) {
        lines.push(`\n💰 Est. monthly cost: $${totalCost.toFixed(2)}`);
    }

    return lines.join('\n');
}

// ─── Get All Quotas for Dashboard ─────────────────────────────────────────────

function getAllQuotas() {
    const counters = loadCounters();
    return Object.entries(QUOTAS).map(([key, q]) => {
        const c = counters[key] || { daily: 0, monthly: 0, total: 0, errors: 0, avgLatency: 0 };
        const prediction = predictQuota(key);
        return { key, ...q, ...c, prediction };
    });
}

module.exports = {
    recordCall,
    predictQuota,
    shouldThrottle,
    formatApiUsage,
    getAllQuotas,
    QUOTAS
};
