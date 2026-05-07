/**
 * market_data_fusion.cjs — Dual-Source Market Intelligence Fusion
 *
 * Intelligently merges CoinGecko + CoinAPI data:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Source        │ Strength                    │ Used For          │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  CoinGecko     │ Sentiment, social, trending  │ Context, macro   │
 * │  CoinAPI       │ OHLCV, multi-exchange, tick  │ Prices, candles  │
 * │  Fusion Layer  │ Cross-validates both         │ Final signal     │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Fusion rules:
 *  - Price: CoinAPI primary (fresher tick data) → CoinGecko fallback
 *  - OHLCV: CoinAPI primary (volume from exchanges) → CoinGecko fallback
 *  - Sentiment/Social: CoinGecko only (CoinAPI has none)
 *  - Divergence alert: if price diff >0.8% between sources → flag it
 *  - Quality score: each data field tagged with source + freshness
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const CG = require('./coingecko.cjs');
const CA = require('./coinapi.cjs');
const snapStore = require('./lib/snapshots/snapshot_store.cjs');

// ─── Price divergence threshold (%) ──────────────────────────────────────────
const DIVERGENCE_THRESHOLD = 0.8;

// ─── Core: Fused Price Fetch ──────────────────────────────────────────────────
/**
 * getFusedPrice(symbol) → { price, source, divergence?, cgPrice, caPrice }
 * Uses CoinAPI for speed, cross-validates with CoinGecko.
 */
async function getFusedPrice(symbol) {
    const [caData, cgData] = await Promise.allSettled([
        CA.getCurrentPrice(symbol),
        CG.getCoinMarketData(symbol)
    ]);

    const caPrice = caData.status === 'fulfilled' ? caData.value?.price : null;
    const cgPrice = cgData.status === 'fulfilled' ? cgData.value?.price : null;

    let price  = null;
    let source = 'none';
    let divergence = null;

    if (caPrice && cgPrice) {
        const diff = Math.abs((caPrice - cgPrice) / cgPrice) * 100;
        divergence = parseFloat(diff.toFixed(3));
        // Use CoinAPI as primary (fresher tick data)
        price  = caPrice;
        source = divergence > DIVERGENCE_THRESHOLD
            ? `coinapi⚠️(${divergence.toFixed(2)}%_divergence)`
            : 'coinapi+coingecko';
    } else if (caPrice) {
        price  = caPrice;
        source = 'coinapi';
    } else if (cgPrice) {
        price  = cgPrice;
        source = 'coingecko';
    }

    return { price, source, divergence, cgPrice, caPrice, cgMarket: cgData.value };
}

// ─── Core: Fused OHLCV Candles ────────────────────────────────────────────────
/**
 * getFusedCandles(symbol, period, limit)
 * CoinAPI gives volume-weighted multi-exchange candles.
 * Falls back to CoinGecko OHLC if CoinAPI unavailable.
 */
async function getFusedCandles(symbol, period = '1HRS', limit = 100) {
    // Try CoinAPI first (has volume data, more exchanges)
    const caCandles = await CA.getOHLCV(symbol, period, limit);
    if (caCandles && caCandles.length >= 10) {
        return { candles: caCandles, source: 'coinapi', count: caCandles.length };
    }

    // Fallback: CoinGecko OHLC (days mapped from period)
    const dayMap = { '1MIN': 1, '5MIN': 1, '15MIN': 2, '30MIN': 3, '1HRS': 7, '4HRS': 14, '1DAY': 60 };
    const days   = dayMap[period] || 7;
    const cgCandles = await CG.getCryptoCandles(symbol, days);
    if (cgCandles && cgCandles.length >= 5) {
        return { candles: cgCandles, source: 'coingecko', count: cgCandles.length };
    }

    // Deep Fallback: Yahoo/Binance/Kraken
    try {
        const { fetchCandles } = require('./market_fetcher.cjs');
        const fallback = await fetchCandles(symbol);
        if (fallback && fallback.candles?.length >= 5) {
            return { candles: fallback.candles, source: fallback.provider || 'yahoo/fallback', count: fallback.candles.length };
        }
    } catch (e) {}

    return { candles: null, source: 'none', count: 0 };
}

// ─── Core: Full Market Intelligence Package ───────────────────────────────────
/**
 * getFullIntelligence(symbol)
 * The main data package used by the signal orchestrator.
 * Returns everything needed for an institutional-grade analysis.
 */
async function getFullIntelligence(symbol) {
    const t0 = Date.now();

    // Run all sources in parallel for speed
    const [
        priceResult,
        candleResult,
        cgMarket,
        cgGlobal,
        cgFearGreed,
        cgTrending,
        caAsset
    ] = await Promise.allSettled([
        getFusedPrice(symbol),
        getFusedCandles(symbol, '1HRS', 60),
        CG.getCoinMarketData(symbol),
        CG.getGlobalStats(),
        CG.getFearGreed(),
        CG.getTrending(),
        CA.getAssetInfo(symbol)
    ]);

    const price    = priceResult.value    || {};
    const candles  = candleResult.value   || {};
    const market   = cgMarket.value       || {};
    const global   = cgGlobal.value       || {};
    const fearGreed = cgFearGreed.value   || null;
    const trending  = cgTrending.value    || [];
    const asset     = caAsset.value       || {};

    // Compute technical indicators from fused candles
    const ta = candles.candles ? computeTA(candles.candles) : {};

    // Quality score: how complete is our data?
    const quality = [
        price.price   ? 25 : 0,
        candles.count > 10 ? 25 : candles.count > 0 ? 10 : 0,
        market.change24h !== undefined ? 20 : 0,
        fearGreed ? 15 : 0,
        ta.rsi ? 15 : 0
    ].reduce((a, b) => a + b, 0);

    const result = {
        // Price (dual-sourced)
        price:         price.price || market.price,
        priceSource:   price.source,
        cgPrice:       price.cgPrice,
        caPrice:       price.caPrice,
        divergence:    price.divergence,
        priceDivAlert: price.divergence > DIVERGENCE_THRESHOLD,

        // OHLCV (premium candles)
        candles:       candles.candles,
        candleSource:  candles.source,
        candleCount:   candles.count,

        // Market context (CoinGecko)
        change1h:      market.change1h,
        change24h:     market.change24h,
        change7d:      market.change7d,
        change30d:     market.change30d,
        volume24h:     asset.volume1d || market.volume24h,
        marketCap:     market.marketCap,
        rank:          market.rank,
        high24h:       market.high24h,
        low24h:        market.low24h,
        ath:           market.ath,
        athChange:     market.athChange,
        sentiment_up:  market.sentiment_up,

        // Macro (CoinGecko)
        fearGreed,
        globalMarket:  global,
        trending:      trending.slice(0, 5),

        // CoinAPI asset data
        caVolume1h:    asset.volume1h,
        caVolume1d:    asset.volume1d,

        // Technical Analysis (from fused candles)
        ta,

        // Meta
        quality,
        fetchMs:   Date.now() - t0,
        timestamp: new Date().toISOString(),
        sources:   {
            price:   price.source,
            candles: candles.source,
            market:  'coingecko',
            macro:   'coingecko',
            ta:      candles.source
        }
    };

    // ── Write Snapshots ──────────────────────────────────────────────────────
    try {
        const priceSrc = price.source || 'unknown';
        // MarketSnapshot
        snapStore.put('MARKET', symbol, null, {
            price: result.price, bid: null, ask: null, spread: null,
            change_24h: result.change24h, volume_24h: result.volume24h,
            high_24h: result.high24h, low_24h: result.low24h,
            source: priceSrc
        }, { provider: priceSrc.split('+')[0].split('⚠')[0], warnings: price.divergence > DIVERGENCE_THRESHOLD ? ['Price divergence: ' + price.divergence + '%'] : [] });

        // IndicatorSnapshot (if TA computed)
        if (ta && ta.rsi) {
            const lastCandle = candles.candles?.[candles.candles.length - 1];
            snapStore.put('INDICATOR', symbol, '1H', {
                rsi: ta.rsi, rsi_signal: ta.rsi > 70 ? 'OVERBOUGHT' : ta.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL',
                macd: null, adx: null, atr: ta.atr,
                ema_20: ta.ema20, ema_50: ta.ema50, ema_200: ta.ema200,
                bb: null,
                candle_close_time: lastCandle?.time || lastCandle?.timestamp || null,
                candles_used: candles.count,
                trend: ta.trend, momentum: ta.momentum
            }, { provider: candles.source || 'unknown' });
        }

        // FearGreedSnapshot
        if (fearGreed) {
            snapStore.put('FEARGREED', null, null, {
                value: fearGreed.value,
                classification: fearGreed.label || fearGreed.classification,
                previous_value: null, previous_classification: null,
                week_avg: null, month_avg: null,
                provider_timestamp: fearGreed.timestamp || new Date().toISOString()
            }, { provider: 'alternative.me' });
        }
    } catch(snapErr) {
        console.warn('[Fusion] Snapshot write error:', snapErr.message);
    }

    return result;
}

// ─── Technical Analysis from OHLCV ───────────────────────────────────────────
function computeTA(candles) {
    if (!candles || candles.length < 14) return {};

    const closes = candles.map(c => c.close).filter(Boolean);
    const highs  = candles.map(c => c.high).filter(Boolean);
    const lows   = candles.map(c => c.low).filter(Boolean);
    const vols   = candles.map(c => c.volume || 0);

    // EMA helper
    function ema(data, period) {
        const k = 2 / (period + 1);
        let e = data[0];
        for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
        return e;
    }

    // RSI
    function rsi(data, period = 14) {
        if (data.length < period + 1) return null;
        let gains = 0, losses = 0;
        for (let i = data.length - period; i < data.length; i++) {
            const d = data[i] - data[i - 1];
            if (d > 0) gains += d; else losses += Math.abs(d);
        }
        const rs = gains / (losses || 0.0001);
        return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
    }

    // ATR (14)
    function atr(period = 14) {
        const trs = [];
        for (let i = Math.max(1, candles.length - period); i < candles.length; i++) {
            const h = highs[i], l = lows[i], pc = closes[i - 1];
            trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        }
        return trs.length ? parseFloat((trs.reduce((a, b) => a + b, 0) / trs.length).toFixed(4)) : null;
    }

    const price   = closes[closes.length - 1];
    const ema20   = ema(closes.slice(-20), 20);
    const ema50   = ema(closes.slice(-50), 50);
    const ema200  = closes.length >= 200 ? ema(closes.slice(-200), 200) : null;
    const rsi14   = rsi(closes, 14);
    const atr14   = atr(14);
    const avgVol  = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVol = vols[vols.length - 1];
    const volSpike = avgVol > 0 ? parseFloat((lastVol / avgVol).toFixed(2)) : null;

    const trend = price > ema20 && ema20 > ema50 ? 'BULLISH'
                : price < ema20 && ema20 < ema50 ? 'BEARISH'
                : 'NEUTRAL';

    const momentum = rsi14 > 60 ? 'STRONG_BULL'
                   : rsi14 > 50 ? 'MILD_BULL'
                   : rsi14 < 40 ? 'STRONG_BEAR'
                   : rsi14 < 50 ? 'MILD_BEAR'
                   : 'NEUTRAL';

    return {
        price, ema20: parseFloat(ema20.toFixed(4)), ema50: parseFloat(ema50.toFixed(4)),
        ema200: ema200 ? parseFloat(ema200.toFixed(4)) : null,
        rsi: rsi14, atr: atr14,
        trend, momentum,
        volSpike,
        priceVsEma20: parseFloat(((price - ema20) / ema20 * 100).toFixed(3)),
        priceVsEma50: parseFloat(((price - ema50) / ema50 * 100).toFixed(3)),
    };
}

// ─── Generate enhanced signal using fused data ────────────────────────────────
async function generateFusedCryptoSignal(symbol) {
    const intel = await getFullIntelligence(symbol);
    if (!intel.price) return null;

    let score   = 50;
    const signals = [];

    const { fearGreed, change24h, globalMarket, ta, divergence } = intel;

    // Fear & Greed
    if (fearGreed) {
        if (fearGreed.value <= 20)      { score += 20; signals.push(`😱 Extreme Fear (${fearGreed.value}) — contrarian BUY zone`); }
        else if (fearGreed.value <= 40) { score += 10; signals.push(`😟 Fear (${fearGreed.value}) — potential accumulation`); }
        else if (fearGreed.value >= 80) { score -= 15; signals.push(`🤑 Extreme Greed (${fearGreed.value}) — distribution risk`); }
        else if (fearGreed.value >= 65) { score -= 8;  signals.push(`😊 Greed (${fearGreed.value}) — caution at highs`); }
    }

    // Price momentum (CoinGecko 24h)
    if (change24h !== undefined) {
        if (change24h < -8)       { score += 12; signals.push(`📉 ${Math.abs(change24h).toFixed(1)}% dip — oversold bounce potential`); }
        else if (change24h > 10)  { score -= 10; signals.push(`📈 +${change24h.toFixed(1)}% surge — overextended`); }
        else if (change24h > 3)   { score += 8;  signals.push(`📈 +${change24h.toFixed(1)}% momentum — bullish`); }
        else if (change24h < -3)  { score -= 5;  signals.push(`📉 ${Math.abs(change24h).toFixed(1)}% decline — bearish`); }
    }

    // Technical (CoinAPI OHLCV-powered)
    if (ta.rsi) {
        if (ta.rsi < 30)       { score += 15; signals.push(`📊 RSI ${ta.rsi} — oversold (CoinAPI candles)`); }
        else if (ta.rsi > 70)  { score -= 12; signals.push(`📊 RSI ${ta.rsi} — overbought (CoinAPI candles)`); }
        else if (ta.rsi < 45)  { score -= 5;  signals.push(`📊 RSI ${ta.rsi} — bearish lean`); }
        else if (ta.rsi > 55)  { score += 5;  signals.push(`📊 RSI ${ta.rsi} — bullish lean`); }
    }

    // Trend structure (EMA — from CoinAPI candles)
    if (ta.trend === 'BULLISH') { score += 10; signals.push(`📈 EMA20 > EMA50 — uptrend structure`); }
    if (ta.trend === 'BEARISH') { score -= 10; signals.push(`📉 EMA20 < EMA50 — downtrend structure`); }

    // Volume spike
    if (ta.volSpike > 2.5) { score += 8; signals.push(`⚡ Volume spike ×${ta.volSpike} vs 20-period avg`); }

    // Global macro
    if (globalMarket?.marketTrend === 'BULLISH' && symbol.toUpperCase().includes('BTC')) {
        score += 5; signals.push(`🌍 Global market cap trending UP — macro tailwind`);
    }

    // Price divergence alert
    if (divergence > DIVERGENCE_THRESHOLD) {
        signals.push(`⚠️ Price divergence: CoinAPI $${intel.caPrice?.toFixed(2)} vs CoinGecko $${intel.cgPrice?.toFixed(2)} (${divergence}%)`);
    }

    score = Math.max(0, Math.min(100, score));
    const direction = score >= 58 ? 'BUY' : score <= 42 ? 'SELL' : 'NEUTRAL';

    return { ...intel, direction, score, signals };
}

// ─── Format fused signal for Telegram ────────────────────────────────────────
function formatFusedSignal(sig) {
    if (!sig) return '❌ Could not fetch market data.';
    const { price, direction, score, signals, ta, fearGreed,
            globalMarket, change24h, change7d, volume24h, marketCap,
            rank, priceSource, candleSource, divergence, candleCount, quality } = sig;

    const sym    = sig.symbol || '';
    const dir    = direction === 'BUY' ? '🟢 BUY' : direction === 'SELL' ? '🔴 SELL' : '🟡 NEUTRAL';
    const bar    = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
    const fmt    = n => n >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n||0).toFixed(2)}`;
    const fgIcon = fearGreed ? (fearGreed.value <= 25 ? '😱' : fearGreed.value >= 75 ? '🤑' : '😐') : '—';
    const chIcon = (change24h || 0) >= 0 ? '📈' : '📉';

    return `⚡ *${sym} — Institutional Intelligence*

💰 Price: \`$${price?.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:4})}\`
${chIcon} 24h: \`${change24h?.toFixed(2)}%\` | 7d: \`${change7d?.toFixed(2)}%\`
📊 Volume: \`${fmt(volume24h)}\` | MCap: \`${fmt(marketCap)}\`
${rank ? `🏆 Rank: *#${rank}*` : ''}

📐 *Technical (${candleCount} candles from ${candleSource}):*
• RSI(14): \`${ta.rsi || '—'}\` | Trend: \`${ta.trend || '—'}\`
• EMA20: \`${ta.ema20 || '—'}\` | EMA50: \`${ta.ema50 || '—'}\`
${ta.volSpike > 1.5 ? `• ⚡ Vol Spike: ×${ta.volSpike}` : ''}

${fgIcon} *Fear & Greed:* \`${fearGreed ? fearGreed.value + ' — ' + fearGreed.label : 'N/A'}\`
${globalMarket ? `🌍 BTC Dom: \`${globalMarket.btcDominance}%\` | Market: \`${globalMarket.marketTrend}\`` : ''}
${divergence > DIVERGENCE_THRESHOLD ? `⚠️ *Price divergence alert:* ${divergence.toFixed(2)}%` : ''}

*Signal:* ${dir}
*Score:* \`${bar}\` *${score}/100*
*Data Quality:* \`${quality}/100\`

*Analysis:*
${signals.map(s => `• ${s}`).join('\n') || '• Neutral conditions'}

_Sources: ${priceSource} price | ${candleSource} candles | CoinGecko sentiment_
_Analysis only — not financial advice_`;
}

// ─── Quick API status check ───────────────────────────────────────────────────
async function checkDataSources() {
    const [cgTest, caTest] = await Promise.allSettled([
        CG.getGlobalStats(),
        CA.getApiStatus()
    ]);
    return {
        coingecko: cgTest.value ? '✅ Online' : '❌ Offline',
        coinapi:   caTest.value?.ok ? '✅ Online' : caTest.value?.hasKey ? '⚠️ Key set, API issue' : '❌ No key'
    };
}

module.exports = {
    getFusedPrice,
    getFusedCandles,
    getFullIntelligence,
    generateFusedCryptoSignal,
    formatFusedSignal,
    checkDataSources,
    computeTA
};
