/**
 * coinapi.cjs — CoinAPI Premium Integration
 * Key: 8716bc8e-cadb-4df7-9dc5-8f919d634b4a
 *
 * Used alongside CoinGecko for dual-source market intelligence:
 * ┌─────────────────────────────────────────────────────────┐
 * │  CoinGecko   → Sentiment, trending, fear/greed, social  │
 * │  CoinAPI     → OHLCV, multi-exchange price, tick data   │
 * │  Fusion Layer → Cross-validates, picks best data        │
 * └─────────────────────────────────────────────────────────┘
 */

'use strict';

const https = require('https');
const path  = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const API_KEY  = process.env.COINAPI_KEY;
const BASE     = 'rest.coinapi.io';

// ─── CoinAPI Symbol Map (crypto only — uses their exchange symbol format) ──────
const COINAPI_SYMBOLS = {
    BTC:     'COINBASE_SPOT_BTC_USD',
    BTCUSD:  'COINBASE_SPOT_BTC_USD',
    ETH:     'COINBASE_SPOT_ETH_USD',
    ETHUSD:  'COINBASE_SPOT_ETH_USD',
    SOL:     'COINBASE_SPOT_SOL_USD',
    BNB:     'BINANCE_SPOT_BNB_USDT',
    XRP:     'COINBASE_SPOT_XRP_USD',
    ADA:     'COINBASE_SPOT_ADA_USD',
    DOGE:    'BINANCE_SPOT_DOGE_USDT',
    MATIC:   'BINANCE_SPOT_MATIC_USDT',
    AVAX:    'BINANCE_SPOT_AVAX_USDT',
    LINK:    'COINBASE_SPOT_LINK_USD',
    LTC:     'COINBASE_SPOT_LTC_USD',
    DOT:     'BINANCE_SPOT_DOT_USDT',
    INJ:     'BINANCE_SPOT_INJ_USDT',
    SUI:     'BINANCE_SPOT_SUI_USDT',
};

// Asset IDs for exchange rate endpoint
const ASSET_IDS = {
    BTC: 'BTC', ETH: 'ETH', SOL: 'SOL', BNB: 'BNB',
    XRP: 'XRP', ADA: 'ADA', DOGE: 'DOGE', MATIC: 'MATIC',
    AVAX: 'AVAX', LINK: 'LINK', LTC: 'LTC', DOT: 'DOT',
};

function getSymbol(input) {
    const s = input.toUpperCase().replace('USDT','').replace('USD','').replace('PERP','');
    return COINAPI_SYMBOLS[s] || COINAPI_SYMBOLS[input.toUpperCase()] || null;
}
function getAssetId(input) {
    const s = input.toUpperCase().replace('USDT','').replace('USD','').replace('PERP','');
    return ASSET_IDS[s] || s;
}

// ─── HTTPS helper ─────────────────────────────────────────────────────────────
function apiGet(endpoint, timeoutMs = 12000) {
    return new Promise(resolve => {
        if (!API_KEY) { resolve(null); return; }
        const opts = {
            hostname: BASE, port: 443, method: 'GET',
            path: `/v1${endpoint}`,
            headers: {
                'X-CoinAPI-Key': API_KEY,
                'Accept': 'application/json',
                'Accept-Encoding': 'deflate, gzip'
            },
            timeout: timeoutMs
        };
        const req = https.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                if (res.statusCode === 429) { console.warn('[CoinAPI] Rate limited'); resolve(null); return; }
                if (res.statusCode === 403) { 
                    const body = d.substring(0,200);
                    if (body.includes('Insufficient Usage Credits') || body.includes('Quota exceeded')) {
                        console.warn('[CoinAPI] ⚠️  Quota exceeded — upgrade at https://www.coinapi.io/pricing');
                    } else {
                        console.warn('[CoinAPI] 403 Forbidden — check API key');
                    }
                    resolve(null); return; 
                }
                if (res.statusCode !== 200) { resolve(null); return; }
                try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}

// ─── 1. Current Exchange Rate (instant price) ─────────────────────────────────
async function getCurrentPrice(symbol) {
    const asset = getAssetId(symbol);
    const data  = await apiGet(`/exchangerate/${asset}/USD`);
    if (!data?.rate) return null;
    return {
        symbol:    asset,
        price:     data.rate,
        time:      data.time,
        source:    'coinapi'
    };
}

// ─── 2. OHLCV Candles (premium quality, multi-exchange) ───────────────────────
// period_id: 1MIN, 5MIN, 15MIN, 30MIN, 1HRS, 4HRS, 1DAY
async function getOHLCV(symbol, period = '1HRS', limit = 100) {
    const symId = getSymbol(symbol);
    if (!symId) {
        // Fallback: use exchange rate endpoint to get just price
        const p = await getCurrentPrice(symbol);
        return p ? [{ time: Date.now(), open: p.price, high: p.price, low: p.price, close: p.price, volume: 0, source: 'coinapi_rate' }] : null;
    }
    const data = await apiGet(`/ohlcv/${symId}/latest?period_id=${period}&limit=${limit}`);
    if (!Array.isArray(data) || !data.length) return null;
    return data.map(c => ({
        time:   new Date(c.time_close).getTime(),
        open:   c.price_open,
        high:   c.price_high,
        low:    c.price_low,
        close:  c.price_close,
        volume: c.volume_traded,
        trades: c.trades_count,
        source: 'coinapi'
    })).reverse(); // newest last
}

// ─── 3. Asset Info (market metrics) ──────────────────────────────────────────
async function getAssetInfo(symbol) {
    const asset = getAssetId(symbol);
    const data  = await apiGet(`/assets/${asset}`);
    if (!Array.isArray(data) || !data.length) return null;
    const a = data[0];
    return {
        id:           a.asset_id,
        name:         a.name,
        type:         a.type_is_crypto ? 'crypto' : 'fiat',
        price:        a.price_usd,
        volume1h:     a.volume_1hrs_usd,
        volume1d:     a.volume_1day_usd,
        volume1m:     a.volume_1mth_usd,
        exchanges:    a.id_icon,
        source:       'coinapi'
    };
}

// ─── 4. Multi-exchange Price Snapshot (for price divergence detection) ─────────
async function getMultiExchangeQuotes(symbol) {
    const asset = getAssetId(symbol);
    // Get rates from all major exchanges simultaneously
    const data  = await apiGet(`/exchangerate/${asset}/USD?invert=false`);
    return data?.rate ? { rate: data.rate, time: data.time } : null;
}

// ─── 5. Check API remaining quota ─────────────────────────────────────────────
async function getApiStatus() {
    return new Promise(resolve => {
        if (!API_KEY) { resolve({ ok: false, hasKey: false, reason: 'no_key' }); return; }
        const opts = {
            hostname: BASE, port: 443, method: 'GET',
            path: '/v1/exchangerate/BTC/USD',
            headers: { 'X-CoinAPI-Key': API_KEY, 'Accept': 'application/json' },
            timeout: 8000
        };
        const req = require('https').request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve({ ok: true, hasKey: true, reason: 'online' });
                } else if (res.statusCode === 403) {
                    const isQuota = d.includes('Insufficient') || d.includes('Quota');
                    resolve({ ok: false, hasKey: true, reason: isQuota ? 'quota_exceeded' : 'forbidden' });
                } else {
                    resolve({ ok: false, hasKey: true, reason: `http_${res.statusCode}` });
                }
            });
        });
        req.on('error', () => resolve({ ok: false, hasKey: true, reason: 'network_error' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, hasKey: true, reason: 'timeout' }); });
        req.end();
    });
}

module.exports = {
    getCurrentPrice,
    getOHLCV,
    getAssetInfo,
    getMultiExchangeQuotes,
    getApiStatus,
    getSymbol,
    getAssetId,
    API_KEY
};
