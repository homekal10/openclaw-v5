/**
 * provider_registry.cjs — OpenClaw Provider Abstraction Layer
 *
 * Standardizes all data providers with a common interface.
 * Supports: free providers now, paid placeholders for future.
 *
 * Provider interface:
 *   name, tier, enabled, healthcheck(), fetch(), normalize(),
 *   rateLimitProfile, costHint, fallbackPriority, lastSuccessAt, lastError
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const HEALTH_LOG = path.join(__dirname, '../../logs/provider_health.jsonl');

// ─── Provider Tiers ───────────────────────────────────────────────────────────
const TIERS = { FREE: 'free', PAID_PLACEHOLDER: 'paid_placeholder', PAID_LIVE: 'paid_live' };

// ─── Provider Registry ────────────────────────────────────────────────────────
const _registry = {};
const _health   = {};

function register(provider) {
    if (!provider.name) throw new Error('Provider must have a name');
    _registry[provider.name] = provider;
    _health[provider.name]   = {
        name:          provider.name,
        tier:          provider.tier || TIERS.FREE,
        healthy:       true,
        lastSuccessAt: null,
        lastError:     null,
        failureCount:  0,
        successCount:  0,
        avgLatencyMs:  0,
        totalCalls:    0
    };
    return provider;
}

function recordSuccess(name, latencyMs = 0) {
    if (!_health[name]) return;
    const h = _health[name];
    h.healthy       = true;
    h.lastSuccessAt = new Date().toISOString();
    h.lastError     = null;
    h.failureCount  = 0;
    h.successCount++;
    h.totalCalls++;
    h.avgLatencyMs  = Math.round((h.avgLatencyMs * (h.successCount - 1) + latencyMs) / h.successCount);
    _logHealth(name, 'success', latencyMs);
}

function recordFailure(name, error = '') {
    if (!_health[name]) return;
    const h = _health[name];
    h.failureCount++;
    h.totalCalls++;
    h.lastError = typeof error === 'string' ? error : error?.message || 'unknown';
    if (h.failureCount >= 3) h.healthy = false;
    _logHealth(name, 'failure', 0, h.lastError);
}

function getHealth(name) {
    return _health[name] || null;
}

function getAllHealth() {
    return Object.values(_health).map(h => ({
        ...h,
        provider: _registry[h.name] ? {
            tier:            _registry[h.name].tier,
            enabled:         _registry[h.name].enabled !== false,
            fallbackPriority: _registry[h.name].fallbackPriority || 99,
            costHint:        _registry[h.name].costHint || 'free'
        } : null
    }));
}

function getHealthySorted(type = null) {
    return getAllHealth()
        .filter(h => h.healthy && (_registry[h.name]?.enabled !== false))
        .filter(h => !type || _registry[h.name]?.type === type)
        .sort((a, b) => (a.provider?.fallbackPriority || 99) - (b.provider?.fallbackPriority || 99));
}

function _logHealth(name, event, latencyMs, error = null) {
    try {
        const record = { name, event, latencyMs, error, at: new Date().toISOString() };
        fs.appendFileSync(HEALTH_LOG, JSON.stringify(record) + '\n');
    } catch {}
}

// ─── Format provider health for Telegram ─────────────────────────────────────
function formatProviderHealth(adminMode = false) {
    const all = getAllHealth();
    const lines = ['📡 *Provider Health*\n'];
    for (const h of all) {
        const icon   = h.healthy ? '✅' : '❌';
        const tier   = h.provider?.tier || 'free';
        const tierTag = tier === 'paid_placeholder' ? '🔲' : tier === 'paid_live' ? '💎' : '🆓';
        const latency = h.avgLatencyMs ? `${h.avgLatencyMs}ms` : '—';
        lines.push(`${icon} ${tierTag} *${h.name}*${adminMode ? ` | ${latency} | ${h.successCount}✓ ${h.failureCount}✗` : ''}`);
        if (!h.healthy && h.lastError) lines.push(`  ⚠️ _${h.lastError.substring(0,60)}_`);
    }
    return lines.join('\n');
}

// ─── Pre-register all current free providers ──────────────────────────────────
const FREE_PROVIDERS = [
    { name: 'binance',       type: 'MarketDataProvider', tier: TIERS.FREE,    fallbackPriority: 1, costHint: 'free',   rateLimitProfile: '1200/min' },
    { name: 'coingecko',     type: 'CryptoProvider',     tier: TIERS.FREE,    fallbackPriority: 2, costHint: 'free',   rateLimitProfile: '30/min' },
    { name: 'yahoo_finance', type: 'MarketDataProvider', tier: TIERS.FREE,    fallbackPriority: 3, costHint: 'free',   rateLimitProfile: 'scrape' },
    { name: 'coinapi',       type: 'MarketDataProvider', tier: TIERS.FREE,    fallbackPriority: 4, costHint: 'free',   rateLimitProfile: '100/day' },
    { name: 'reddit',        type: 'SentimentProvider',  tier: TIERS.FREE,    fallbackPriority: 5, costHint: 'free',   rateLimitProfile: '60/min' },
    { name: 'rss',           type: 'NewsProvider',       tier: TIERS.FREE,    fallbackPriority: 6, costHint: 'free',   rateLimitProfile: 'unlimited' },
    { name: 'lm_studio',     type: 'LLMProvider',        tier: TIERS.FREE,    fallbackPriority: 1, costHint: 'local',  rateLimitProfile: 'local' },
    { name: 'gemini',        type: 'LLMProvider',        tier: TIERS.FREE,    fallbackPriority: 2, costHint: 'free',   rateLimitProfile: '15/min' },
    { name: 'deepseek',      type: 'LLMProvider',        tier: TIERS.FREE,    fallbackPriority: 3, costHint: '$0.002/1k', rateLimitProfile: '60/min' },
    { name: 'puter_grok',    type: 'LLMProvider',        tier: TIERS.FREE,    fallbackPriority: 4, costHint: 'free',   rateLimitProfile: 'unlimited' },
    { name: 'quickchart',    type: 'ChartProvider',      tier: TIERS.FREE,    fallbackPriority: 1, costHint: 'free',   rateLimitProfile: 'unlimited' },
    { name: 'supabase',      type: 'PersistenceProvider',tier: TIERS.FREE,    fallbackPriority: 1, costHint: 'free',   rateLimitProfile: '500/day' }
];

// ─── Paid Placeholders (disabled by default) ──────────────────────────────────
const PAID_PLACEHOLDERS = [
    { name: 'bloomberg',        type: 'MarketDataProvider',   tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_BLOOMBERG',            costHint: '$2000+/mo' },
    { name: 'refinitiv',        type: 'MarketDataProvider',   tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_REFINITIV',            costHint: '$1000+/mo' },
    { name: 'polygon_io',       type: 'MarketDataProvider',   tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_POLYGON_IO',           costHint: '$29+/mo' },
    { name: 'twelve_data',      type: 'MarketDataProvider',   tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_TWELVE_DATA',          costHint: '$12+/mo' },
    { name: 'fmp_premium',      type: 'MarketDataProvider',   tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_FMP_PREMIUM',          costHint: '$15+/mo' },
    { name: 'tradingview',      type: 'ChartProvider',        tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_TRADINGVIEW',           costHint: '$15+/mo' },
    { name: 'benzinga',         type: 'NewsProvider',         tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_BENZINGA',             costHint: '$50+/mo' },
    { name: 'trading_economics',type: 'MacroCalendarProvider',tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_TRADING_ECONOMICS',    costHint: '$30+/mo' },
    { name: 'ravenpack',        type: 'SentimentProvider',    tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_RAVENPACK',            costHint: '$500+/mo' },
    { name: 'oanda',            type: 'BrokerProvider',       tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_OANDA',                costHint: 'spread' },
    { name: 'exness',           type: 'BrokerProvider',       tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_EXNESS',               costHint: 'spread' },
    { name: 'binance_trading',  type: 'BrokerProvider',       tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_BINANCE_TRADING',      costHint: '0.1%' },
    { name: 'alpaca',           type: 'BrokerProvider',       tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_ALPACA',               costHint: 'commission-free' },
    { name: 'interactive_brokers',type:'BrokerProvider',      tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_INTERACTIVE_BROKERS',   costHint: '$0.005/share' },
    { name: 'sentry',           type: 'TelemetryProvider',    tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_SENTRY',               costHint: 'free tier' },
    { name: 'datadog',          type: 'TelemetryProvider',    tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_DATADOG',              costHint: '$15+/mo' },
    { name: 'better_stack',     type: 'TelemetryProvider',    tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_TELEMETRY',            costHint: 'free tier' },
    { name: 'posthog',          type: 'TelemetryProvider',    tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_TELEMETRY',            costHint: 'free tier' },
    { name: 'grok_xai',        type: 'LLMProvider',           tier: TIERS.PAID_PLACEHOLDER, enabled: false, envFlag: 'ENABLE_CLOUD_LLM',            costHint: '$5+/mo' }
];

// Register all providers
[...FREE_PROVIDERS, ...PAID_PLACEHOLDERS].forEach(register);

// ─── Paid provider fetch stub ─────────────────────────────────────────────────
function fetchPaidPlaceholder(name) {
    const p = _registry[name];
    if (!p) return { error: 'PROVIDER_NOT_FOUND', provider: name };
    if (p.tier === TIERS.PAID_PLACEHOLDER || !p.enabled) {
        return {
            disabled: true,
            provider: name,
            tier: p.tier,
            enableFlag: p.envFlag,
            costHint: p.costHint,
            message: `${name} is a paid placeholder. Set ${p.envFlag}=true and add API key to enable.`
        };
    }
    return null;
}

// ─── v5.1: Provider Quality Scoring ───────────────────────────────────────────
const _qualityScores = {};

function updateProviderQuality(name) {
    const h = _health[name];
    if (!h) return;
    const successRate = h.totalCalls > 0 ? h.successCount / h.totalCalls : 0;
    const latencyScore = h.avgLatencyMs < 500 ? 100 : h.avgLatencyMs < 2000 ? 70 : h.avgLatencyMs < 5000 ? 40 : 10;
    const freshnessScore = h.lastSuccessAt ? (Date.now() - new Date(h.lastSuccessAt).getTime() < 300000 ? 100 : 50) : 0;
    const quality = Math.round(successRate * 50 + latencyScore * 0.3 + freshnessScore * 0.2);
    _qualityScores[name] = {
        quality: Math.min(100, quality),
        success_rate: Math.round(successRate * 100),
        latency_score: latencyScore,
        freshness_score: freshnessScore,
        last_updated: new Date().toISOString()
    };
}

function getProviderQuality(name) {
    if (name) return _qualityScores[name] || null;
    return { ...Object.fromEntries(Object.entries(_qualityScores).map(([k, v]) => [k, v])) };
}

function getSystemQuality() {
    const all = getAllHealth();
    const healthy = all.filter(h => h.healthy);
    const avgLatency = healthy.length > 0 ? Math.round(healthy.reduce((s, h) => s + h.avgLatencyMs, 0) / healthy.length) : 0;
    const totalCalls = all.reduce((s, h) => s + h.totalCalls, 0);
    const totalSuccess = all.reduce((s, h) => s + h.successCount, 0);
    return {
        providers_total: all.length,
        providers_healthy: healthy.length,
        providers_degraded: all.length - healthy.length,
        avg_latency_ms: avgLatency,
        overall_success_rate: totalCalls > 0 ? Math.round(totalSuccess / totalCalls * 100) : 0,
        quality_scores: _qualityScores
    };
}

// Auto-update quality on success/failure
const _origRecordSuccess = recordSuccess;
const _origRecordFailure = recordFailure;

// ─── v5.1: Provider Status Labels ────────────────────────────────────────────
function computeProviderStatus(name) {
    const p = _registry[name];
    const h = _health[name];
    if (!p) return 'UNKNOWN';
    if (p.tier === TIERS.PAID_PLACEHOLDER || p.enabled === false) return 'DISABLED';
    if (!h || h.totalCalls === 0) return 'UNUSED';
    if (h.failureCount >= 5) return 'FAILING';
    if (!h.healthy && h.failureCount >= 3) return 'DEGRADED';
    if (h.lastSuccessAt) {
        const ageMs = Date.now() - new Date(h.lastSuccessAt).getTime();
        if (ageMs > 10 * 60 * 1000) return 'STALE';
    }
    if (h.healthy && h.successCount > 0) return 'HEALTHY';
    return 'DEGRADED';
}

function getAllWithStatus() {
    return getAllHealth().map(h => ({
        ...h,
        computed_status: computeProviderStatus(h.name)
    }));
}

module.exports = {
    register, recordSuccess, recordFailure,
    getHealth, getAllHealth, getHealthySorted,
    formatProviderHealth, fetchPaidPlaceholder,
    getProviderQuality, getSystemQuality, updateProviderQuality,
    computeProviderStatus, getAllWithStatus,
    TIERS, FREE_PROVIDERS, PAID_PLACEHOLDERS
};
