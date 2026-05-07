/**
 * provider_router.cjs — OpenClaw v5.1 Provider Routing Engine
 *
 * Chooses the best provider for each request type:
 *   1. Best free provider (healthy + lowest quota usage)
 *   2. Cached data fallback
 *   3. Alternate free provider
 *   4. Paid placeholder (only if env-enabled)
 *
 * Every fallback is logged via api_counter.
 */
'use strict';

const { QUOTAS, getAllQuotas, recordCall } = require('../../api_counter.cjs');

// ── Provider status classification ──────────────────────────────────────────

const STATUS = {
    HEALTHY:  'healthy',
    UNUSED:   'unused',
    STALE:    'stale',
    DEGRADED: 'degraded',
    FAILING:  'failing',
    DISABLED: 'disabled'
};

/**
 * Classify a provider's current operational status.
 */
function classifyProvider(name) {
    const quota = QUOTAS[name];
    if (!quota) return STATUS.UNUSED;
    if (quota.tier === 'paid_placeholder') return STATUS.DISABLED;

    const allQ = getAllQuotas();
    const prov = allQ.find(q => q.key === name);
    if (!prov) return STATUS.UNUSED;

    if ((prov.errors || 0) >= 5) return STATUS.FAILING;
    if ((prov.errors || 0) >= 2) return STATUS.DEGRADED;
    if (prov.daily === 0 && prov.total === 0) return STATUS.UNUSED;
    return STATUS.HEALTHY;
}

/**
 * Get quota usage percentage for a provider.
 */
function getQuotaUsage(name) {
    const quota = QUOTAS[name];
    if (!quota || !quota.daily) return 0;
    const allQ = getAllQuotas();
    const prov = allQ.find(q => q.key === name);
    const calls = prov?.daily || 0;
    return Math.min(100, Math.round(calls / quota.daily * 100));
}

// ── Provider type mapping ───────────────────────────────────────────────────

const PROVIDER_MAP = {
    crypto_price:   ['coingecko', 'coinapi'],
    crypto_candle:  ['coingecko', 'coinapi'],
    forex_candle:   ['coinapi'],
    news:           ['newsapi', 'gnews'],
    sentiment:      ['alternative_me'],
    chart:          ['quickchart'],
    storage:        ['supabase'],
    ai_model:       ['lmstudio', 'aicc', 'grok'],
    risk:           ['remora']
};

// ── Fallback log ────────────────────────────────────────────────────────────

const _fallbackLog = [];

function logFallback(from, to, reason) {
    const entry = {
        timestamp: new Date().toISOString(),
        from,
        to,
        reason
    };
    _fallbackLog.push(entry);
    if (_fallbackLog.length > 200) _fallbackLog.splice(0, _fallbackLog.length - 200);
    console.log(`[ProviderRouter] Fallback: ${from} → ${to} (${reason})`);
    return entry;
}

function getFallbackLog(n = 20) {
    return _fallbackLog.slice(-n);
}

// ── Main routing function ───────────────────────────────────────────────────

/**
 * Choose the best provider for a request type.
 * @param {string} type - One of: crypto_price, crypto_candle, forex_candle, news, sentiment, chart, storage, ai_model, risk
 * @returns {{ provider: string, status: string, fallback: boolean, fallbackFrom: string|null }}
 */
function routeProvider(type) {
    const candidates = PROVIDER_MAP[type] || [];
    if (!candidates.length) {
        return { provider: null, status: STATUS.UNUSED, fallback: false, fallbackFrom: null };
    }

    // Score each candidate: health (0-50) + quota headroom (0-50)
    const scored = candidates.map(name => {
        const quota = QUOTAS[name];
        const status = classifyProvider(name);

        // Skip disabled/paid
        if (status === STATUS.DISABLED) return { name, score: -1, status };

        let score = 0;
        // Health score
        if (status === STATUS.HEALTHY) score += 50;
        else if (status === STATUS.UNUSED) score += 40;
        else if (status === STATUS.STALE) score += 20;
        else if (status === STATUS.DEGRADED) score += 10;
        else score += 0; // FAILING

        // Quota headroom
        const usage = getQuotaUsage(name);
        if (!quota?.daily) score += 50; // unlimited
        else score += Math.max(0, 50 - usage / 2); // 0% used = 50, 100% used = 0

        return { name, score, status, usage };
    }).filter(p => p.score >= 0).sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
        return { provider: null, status: STATUS.DISABLED, fallback: false, fallbackFrom: null };
    }

    const best = scored[0];

    // If best is not healthy, log fallback from first candidate
    if (best.name !== candidates[0] && best.status !== STATUS.HEALTHY) {
        logFallback(candidates[0], best.name, `${candidates[0]} ${classifyProvider(candidates[0])}, using ${best.name}`);
        return { provider: best.name, status: best.status, fallback: true, fallbackFrom: candidates[0] };
    }

    return { provider: best.name, status: best.status, fallback: false, fallbackFrom: null };
}

/**
 * Get all provider statuses with metadata.
 */
function getAllProviderStatuses() {
    const result = {};
    for (const [name, quota] of Object.entries(QUOTAS)) {
        const status = classifyProvider(name);
        result[name] = {
            name: quota.name,
            tier: quota.tier,
            status,
            daily_limit: quota.daily,
            monthly_limit: quota.monthly,
            cost_per_call: quota.cost,
            quota_pct: getQuotaUsage(name),
            env_key: quota.tier === 'paid_placeholder' ? `${name.toUpperCase()}_API_KEY` : null,
            role: Object.entries(PROVIDER_MAP).filter(([, providers]) => providers.includes(name)).map(([type]) => type)
        };
    }
    return result;
}

/**
 * Get predicted quota exhaustion time for a provider.
 */
function predictExhaustion(name) {
    const quota = QUOTAS[name];
    if (!quota?.daily) return null;
    const allQ = getAllQuotas();
    const prov = allQ.find(q => q.key === name);
    if (!prov || !prov.daily) return null;

    const uptimeH = Math.max(1, process.uptime() / 3600);
    const callsPerH = prov.daily / uptimeH;
    if (callsPerH <= 0) return null;

    const remaining = quota.daily - prov.daily;
    const hoursLeft = remaining / callsPerH;
    return {
        calls_remaining: remaining,
        rate_per_hour: Math.round(callsPerH * 10) / 10,
        estimated_hours_left: Math.round(hoursLeft * 10) / 10,
        will_exhaust: hoursLeft < 24
    };
}

module.exports = {
    routeProvider,
    classifyProvider,
    getQuotaUsage,
    logFallback,
    getFallbackLog,
    getAllProviderStatuses,
    predictExhaustion,
    STATUS,
    PROVIDER_MAP
};
