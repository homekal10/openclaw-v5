/**
 * remora_risk.cjs — Remora Risk Engine + Massive API Integration
 *
 * Remora Risk Engine: Real-time institutional risk scoring API
 * Massive API:        Market data, dividends, fundamentals
 *
 * Used by:
 *   - /signal commands (adds external risk layer to scoring)
 *   - /analyze commands (enriches agent reports with fundamentals)
 *   - Real-time scanner (filters low-quality setups)
 */

'use strict';

const https = require('https');
const http  = require('http');
const path  = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

// ─── API Config ────────────────────────────────────────────────────────────────
const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY   || 'zTBXi0Jq170LELOnCMtuLllK3aHLG8dM';
const REMORA_API_KEY  = process.env.REMORA_API_KEY    || '6yb8dYnlsevOrJJP2JABpBCSBUGwBWxhs5nu7wlGr_Y';
const MASSIVE_BASE    = 'api.massive.com';
const REMORA_BASE     = 'api.remorarisk.com';   // update if endpoint differs

// ─── Generic HTTPS GET ────────────────────────────────────────────────────────
function apiGet(hostname, endpointPath, headers = {}, timeoutMs = 15000) {
    return new Promise(resolve => {
        const opts = {
            hostname, port: 443, method: 'GET',
            path: endpointPath,
            headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw/3.0', ...headers },
            timeout: timeoutMs
        };
        const req = https.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                if (res.statusCode === 429) { console.warn(`[Remora/Massive] Rate limited on ${endpointPath}`); resolve(null); return; }
                if (res.statusCode >= 400)  { console.warn(`[Remora/Massive] HTTP ${res.statusCode} on ${endpointPath}`); resolve(null); return; }
                try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
            });
        });
        req.on('error',   () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASSIVE API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getDividendData(ticker) — Get dividend schedule and yield data
 * Useful for: equity bias in macro environment, dividend traps, earnings context
 */
async function getDividendData(ticker) {
    const data = await apiGet(
        MASSIVE_BASE,
        `/v3/reference/dividends?ticker=${ticker.toUpperCase()}&apiKey=${MASSIVE_API_KEY}`,
        {}
    );
    if (!data?.results?.length) return null;
    const latest = data.results[0];
    return {
        ticker:        ticker.toUpperCase(),
        exDate:        latest.ex_dividend_date,
        payDate:       latest.pay_date,
        recordDate:    latest.record_date,
        cashAmount:    latest.cash_amount,
        frequency:     latest.frequency,
        dividendType:  latest.dividend_type,
        source:        'massive_api'
    };
}

/**
 * getTickerDetails(ticker) — Company/asset fundamentals
 */
async function getTickerDetails(ticker) {
    const data = await apiGet(
        MASSIVE_BASE,
        `/v3/reference/tickers/${ticker.toUpperCase()}?apiKey=${MASSIVE_API_KEY}`,
        {}
    );
    if (!data?.results) return null;
    const r = data.results;
    return {
        name:          r.name,
        market:        r.market,
        locale:        r.locale,
        type:          r.type,
        currency:      r.currency_name,
        exchange:      r.primary_exchange,
        description:   r.description?.substring(0, 300),
        marketCap:     r.market_cap,
        employees:     r.total_employees,
        listDate:      r.list_date,
        source:        'massive_api'
    };
}

/**
 * getAggregates(ticker, from, to) — OHLCV aggregates from Massive
 */
async function getAggregates(ticker, from, to, timespan = 'day') {
    const data = await apiGet(
        MASSIVE_BASE,
        `/v2/aggs/ticker/${ticker.toUpperCase()}/range/1/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=120&apiKey=${MASSIVE_API_KEY}`,
        {}
    );
    if (!data?.results?.length) return null;
    return data.results.map(r => ({
        time:   r.t,
        open:   r.o,
        high:   r.h,
        low:    r.l,
        close:  r.c,
        volume: r.v,
        vwap:   r.vw,
        source: 'massive_api'
    }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// REMORA RISK ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getRemoraRiskScore(symbol, direction) — External institutional risk scoring
 *
 * Returns a risk assessment enriching our internal scoring engine.
 * Falls back gracefully if Remora is unreachable.
 */
async function getRemoraRiskScore(symbol, direction = 'LONG') {
    // Primary endpoint: try Remora's risk-score API
    const data = await apiGet(
        REMORA_BASE,
        `/v1/risk/score?symbol=${symbol.toUpperCase()}&direction=${direction}&apiKey=${REMORA_API_KEY}`,
        { 'X-API-Key': REMORA_API_KEY }
    );

    if (data) {
        return {
            riskScore:       data.risk_score       ?? data.score ?? null,
            riskLevel:       data.risk_level        ?? data.level ?? 'UNKNOWN',
            maxDrawdown:     data.max_drawdown      ?? null,
            sharpe:          data.sharpe_ratio      ?? null,
            volatility:      data.volatility        ?? null,
            recommendation:  data.recommendation    ?? null,
            source:          'remora_risk_engine'
        };
    }

    // Fallback: compute a basic internal risk score when Remora is offline
    return computeFallbackRisk(symbol, direction);
}

/**
 * Internal fallback risk computation when Remora API is unreachable
 */
function computeFallbackRisk(symbol, direction) {
    // Forex pairs have generally lower volatility than crypto
    const isCrypto = ['BTC','ETH','SOL','XRP','ADA','DOGE','BNB','AVAX'].some(c =>
        symbol.toUpperCase().includes(c));
    const isGold   = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
    const isOil    = symbol.toUpperCase().includes('OIL') || symbol.toUpperCase().includes('WTI');

    let riskLevel, riskScore;
    if (isCrypto)         { riskLevel = 'HIGH';   riskScore = 72; }
    else if (isOil)       { riskLevel = 'HIGH';   riskScore = 68; }
    else if (isGold)      { riskLevel = 'MEDIUM'; riskScore = 45; }
    else                  { riskLevel = 'MEDIUM'; riskScore = 40; }

    return {
        riskScore,
        riskLevel,
        maxDrawdown:    null,
        sharpe:         null,
        volatility:     null,
        recommendation: direction === 'LONG'
            ? `Risk-adjusted ${riskLevel.toLowerCase()} — size position at 1-2% capital max`
            : `Short in ${riskLevel.toLowerCase()}-risk env — tight stop mandatory`,
        source: 'openclaw_internal_fallback'
    };
}

/**
 * enrichSignalWithRisk(signalResult) — Adds Remora risk layer to a signal output
 * Used by orchestrator to augment the final signal before Telegram delivery
 */
async function enrichSignalWithRisk(signalResult) {
    if (!signalResult) return signalResult;
    const sym  = signalResult.symbol || signalResult.asset || 'UNKNOWN';
    const dir  = (signalResult.final_action || signalResult.direction || 'LONG').includes('SELL') ? 'SHORT' : 'LONG';
    try {
        const risk = await getRemoraRiskScore(sym, dir);
        if (risk) {
            signalResult.externalRisk      = risk;
            signalResult.riskLevel         = risk.riskLevel;
            // If external risk is HIGH and our confidence is borderline, downgrade to WAIT
            if (risk.riskLevel === 'HIGH' && (signalResult.total_score || 0) < 75) {
                signalResult.riskDowngraded = true;
            }
        }
    } catch(e) {}
    return signalResult;
}

/**
 * formatRiskBlock(risk) — Formats Remora risk data for Telegram
 */
function formatRiskBlock(risk) {
    if (!risk) return '';
    const icons = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴', UNKNOWN: '⚪' };
    return `\n🛡 *Risk Assessment* (${risk.source === 'remora_risk_engine' ? 'Remora Engine' : 'Internal'})\n` +
           `• Level: ${icons[risk.riskLevel] || '⚪'} ${risk.riskLevel}\n` +
           `• Score: ${risk.riskScore ?? 'N/A'}/100\n` +
           (risk.recommendation ? `• ${risk.recommendation}\n` : '');
}

module.exports = {
    // Massive API
    getDividendData,
    getTickerDetails,
    getAggregates,
    // Remora Risk Engine
    getRemoraRiskScore,
    enrichSignalWithRisk,
    formatRiskBlock,
};
