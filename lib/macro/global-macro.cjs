/**
 * global-macro.cjs — Global Macro Engine
 * Pulls free data from Yahoo Finance, CoinGecko, and FRED (if key exists)
 * Builds an institutional macro regime report.
 */

'use strict';

const https = require('https');

function fetchJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers, timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) return resolve(null);
                try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null))
          .on('timeout', function() { this.destroy(); resolve(null); });
    });
}

async function getYahooData(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const data = await fetchJson(url, { 'User-Agent': 'Mozilla/5.0' });
    if (!data || !data.chart || !data.chart.result) return null;
    const res = data.chart.result[0];
    const closes = res.indicators.quote[0].close;
    if (!closes || closes.length === 0) return null;
    const last = closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : last;
    const change = prev ? ((last - prev) / prev) * 100 : 0;
    return { price: last, changePct: change };
}

async function getCoinGeckoGlobal() {
    const url = 'https://api.coingecko.com/api/v3/global';
    const data = await fetchJson(url);
    if (!data || !data.data) return null;
    return {
        btcDominance: data.data.market_cap_percentage.btc,
        totalMarketCap: data.data.total_market_cap.usd,
        activeCryptos: data.data.active_cryptocurrencies
    };
}

// ── Null-safe formatting ─────────────────────────────────────────────────────
function safeToFixed(value, digits = 2, fallback = 'N/A') {
    if (value === null || value === undefined || isNaN(value)) return fallback;
    return Number(value).toFixed(digits);
}

async function getGlobalMacro() {
    // v5.1: Circuit breaker guard — skip API calls if macro refresh is tripped
    let circuitBlocked = false;
    try {
        const { canRefreshSnapshot, recordRefreshAttempt } = require('../../scheduler.cjs');
        if (!canRefreshSnapshot('MACRO')) {
            circuitBlocked = true;
        }
    } catch {}

    if (circuitBlocked) {
        const degraded = {
            regime: 'MIXED',
            riskAppetite: 'NEUTRAL',
            macroScore: 50,
            metrics: { dxy: null, vix: null, gold: null, oil: null, btcDominance: null, totalMarketCap: null },
            staleInputs: ['DXY', 'VIX', 'Gold', 'Oil', 'CoinGecko'],
            dataQuality: 'DEGRADED',
            degraded: true,
            degraded_reason: 'Macro refresh circuit breaker OPEN — using neutral assumption',
            timestamp: new Date().toISOString()
        };
        _writeMacroSnapshot(degraded, true);
        return degraded;
    }

    const [dxy, vix, gold, oil, cg] = await Promise.all([
        getYahooData('DX-Y.NYB'),
        getYahooData('^VIX'),
        getYahooData('GC=F'), // Gold futures
        getYahooData('CL=F'), // Crude oil
        getCoinGeckoGlobal()
    ]);

    let regime = 'MIXED';
    let riskAppetite = 'NEUTRAL';
    let score = 50; // out of 100

    if (vix && dxy) {
        if (vix.price < 20 && dxy.changePct < 0) {
            regime = 'RISK_ON';
            riskAppetite = 'HIGH';
            score += 20;
        } else if (vix.price > 25 || dxy.changePct > 0.5) {
            regime = 'RISK_OFF';
            riskAppetite = 'LOW';
            score -= 20;
        }
    }

    if (cg && cg.btcDominance > 55) {
        regime += ' / BTC_SEASON';
    }

    // Build metrics with null-safe formatting
    const staleInputs = [];
    if (!dxy) staleInputs.push('DXY');
    if (!vix) staleInputs.push('VIX');
    if (!gold) staleInputs.push('Gold');
    if (!oil) staleInputs.push('Oil');
    if (!cg) staleInputs.push('CoinGecko');

    const isStale = staleInputs.length >= 3;

    const result = {
        regime,
        riskAppetite,
        macroScore: score,
        metrics: {
            dxy: dxy ? { price: safeToFixed(dxy.price), change: safeToFixed(dxy.changePct) + '%' } : null,
            vix: vix ? { price: safeToFixed(vix.price), change: safeToFixed(vix.changePct) + '%' } : null,
            gold: gold ? { price: safeToFixed(gold.price), change: safeToFixed(gold.changePct) + '%' } : null,
            oil: oil ? { price: safeToFixed(oil.price), change: safeToFixed(oil.changePct) + '%' } : null,
            btcDominance: cg ? safeToFixed(cg.btcDominance) + '%' : null,
            totalMarketCap: cg ? '$' + safeToFixed(cg.totalMarketCap / 1e12) + 'T' : null
        },
        staleInputs,
        dataQuality: staleInputs.length === 0 ? 'FULL' : staleInputs.length <= 2 ? 'PARTIAL' : 'DEGRADED',
        timestamp: new Date().toISOString()
    };

    // v5.1: Record circuit breaker attempt
    try {
        const { recordRefreshAttempt } = require('../../scheduler.cjs');
        recordRefreshAttempt('MACRO', !isStale);
    } catch {}

    // v5.1: Write MACRO snapshot
    _writeMacroSnapshot(result, isStale);

    return result;
}

// v5.1: Auto-write MACRO snapshot to snapshot store
function _writeMacroSnapshot(data, stale) {
    try {
        const snapStore = require('../snapshots/snapshot_store.cjs');
        snapStore.put('MACRO', null, null, data, {
            provider: 'global-macro',
            stale: stale,
            stale_level: stale ? 'DEGRADED' : 'FRESH'
        });
    } catch {}
}

module.exports = { getGlobalMacro, safeToFixed };

