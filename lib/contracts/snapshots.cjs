/**
 * snapshots.cjs — Shared Data Contracts
 * 
 * Normalized snapshot objects used by BOTH Telegram and web dashboard.
 * Frontend displays backend truth — never calculates independently.
 * 
 * Every snapshot includes: id, run_id, created_at, source_provider,
 * source_timestamp, cache_age_seconds, stale, errors, fallback_used.
 */
'use strict';
const { createRunId } = require('../observability/run-context.cjs');

// ── Stale Thresholds (seconds) ────────────────────────────────────────────────
const STALE_THRESHOLDS = {
    market:    60,   // Price data stale after 60s
    signal:    900,  // Signal stale after 15min
    analysis:  1800, // AI analysis stale after 30min
    feargreed: 3600, // F&G stale after 1h (provider TTL)
    health:    120,  // Health stale after 2min
    news:      300,  // News stale after 5min
    patterns:  600,  // Patterns stale after 10min
};

/** Calculate cache age and staleness */
function withMeta(data, type, sourceProvider, sourceTimestamp) {
    const now = Date.now();
    const srcTs = sourceTimestamp ? new Date(sourceTimestamp).getTime() : now;
    const cacheAge = Math.round((now - srcTs) / 1000);
    const threshold = STALE_THRESHOLDS[type] || 300;

    return {
        ...data,
        id: data.id || createRunId(),
        source_provider: sourceProvider || 'unknown',
        source_timestamp: new Date(srcTs).toISOString(),
        cache_age_seconds: cacheAge,
        stale: cacheAge > threshold,
        stale_threshold: threshold,
        updated_at: new Date().toISOString()
    };
}

/** Market Snapshot */
function createMarketSnapshot(symbol, price, change, provider, meta = {}) {
    return withMeta({
        symbol,
        price,
        change_24h: change,
        high_24h: meta.high,
        low_24h: meta.low,
        volume_24h: meta.volume
    }, 'market', provider, meta.timestamp);
}

/** Signal Snapshot */
function createSignalSnapshot(signal, runId) {
    return withMeta({
        run_id: runId,
        symbol: signal.asset || signal.symbol,
        action: signal.final_action || signal.action,
        setup_type: signal.setup_type,
        score: signal.institutional_score || signal.score,
        confidence: signal.confidence,
        entry: signal.entry,
        sl: signal.stop_loss || signal.sl,
        tp1: signal.tp1,
        tp2: signal.tp2,
        rr: signal.rr,
        verification: signal.verification_status,
        vetoes: signal.vetoes || [],
        why_trade: signal.why_trade,
        why_not: signal.why_not
    }, 'signal', 'openclaw-engine', signal.createdAt || new Date().toISOString());
}

/** Fear & Greed Snapshot */
function createFearGreedSnapshot(value, classification, provider, timestamp) {
    return withMeta({
        value,
        classification,
        description: value <= 25 ? 'Extreme fear — potential buying opportunity'
            : value <= 45 ? 'Fear in market — cautious sentiment'
            : value <= 55 ? 'Neutral — no strong directional bias'
            : value <= 75 ? 'Greed — momentum but watch for reversals'
            : 'Extreme greed — risk of correction'
    }, 'feargreed', provider, timestamp);
}

/** AI Analysis Snapshot */
function createAnalysisSnapshot(result, runId) {
    return withMeta({
        run_id: runId,
        symbol: result.symbol || result.asset,
        model_used: result.model_used,
        fallback_depth: result.fallback_depth || 0,
        final_action: result.final_action || result.action,
        confidence: result.confidence,
        technical: result.technical,
        sentiment: result.sentiment,
        news_macro: result.news_macro,
        risk: result.risk,
        synthesis: result.synthesis,
        warnings: result.warnings || []
    }, 'analysis', result.model_used || 'unknown', result.timestamp);
}

/** Provider Health Snapshot */
function createProviderHealthSnapshot(providers) {
    const items = providers.map(p => ({
        name: p.name,
        tier: p.tier || 'free',
        enabled: p.enabled !== false,
        healthy: p.healthy !== false,
        last_success: p.lastSuccessAt,
        last_error: p.lastError,
        response_time_ms: p.responseTime
    }));
    const healthy = items.filter(p => p.healthy).length;
    return withMeta({
        providers: items,
        total: items.length,
        healthy,
        degraded: items.length - healthy
    }, 'health', 'smart-health', new Date().toISOString());
}

/** System Health Snapshot */
function createSystemHealthSnapshot(health) {
    return withMeta({
        uptime: health.uptime,
        memory_mb: health.memory,
        heap_used_mb: health.heapUsed,
        providers: health.providers,
        scheduler: health.scheduler,
        database: health.database,
        telegram: health.telegram,
        dashboard: health.dashboard,
        ai_mode: health.aiMode,
        errors_24h: health.errors24h || 0,
        fallbacks_24h: health.fallbacks24h || 0
    }, 'health', 'system', new Date().toISOString());
}

module.exports = {
    STALE_THRESHOLDS,
    withMeta,
    createMarketSnapshot,
    createSignalSnapshot,
    createFearGreedSnapshot,
    createAnalysisSnapshot,
    createProviderHealthSnapshot,
    createSystemHealthSnapshot
};
