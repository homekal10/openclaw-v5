/**
 * market_fetcher.cjs — Free data sources only
 * Primary: Yahoo Finance (crypto + metals + forex) — confirmed working
 * Fallback: Binance public API, Kraken
 */

const path = require('path');
const { getCryptoCandles } = require('./coingecko.cjs');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

// Provider health tracking (non-blocking — never crashes fetcher)
let _registry = null;
function reg() {
    if (!_registry) {
        try { _registry = require('./lib/providers/provider_registry.cjs'); } catch { _registry = { recordSuccess: ()=>{}, recordFailure: ()=>{} }; }
    }
    return _registry;
}


// ─── Symbol routing map ───────────────────────────────────────────────────────
// All crypto now routed through Yahoo Finance (BTC-USD etc.) — Binance may be geo-blocked
const SYMBOL_MAP = {
    // Crypto → Yahoo Finance primary
    BTC:      { type: 'yahoo', yahoo: 'BTC-USD',   display: 'BTC/USD',   binance: 'BTCUSDT' },
    BTCUSD:   { type: 'yahoo', yahoo: 'BTC-USD',   display: 'BTC/USD',   binance: 'BTCUSDT' },
    BTCUSDT:  { type: 'yahoo', yahoo: 'BTC-USD',   display: 'BTC/USD',   binance: 'BTCUSDT' },
    ETH:      { type: 'yahoo', yahoo: 'ETH-USD',   display: 'ETH/USD',   binance: 'ETHUSDT' },
    ETHUSD:   { type: 'yahoo', yahoo: 'ETH-USD',   display: 'ETH/USD',   binance: 'ETHUSDT' },
    BNB:      { type: 'yahoo', yahoo: 'BNB-USD',   display: 'BNB/USD',   binance: 'BNBUSDT' },
    SOL:      { type: 'yahoo', yahoo: 'SOL-USD',   display: 'SOL/USD',   binance: 'SOLUSDT' },
    XRP:      { type: 'yahoo', yahoo: 'XRP-USD',   display: 'XRP/USD',   binance: 'XRPUSDT' },
    ADA:      { type: 'yahoo', yahoo: 'ADA-USD',   display: 'ADA/USD',   binance: 'ADAUSDT' },
    DOGE:     { type: 'yahoo', yahoo: 'DOGE-USD',  display: 'DOGE/USD',  binance: 'DOGEUSDT' },
    MATIC:    { type: 'yahoo', yahoo: 'MATIC-USD', display: 'MATIC/USD', binance: 'MATICUSDT' },
    // Metals → Yahoo Finance (Gold/Silver Futures)
    XAUUSD:   { type: 'yahoo', yahoo: 'GC=F',      display: 'GOLD (XAU/USD)' },
    GOLD:     { type: 'yahoo', yahoo: 'GC=F',      display: 'GOLD (XAU/USD)' },
    XAGUSD:   { type: 'yahoo', yahoo: 'SI=F',      display: 'SILVER (XAG/USD)' },
    SILVER:   { type: 'yahoo', yahoo: 'SI=F',      display: 'SILVER (XAG/USD)' },
    // US Indices
    SPX:      { type: 'yahoo', yahoo: '^GSPC',     display: 'S&P 500' },
    NDX:      { type: 'yahoo', yahoo: '^NDX',      display: 'NASDAQ 100' },
    DXY:      { type: 'yahoo', yahoo: 'DX-Y.NYB',  display: 'USD Index (DXY)' },
    // Forex → Yahoo Finance
    EURUSD:   { type: 'yahoo', yahoo: 'EURUSD=X',  display: 'EUR/USD' },
    GBPUSD:   { type: 'yahoo', yahoo: 'GBPUSD=X',  display: 'GBP/USD' },
    USDJPY:   { type: 'yahoo', yahoo: 'USDJPY=X',  display: 'USD/JPY' },
    USDCHF:   { type: 'yahoo', yahoo: 'USDCHF=X',  display: 'USD/CHF' },
    AUDUSD:   { type: 'yahoo', yahoo: 'AUDUSD=X',  display: 'AUD/USD' },
    NZDUSD:   { type: 'yahoo', yahoo: 'NZDUSD=X',  display: 'NZD/USD' },
    USDCAD:   { type: 'yahoo', yahoo: 'USDCAD=X',  display: 'USD/CAD' },
};

function resolveSymbol(input) {
    const clean = input.toUpperCase().replace(/[\/\s]/g, '');
    return SYMBOL_MAP[clean] || null;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch(e) { clearTimeout(timer); throw e; }
}

async function fetchWithRetry(url, opts = {}, retries = 3, delayMs = 4000) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fetchWithTimeout(url, opts, 45000);
        } catch(e) {
            lastErr = e;
            if (i < retries - 1) {
                console.log(`[Fetch] Retry ${i+1}/${retries-1} for ${url.substring(0,50)}...`);
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }
    throw lastErr;
}

// ─── Yahoo Finance OHLCV ─────────────────────────────────────────────────────
async function fetchYahoo(yahooTicker, interval = '1d', range = '300d') {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooTicker}?interval=${interval}&range=${range}`;
    const res = await fetchWithRetry(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
    }, 3, 5000);
    if (!res.ok) throw new Error(`Yahoo Finance ${res.status} for ${yahooTicker}`);
    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) throw new Error(`No data from Yahoo for ${yahooTicker}`);

    const times  = result.timestamp;
    const quotes = result.indicators.quote[0];
    const candles = [];
    for (let i = 0; i < times.length; i++) {
        if (quotes.close[i] == null) continue;
        candles.push({
            time:   times[i] * 1000,
            open:   parseFloat(quotes.open[i]   || quotes.close[i]),
            high:   parseFloat(quotes.high[i]   || quotes.close[i]),
            low:    parseFloat(quotes.low[i]    || quotes.close[i]),
            close:  parseFloat(quotes.close[i]),
            volume: parseFloat(quotes.volume[i] || 0)
        });
    }
    if (candles.length < 10) throw new Error(`Insufficient data from Yahoo for ${yahooTicker} (got ${candles.length})`);
    return candles;
}

// ─── Yahoo Finance with hourly fallback for crypto ───────────────────────────
async function fetchYahooSmart(sym) {
    let candles = [];
    try {
        candles = await fetchYahoo(sym.yahoo, '1h', '60d');
    } catch(e) {}
    
    if (candles.length < 60) {
        candles = await fetchYahoo(sym.yahoo, '1d', '300d');
    }

    if (candles.length > 0) {
        const lastTime = candles[candles.length - 1].time;
        const hoursStale = (Date.now() - lastTime) / 3600000;
        const isCrypto = sym.type === 'yahoo' && sym.yahoo?.includes('USD');
        
        // Crypto trades 24/7. Traditional markets close for weekends.
        if (isCrypto && hoursStale > 12) throw new Error(`Stale crypto data (${hoursStale.toFixed(1)}h old)`);
        if (!isCrypto && hoursStale > 96) throw new Error(`Stale market data (${hoursStale.toFixed(1)}h old)`);
    }

    return candles;
}

// ─── Binance (fallback if Yahoo fails) ───────────────────────────────────────
async function fetchBinance(binanceSymbol, limit = 210, interval = '1h') {
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
    const headers = {};
    if (process.env.BINANCE_API_KEY) headers['X-MBX-APIKEY'] = process.env.BINANCE_API_KEY;
    const res = await fetchWithRetry(url, { headers }, 3, 4000);
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const data = await res.json();
    return data.map(k => ({
        time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
    }));
}

// ─── Kraken (second fallback for crypto) ─────────────────────────────────────
async function fetchKraken(krakenPair, limit = 210, interval = 1440) {
    const since = Math.floor(Date.now() / 1000) - (limit * interval * 60);
    const url = `https://api.kraken.com/0/public/OHLC?pair=${krakenPair}&interval=${interval}&since=${since}`;
    const res = await fetchWithRetry(url, {}, 2, 3000);
    if (!res.ok) throw new Error(`Kraken ${res.status}`);
    const json = await res.json();
    if (json.error?.length) throw new Error(`Kraken: ${json.error[0]}`);
    const pairKey = Object.keys(json.result).find(k => k !== 'last');
    const rows = json.result[pairKey] || [];
    return rows.slice(-limit).map(k => ({
        time: k[0] * 1000, open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[6])
    }));
}

// ─── Portfolio (Binance authenticated) ───────────────────────────────────────
async function fetchBinancePortfolio() {
    const crypto = require('crypto');
    const apiKey    = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET || '';
    if (!apiKey) throw new Error('No Binance API key configured');
    const timestamp = Date.now();
    const query     = `timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    const res = await fetchWithTimeout(
        `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
    );
    if (!res.ok) throw new Error(`Binance account ${res.status}`);
    const data = await res.json();
    return (data.balances || []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
}

// ─── Main entry ───────────────────────────────────────────────────────────────
async function fetchCandles(symbolInput) {
    const sym = resolveSymbol(symbolInput);
    if (!sym) {
        const known = Object.keys(SYMBOL_MAP).join(', ');
        throw new Error(`Unknown symbol "${symbolInput}". Supported: ${known}`);
    }

    const display = sym.display || sym.yahoo;
    const errors  = [];

    // Always try Yahoo first (confirmed working)
    try {
        const t0 = Date.now();
        const candles = await fetchYahooSmart(sym);
        reg().recordSuccess('yahoo_finance', Date.now() - t0);
        return { candles, display, provider: 'yahoo_finance' };
    } catch(e) {
        reg().recordFailure('yahoo_finance', e.message);
        errors.push(`Yahoo: ${e.message}`);
    }

    // Binance fallback (crypto only)
    if (sym.binance) {
        try {
            const t0 = Date.now();
            const candles = await fetchBinance(sym.binance);
            reg().recordSuccess('binance', Date.now() - t0);
            return { candles, display, provider: 'binance' };
        } catch(e) {
            reg().recordFailure('binance', e.message);
            errors.push(`Binance: ${e.message}`);
        }
    }

    // Kraken fallback (BTC/ETH only)
    const krakenMap = { 'BTC-USD': 'XBTUSD', 'ETH-USD': 'ETHUSD' };
    if (krakenMap[sym.yahoo]) {
        try {
            const t0 = Date.now();
            const candles = await fetchKraken(krakenMap[sym.yahoo]);
            reg().recordSuccess('kraken', Date.now() - t0);
            return { candles, display, provider: 'kraken' };
        } catch(e) {
            reg().recordFailure('kraken', e.message);
            errors.push(`Kraken: ${e.message}`);
        }
    }

    // CoinGecko fallback (crypto only)
    if (sym.binance || (sym.type === 'yahoo' && sym.yahoo?.includes('USD'))) {
        try {
            const t0 = Date.now();
            const cgSym   = symbolInput.toUpperCase().replace('USD','').replace('USDT','');
            const candles = await getCryptoCandles(cgSym, 60);
            if (candles?.length) {
                reg().recordSuccess('coingecko', Date.now() - t0);
                console.log(`[Fetcher] CoinGecko fallback OK for ${symbolInput}`);
                return { candles, display, provider: 'coingecko' };
            }
        } catch(e) {
            reg().recordFailure('coingecko', e.message);
            errors.push(`CoinGecko: ${e.message}`);
        }
    }

    throw new Error(`All sources failed for ${symbolInput}:\n${errors.join('\n')}`);
}

module.exports = { fetchCandles, resolveSymbol, fetchBinancePortfolio };
