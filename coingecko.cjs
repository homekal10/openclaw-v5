/**
 * coingecko.cjs — CoinGecko API integration for crypto intelligence
 * Free public API: no key required (rate limit ~30 req/min)
 * Provides: OHLCV candles, market data, trending, fear & greed, signals
 */

const https = require('https');
const path  = require('path');

const BASE = 'api.coingecko.com';

// ─── Coin ID map (symbol → CoinGecko ID) ─────────────────────────────────────
const COIN_IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',   BNB: 'binancecoin',
    XRP: 'ripple',  ADA: 'cardano',  DOT: 'polkadot', DOGE: 'dogecoin',
    AVAX:'avalanche-2', MATIC:'matic-network', LINK:'chainlink',
    LTC: 'litecoin', UNI:'uniswap',  ATOM:'cosmos',   FIL:'filecoin',
    INJ: 'injective-protocol', SUI:'sui', ARB:'arbitrum', OP:'optimism',
    BTCUSD:'bitcoin', ETHUSD:'ethereum', SOLUSD:'solana'
};

function getCoinId(symbol) {
    const s = symbol.toUpperCase().replace('USDT','').replace('USD','').replace('PERP','');
    return COIN_IDS[s] || s.toLowerCase();
}

// ─── Exponential back-off config ──────────────────────────────────────────────
const BACKOFF_BASE_MS  = 500;
const BACKOFF_MAX_RETRIES = 3;
let _rateLimitUntil = 0; // Timestamp until which we should not call CoinGecko

// ─── HTTPS GET helper (with retry + 429 handling) ─────────────────────────────
function cgGet(endpoint, params = {}, _retryCount = 0) {
    // If we're in a rate-limit cool-down window, return null immediately
    if (Date.now() < _rateLimitUntil) return Promise.resolve(null);

    return new Promise((resolve) => {
        const query = Object.entries(params).map(([k,v]) => `${k}=${v}`).join('&');
        const p = `/api/v3${endpoint}${query ? '?' + query : ''}`;
        const startMs = Date.now();
        const opts = {
            hostname: BASE, port: 443, path: p, method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw/3.3' },
            timeout: 15000
        };
        const req = https.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                const latency = Date.now() - startMs;
                // Record in api_counter
                try {
                    const { recordCall } = require('./api_counter.cjs');
                    if (res.statusCode === 429) {
                        recordCall('coingecko', false, latency, { type: 'fetch', caller: 'coingecko', error: 'HTTP_429_RATE_LIMITED' });
                    } else if (res.statusCode >= 200 && res.statusCode < 300) {
                        recordCall('coingecko', true, latency, { type: 'fetch', caller: 'coingecko' });
                    } else {
                        recordCall('coingecko', false, latency, { type: 'fetch', caller: 'coingecko', error: `HTTP_${res.statusCode}` });
                    }
                } catch {}

                // Handle 429 — exponential back-off retry
                if (res.statusCode === 429) {
                    if (_retryCount < BACKOFF_MAX_RETRIES) {
                        const delay = BACKOFF_BASE_MS * Math.pow(2, _retryCount);
                        console.warn(`[CoinGecko] 429 rate-limited on ${endpoint} — retry ${_retryCount + 1}/${BACKOFF_MAX_RETRIES} in ${delay}ms`);
                        setTimeout(() => {
                            cgGet(endpoint, params, _retryCount + 1).then(resolve);
                        }, delay);
                        return;
                    }
                    // All retries exhausted — set cool-down (60s)
                    _rateLimitUntil = Date.now() + 60000;
                    console.warn(`[CoinGecko] 429 retries exhausted for ${endpoint} — cooling down 60s`);
                    resolve(null);
                    return;
                }

                try { resolve(JSON.parse(d)); }
                catch(e) { resolve(null); }
            });
        });
        req.on('error', () => {
            try { const { recordCall } = require('./api_counter.cjs'); recordCall('coingecko', false, Date.now() - startMs, { type: 'fetch', caller: 'coingecko', error: 'NETWORK_ERROR' }); } catch {}
            resolve(null);
        });
        req.on('timeout', () => {
            try { const { recordCall } = require('./api_counter.cjs'); recordCall('coingecko', false, Date.now() - startMs, { type: 'fetch', caller: 'coingecko', error: 'TIMEOUT' }); } catch {}
            req.destroy();
            resolve(null);
        });
        req.end();
    });
}

// ─── 1. OHLCV Candles (for charts + technical analysis) ──────────────────────
async function getCryptoCandles(symbol, days = 60) {
    const id = getCoinId(symbol);
    // CoinGecko OHLC endpoint: [timestamp, open, high, low, close]
    const data = await cgGet(`/coins/${id}/ohlc`, { vs_currency: 'usd', days });
    if (!Array.isArray(data) || !data.length) return null;
    return data.map(([time, open, high, low, close]) => ({
        time, open, high, low, close, volume: 0, source: 'coingecko'
    }));
}

// ─── 2. Full market data for a coin ──────────────────────────────────────────
async function getCoinMarketData(symbol) {
    const id = getCoinId(symbol);
    const data = await cgGet(`/coins/${id}`, {
        localization: false, tickers: false,
        market_data: true, community_data: false,
        developer_data: false, sparkline: false
    });
    if (!data?.market_data) return null;
    const m = data.market_data;
    return {
        id, name: data.name, symbol: data.symbol?.toUpperCase(),
        price:          m.current_price?.usd,
        change1h:       m.price_change_percentage_1h_in_currency?.usd,
        change24h:      m.price_change_percentage_24h,
        change7d:       m.price_change_percentage_7d,
        change30d:      m.price_change_percentage_30d,
        marketCap:      m.market_cap?.usd,
        volume24h:      m.total_volume?.usd,
        high24h:        m.high_24h?.usd,
        low24h:         m.low_24h?.usd,
        ath:            m.ath?.usd,
        athChange:      m.ath_change_percentage?.usd,
        circulatingSupply: m.circulating_supply,
        totalSupply:    m.total_supply,
        rank:           data.market_cap_rank,
        description:    data.description?.en?.substring(0, 200) || '',
        sentiment_up:   data.sentiment_votes_up_percentage,
        sentiment_down: data.sentiment_votes_down_percentage
    };
}

// ─── 3. Market overview (top 10 by market cap) ───────────────────────────────
async function getTopCoins(limit = 10) {
    const data = await cgGet('/coins/markets', {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: limit, page: 1,
        sparkline: false,
        price_change_percentage: '1h,24h,7d'
    });
    return Array.isArray(data) ? data : [];
}

// ─── 4. Trending coins ────────────────────────────────────────────────────────
async function getTrending() {
    const data = await cgGet('/search/trending');
    return data?.coins?.map(c => ({
        name:   c.item.name,
        symbol: c.item.symbol,
        rank:   c.item.market_cap_rank,
        score:  c.item.score
    })) || [];
}

// ─── 5. Global crypto market stats ───────────────────────────────────────────
async function getGlobalStats() {
    const data = await cgGet('/global');
    if (!data?.data) return null;
    const d = data.data;
    return {
        totalMarketCap:    d.total_market_cap?.usd,
        totalVolume:       d.total_volume?.usd,
        btcDominance:      d.market_cap_percentage?.btc?.toFixed(1),
        ethDominance:      d.market_cap_percentage?.eth?.toFixed(1),
        marketCapChange24h: d.market_cap_change_percentage_24h_usd?.toFixed(2),
        activeCryptos:     d.active_cryptocurrencies,
        marketTrend:       (d.market_cap_change_percentage_24h_usd || 0) >= 0 ? 'BULLISH' : 'BEARISH'
    };
}

// ─── 6. Fear & Greed Index (alternative.me — free) ───────────────────────────
async function getFearGreed() {
    return new Promise(resolve => {
        const opts = {
            hostname: 'api.alternative.me', port: 443,
            path: '/fng/?limit=1&format=json', method: 'GET',
            headers: { 'User-Agent': 'OpenClaw/2.0' }, timeout: 10000
        };
        const req = https.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(d);
                    const item   = parsed?.data?.[0];
                    resolve(item ? {
                        value:       parseInt(item.value),
                        label:       item.value_classification,
                        timestamp:   item.timestamp
                    } : null);
                } catch(e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}

// ─── 7. Generate crypto signal from CoinGecko data ───────────────────────────
async function generateCryptoSignal(symbol) {
    const [market, global, fg, candles] = await Promise.all([
        getCoinMarketData(symbol),
        getGlobalStats(),
        getFearGreed(),
        getCryptoCandles(symbol, 30)
    ]);

    if (!market) return null;

    // Signal logic
    let score = 50;
    const signals = [];

    // Fear & Greed
    if (fg) {
        if (fg.value <= 20) { score += 20; signals.push(`🟢 Extreme Fear (${fg.value}) — contrarian BUY`); }
        else if (fg.value <= 40) { score += 10; signals.push(`🟡 Fear (${fg.value}) — potential entry`); }
        else if (fg.value >= 80) { score -= 15; signals.push(`🔴 Extreme Greed (${fg.value}) — overbought`); }
        else if (fg.value >= 65) { score -= 8; signals.push(`🟡 Greed (${fg.value}) — caution`); }
    }

    // Price momentum
    if (market.change24h < -8)  { score += 12; signals.push(`📉 -${Math.abs(market.change24h).toFixed(1)}% dip — oversold bounce potential`); }
    else if (market.change24h > 10) { score -= 10; signals.push(`📈 +${market.change24h.toFixed(1)}% surge — overextended`); }
    else if (market.change24h > 3) { score += 8; signals.push(`📈 +${market.change24h.toFixed(1)}% momentum — bullish`); }

    // Market cap dominance (BTC only)
    if (symbol.toUpperCase().includes('BTC') && global) {
        const dom = parseFloat(global.btcDominance);
        if (dom > 55) { score += 8; signals.push(`Bitcoin dominance ${dom}% — crypto market led by BTC`); }
        if (parseFloat(global.marketCapChange24h) > 3) { score += 8; signals.push(`Total market cap +${global.marketCapChange24h}% — risk-on`); }
        if (parseFloat(global.marketCapChange24h) < -5) { score -= 12; signals.push(`Market cap -${Math.abs(global.marketCapChange24h)}% — risk-off`); }
    }

    // Volume spike
    if (market.volume24h && market.marketCap) {
        const volRatio = market.volume24h / market.marketCap;
        if (volRatio > 0.15) { score += 10; signals.push(`⚡ Volume/MCap ratio ${(volRatio*100).toFixed(1)}% — high activity`); }
    }

    // ATH distance
    if (market.athChange && market.athChange < -50) { score += 8; signals.push(`💎 ${Math.abs(market.athChange).toFixed(0)}% below ATH — deep value zone`); }

    score = Math.max(0, Math.min(100, score));

    const direction = score >= 55 ? 'BUY' : score <= 45 ? 'SELL' : 'NEUTRAL';

    return {
        symbol:    market.symbol,
        name:      market.name,
        price:     market.price,
        direction,
        score,
        signals,
        market,
        global,
        fearGreed: fg,
        candles
    };
}

// ─── 8. Format for Telegram ───────────────────────────────────────────────────
function formatCryptoSignal(sig) {
    if (!sig) return '❌ Could not fetch crypto data from CoinGecko.';
    const { symbol, name, price, direction, score, signals, market, global, fearGreed } = sig;

    const dir    = direction === 'BUY' ? '🟢 BUY' : direction === 'SELL' ? '🔴 SELL' : '🟡 NEUTRAL';
    const bar    = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
    const chIcon = (market.change24h || 0) >= 0 ? '📈' : '📉';
    const fgIcon = fearGreed ? (fearGreed.value <= 25 ? '😱' : fearGreed.value >= 75 ? '🤑' : '😐') : '—';

    const fmt = (n) => n ? (n >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : `$${n.toFixed(2)}`) : '—';

    return `⚡ *${name} (${symbol}) — CoinGecko Intelligence*

💰 Price: \`$${price?.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\`
${chIcon} 24h: \`${market.change24h?.toFixed(2)}%\` | 7d: \`${market.change7d?.toFixed(2)}%\`
📊 Volume: \`${fmt(market.volume24h)}\` | MCap: \`${fmt(market.marketCap)}\`
🏆 Rank: *#${market.rank}* | ATH: \`$${market.ath?.toLocaleString()}\`

${fgIcon} *Fear & Greed:* \`${fearGreed ? fearGreed.value + ' — ' + fearGreed.label : 'N/A'}\`
${global ? `🌍 BTC Dom: \`${global.btcDominance}%\` | Market ${global.marketTrend} (${global.marketCapChange24h}%)` : ''}

*Signal:* ${dir}
*Score:* \`${bar}\` *${score}/100*

*Analysis:*
${signals.map(s => `• ${s}`).join('\n') || '• Neutral market conditions'}

*Community Sentiment:*
🟢 Bullish: \`${market.sentiment_up?.toFixed(0) || '—'}%\` | 🔴 Bearish: \`${(100 - (market.sentiment_up || 50)).toFixed(0)}%\`

_Source: CoinGecko (live) | Analysis only — not financial advice_`;
}

function formatTopCoins(coins) {
    if (!coins.length) return '❌ CoinGecko unavailable.';
    const lines = coins.map((c, i) => {
        const ch = (c.price_change_percentage_24h || 0);
        const icon = ch >= 3 ? '🚀' : ch >= 0 ? '🟢' : ch > -3 ? '🔴' : '💥';
        return `${icon} *${i+1}. ${c.symbol.toUpperCase()}* \`$${c.current_price?.toLocaleString()}\` | ${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`;
    }).join('\n');
    return `⚡ *Crypto Market (CoinGecko)*\n\n${lines}\n\n_Updated: ${new Date().toUTCString()}_`;
}

module.exports = {
    getCryptoCandles, getCoinMarketData, getTopCoins,
    getTrending, getGlobalStats, getFearGreed,
    generateCryptoSignal, formatCryptoSignal, formatTopCoins, getCoinId
};
