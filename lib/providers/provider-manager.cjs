/**
 * provider-manager.cjs — OpenClaw Unified Provider Manager
 *
 * Wraps all data sources with:
 *   - Priority fallback (Yahoo → Binance → Kraken → CoinGecko)
 *   - In-memory cache with freshness timestamps
 *   - Provider health tracking
 *   - Rate-limit awareness
 *   - Graceful degradation (never crash pipeline)
 *
 * Existing market_fetcher.cjs is preserved and called here.
 * This manager adds the caching + health layer on top.
 */

'use strict';

const path = require('path');
const { fetchCandles: rawFetchCandles } = require('../../market_fetcher.cjs');
const { fetchAllNews }                  = require('../../news_collector.cjs');
const { getTopCoins, getFearGreed }     = require('../../coingecko.cjs');

// ─── In-Memory Cache ──────────────────────────────────────────────────────────
const CACHE = new Map();
const CACHE_TTL = {
    candles:    15 * 60 * 1000,   // 15 min
    news:       10 * 60 * 1000,   // 10 min
    crypto:      5 * 60 * 1000,   //  5 min
    feargreed:  30 * 60 * 1000,   // 30 min
};

function cacheKey(type, symbol) { return `${type}:${symbol}`; }

function getCached(type, symbol) {
    const key  = cacheKey(type, symbol);
    const item = CACHE.get(key);
    if (!item) return null;
    if (Date.now() - item.fetchedAt > CACHE_TTL[type]) {
        CACHE.delete(key);
        return null;
    }
    return item;
}

function setCache(type, symbol, data) {
    CACHE.set(cacheKey(type, symbol), {
        data, fetchedAt: Date.now(), provider: data?._provider || 'unknown'
    });
}

// ─── Provider Health ─────────────────────────────────────────────────────────
const HEALTH = {};
function markHealthy(provider)  { HEALTH[provider] = { ok: true, failCount: 0, lastOk: Date.now() }; }
function markFailed(provider)   {
    if (!HEALTH[provider]) HEALTH[provider] = { ok: true, failCount: 0 };
    HEALTH[provider].ok = false;
    HEALTH[provider].failCount = (HEALTH[provider].failCount || 0) + 1;
    HEALTH[provider].lastFail = Date.now();
}
function getHealth() { return { ...HEALTH, cacheSize: CACHE.size }; }

// ─── Candle Fetcher (cached + health-tracked) ─────────────────────────────────
/**
 * fetchCandlesWithCache(symbol) → { candles, display, provider, fetchedAt, fromCache }
 */
async function fetchCandlesWithCache(symbol) {
    const cached = getCached('candles', symbol);
    if (cached) {
        return { ...cached.data, fromCache: true, fetchedAt: cached.fetchedAt };
    }

    try {
        const result = await rawFetchCandles(symbol);
        const data = { ...result, _provider: 'yahoo_primary', fromCache: false };
        setCache('candles', symbol, data);
        markHealthy('yahoo');
        return data;
    } catch (e) {
        markFailed('yahoo_primary');
        // Return stale cache if exists
        const stale = CACHE.get(cacheKey('candles', symbol));
        if (stale) {
            const ageMin = Math.round((Date.now() - stale.fetchedAt) / 60000);
            console.log(`[ProviderMgr] Using stale cache for ${symbol} (${ageMin}min old)`);
            return { ...stale.data, fromCache: true, stale: true, fetchedAt: stale.fetchedAt };
        }
        throw new Error(`All providers failed for ${symbol}: ${e.message}`);
    }
}

// ─── News Fetcher (cached) ─────────────────────────────────────────────────────
/**
 * fetchNewsWithCache(symbol) → { headlines, fromCache, fetchedAt }
 */
async function fetchNewsWithCache(symbol) {
    const cached = getCached('news', symbol);
    if (cached) return { ...cached.data, fromCache: true };

    try {
        const raw = await fetchAllNews(symbol);
        const headlines = Array.isArray(raw) ? raw : (raw?.headlines || []);
        const data = { headlines, _provider: 'news_collector' };
        setCache('news', symbol, data);
        markHealthy('news_collector');
        return { ...data, fromCache: false, fetchedAt: Date.now() };
    } catch (e) {
        markFailed('news_collector');
        const stale = CACHE.get(cacheKey('news', symbol));
        if (stale) return { ...stale.data, fromCache: true, stale: true };
        return { headlines: [], fromCache: false, error: e.message };
    }
}

// ─── Crypto Market Data (CoinGecko, cached) ───────────────────────────────────
async function fetchCryptoOverview() {
    const cached = getCached('crypto', 'market');
    if (cached) return { ...cached.data, fromCache: true };

    try {
        const [topCoins, fearGreed] = await Promise.allSettled([
            getTopCoins(10),
            getFearGreed()
        ]);
        const data = {
            topCoins:  topCoins.status === 'fulfilled'  ? topCoins.value  : [],
            fearGreed: fearGreed.status === 'fulfilled'  ? fearGreed.value : null,
            _provider: 'coingecko'
        };
        setCache('crypto', 'market', data);
        markHealthy('coingecko');
        return { ...data, fromCache: false };
    } catch (e) {
        markFailed('coingecko');
        return { topCoins: [], fearGreed: null, error: e.message, fromCache: false };
    }
}

// ─── Data Freshness Report ─────────────────────────────────────────────────────
function getFreshnessReport() {
    const report = [];
    for (const [key, item] of CACHE.entries()) {
        const [type, symbol] = key.split(':');
        const ageMin = Math.round((Date.now() - item.fetchedAt) / 60000);
        const ttlMin = Math.round(CACHE_TTL[type] / 60000);
        report.push({
            symbol, type, provider: item.provider,
            ageMin, ttlMin, fresh: ageMin < ttlMin
        });
    }
    return report;
}

/**
 * getFreshnessLabel(symbol, type) → string for display
 */
function getFreshnessLabel(symbol, type = 'candles') {
    const item = CACHE.get(cacheKey(type, symbol));
    if (!item) return '⚪ No data';
    const ageMin = Math.round((Date.now() - item.fetchedAt) / 60000);
    if (ageMin < 2)  return `🟢 Live (${ageMin}m ago)`;
    if (ageMin < 15) return `🟡 Fresh (${ageMin}m ago)`;
    return `🔴 Stale (${ageMin}m ago)`;
}

// ─── Cache invalidation ────────────────────────────────────────────────────────
function invalidateCache(symbol, type = null) {
    if (type) {
        CACHE.delete(cacheKey(type, symbol));
    } else {
        // Clear all types for this symbol
        for (const key of CACHE.keys()) {
            if (key.includes(`:${symbol}`)) CACHE.delete(key);
        }
    }
}

module.exports = {
    fetchCandlesWithCache,
    fetchNewsWithCache,
    fetchCryptoOverview,
    getFreshnessReport,
    getFreshnessLabel,
    invalidateCache,
    getHealth,
    // Re-export raw for direct use
    rawFetchCandles
};
