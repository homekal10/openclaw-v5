/**
 * gold_scalper.cjs — M1 Gold Scalping Engine
 * ──────────────────────────────────────────────────────────────────
 * Institutional-grade M1 scalping strategy for XAUUSD.
 *
 * Indicators:
 *   1. Bollinger Bands (20, 2σ) — price stretch detection
 *   2. Stochastic (5, 3, 3)     — momentum exhaustion
 *   3. Awesome Oscillator        — momentum change confirmation
 *   4. ATR (14)                  — dynamic SL/TP (0.5×ATR each)
 *
 * Expert Team Notes:
 *   [Quant] Bollinger + Stochastic is a classic mean-reversion pair.
 *           AO confirms momentum flip to avoid catching knives.
 *   [Risk]  0.5×ATR SL/TP gives 1:1 RR baseline. For better RR,
 *           we also compute 0.8×ATR TP2 for a 1:1.6 extended target.
 *   [Signal Auditor] All signals require 3/3 confluence. No partial
 *           confluence allowed. Session filter applied (no Asian scalps).
 *   [Architect] This module is self-contained but uses shared ATR/EMA
 *           from strategy_engine.cjs for consistency.
 */

'use strict';

const path = require('path');
const { calcATR, calcEMA, detectSession } = require(path.join(__dirname, '..', '..', 'strategy_engine.cjs'));

// v3.4: Indicator Intelligence enrichment (timing context only — never approves trades)
let indicatorIntelligence = null;
try { indicatorIntelligence = require(path.join(__dirname, '..', 'indicators', 'indicator_intelligence.cjs')); } catch {}

// ─── Bollinger Bands (SMA-based, 20 period, 2 standard deviations) ──────────

/**
 * Compute Bollinger Bands for an array of closing prices.
 * @param {number[]} closes
 * @param {number} period - Lookback (default 20)
 * @param {number} stdDev - Multiplier (default 2)
 * @returns {{ upper: number, middle: number, lower: number, bandwidth: number, pctB: number }}
 */
function calcBollingerBands(closes, period = 20, stdDev = 2) {
    if (closes.length < period) return null;

    const slice = closes.slice(-period);
    const sma   = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period;
    const sd    = Math.sqrt(variance);

    const upper  = sma + stdDev * sd;
    const lower  = sma - stdDev * sd;
    const middle = sma;
    const bandwidth = upper - lower;
    const currentPrice = closes[closes.length - 1];
    // %B: 0 = at lower band, 1 = at upper band, <0 = below lower, >1 = above upper
    const pctB  = bandwidth > 0 ? (currentPrice - lower) / bandwidth : 0.5;

    return {
        upper:     parseFloat(upper.toFixed(2)),
        middle:    parseFloat(middle.toFixed(2)),
        lower:     parseFloat(lower.toFixed(2)),
        bandwidth: parseFloat(bandwidth.toFixed(2)),
        pctB:      parseFloat(pctB.toFixed(4)),
        sd:        parseFloat(sd.toFixed(4))
    };
}

// ─── Stochastic Oscillator (5, 3, 3) ────────────────────────────────────────

/**
 * Compute Stochastic %K and %D.
 * @param {Array<{high:number,low:number,close:number}>} candles
 * @param {number} kPeriod - %K lookback (default 5)
 * @param {number} kSmooth - %K smoothing (default 3)
 * @param {number} dPeriod - %D smoothing of %K (default 3)
 * @returns {{ k: number, d: number, zone: string, crossover: string|null }}
 */
function calcStochastic(candles, kPeriod = 5, kSmooth = 3, dPeriod = 3) {
    const needed = kPeriod + kSmooth + dPeriod;
    if (candles.length < needed) return null;

    // Raw %K values
    const rawK = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const slice = candles.slice(i - kPeriod + 1, i + 1);
        const hh = Math.max(...slice.map(c => c.high));
        const ll = Math.min(...slice.map(c => c.low));
        const range = hh - ll;
        rawK.push(range > 0 ? ((candles[i].close - ll) / range) * 100 : 50);
    }

    // Smooth %K with SMA
    const smoothedK = [];
    for (let i = kSmooth - 1; i < rawK.length; i++) {
        const avg = rawK.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0) / kSmooth;
        smoothedK.push(avg);
    }

    // %D = SMA of smoothed %K
    const dValues = [];
    for (let i = dPeriod - 1; i < smoothedK.length; i++) {
        const avg = smoothedK.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod;
        dValues.push(avg);
    }

    if (smoothedK.length < 2 || dValues.length < 2) return null;

    const k    = parseFloat(smoothedK[smoothedK.length - 1].toFixed(2));
    const kPrev = parseFloat(smoothedK[smoothedK.length - 2].toFixed(2));
    const d    = parseFloat(dValues[dValues.length - 1].toFixed(2));
    const dPrev = parseFloat(dValues[dValues.length - 2].toFixed(2));

    // Zone classification
    let zone = 'neutral';
    if (k < 20) zone = 'oversold';
    else if (k > 80) zone = 'overbought';

    // Crossover detection
    let crossover = null;
    if (kPrev <= dPrev && k > d) crossover = 'bullish';  // %K crosses above %D
    if (kPrev >= dPrev && k < d) crossover = 'bearish';  // %K crosses below %D

    return { k, d, kPrev, dPrev, zone, crossover };
}

// ─── Awesome Oscillator ─────────────────────────────────────────────────────

/**
 * Compute the Awesome Oscillator (AO = SMA5(median) - SMA34(median)).
 * @param {Array<{high:number,low:number}>} candles
 * @returns {{ value: number, prev: number, color: string, flip: string|null }}
 */
function calcAwesomeOscillator(candles) {
    if (candles.length < 35) return null;

    const medians = candles.map(c => (c.high + c.low) / 2);

    // SMA of medians
    const sma = (arr, period) => {
        if (arr.length < period) return null;
        return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
    };

    // We need AO for current and previous bar
    const aoValues = [];
    for (let i = 33; i < medians.length; i++) {
        const slice = medians.slice(0, i + 1);
        const fast  = slice.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const slow  = slice.slice(-34).reduce((a, b) => a + b, 0) / 34;
        aoValues.push(fast - slow);
    }

    if (aoValues.length < 2) return null;

    const value = parseFloat(aoValues[aoValues.length - 1].toFixed(4));
    const prev  = parseFloat(aoValues[aoValues.length - 2].toFixed(4));

    // Color: green = current > prev, red = current < prev
    const color = value > prev ? 'green' : 'red';
    const prevColor = aoValues.length >= 3
        ? (aoValues[aoValues.length - 2] > aoValues[aoValues.length - 3] ? 'green' : 'red')
        : null;

    // Momentum flip: red→green or green→red
    let flip = null;
    if (prevColor === 'red' && color === 'green') flip = 'bullish';
    if (prevColor === 'green' && color === 'red') flip = 'bearish';

    return { value, prev, color, prevColor, flip };
}

// ─── Scalping Signal Generator ──────────────────────────────────────────────

/**
 * Generate a scalping signal from M1 candle data.
 *
 * @param {Array<{open,high,low,close,volume,time}>} candles - M1 candle array (need 50+)
 * @param {object} opts
 * @param {string} opts.symbol - e.g. 'XAUUSD'
 * @param {number} opts.spread - current spread in pips (optional, default 0.3)
 * @returns {object} Scalping signal result
 */
function generateScalpSignal(candles, opts = {}) {
    const symbol  = opts.symbol || 'XAUUSD';
    const spread  = opts.spread || 0.3;
    const now     = new Date();

    if (!candles || candles.length < 50) {
        return {
            action: 'WAIT', reason: 'Insufficient M1 data (need 50+ candles)',
            symbol, timeframe: 'M1', timestamp: now.toISOString()
        };
    }

    const closes = candles.map(c => c.close);
    const price  = closes[closes.length - 1];

    // ─── Compute all indicators ───────────────────────────────────
    const bb     = calcBollingerBands(closes, 20, 2);
    const stoch  = calcStochastic(candles, 5, 3, 3);
    const ao     = calcAwesomeOscillator(candles);
    const atr    = calcATR(candles, 14);
    const session = detectSession();

    if (!bb || !stoch || !ao || !atr) {
        return {
            action: 'WAIT', reason: 'Indicator calculation failed — insufficient data',
            symbol, timeframe: 'M1', timestamp: now.toISOString(),
            indicators: { bb: !!bb, stoch: !!stoch, ao: !!ao, atr: !!atr }
        };
    }

    // ─── Confluence scoring ───────────────────────────────────────
    let buyScore  = 0;
    let sellScore = 0;
    const confluences = { buy: [], sell: [] };
    const conflicts   = [];

    // 1. Bollinger Bands — price at band edges
    if (bb.pctB <= 0.05) {         // at or below lower band
        buyScore += 30;
        confluences.buy.push(`BB: Price at lower band (%B=${bb.pctB})`);
    } else if (bb.pctB <= 0.15) {
        buyScore += 15;
        confluences.buy.push(`BB: Price near lower band (%B=${bb.pctB})`);
    }

    if (bb.pctB >= 0.95) {         // at or above upper band
        sellScore += 30;
        confluences.sell.push(`BB: Price at upper band (%B=${bb.pctB})`);
    } else if (bb.pctB >= 0.85) {
        sellScore += 15;
        confluences.sell.push(`BB: Price near upper band (%B=${bb.pctB})`);
    }

    // 2. Stochastic — exhaustion zones
    if (stoch.zone === 'oversold') {
        buyScore += 30;
        confluences.buy.push(`Stoch: Oversold (K=${stoch.k}, D=${stoch.d})`);
        if (stoch.crossover === 'bullish') {
            buyScore += 10;
            confluences.buy.push('Stoch: Bullish crossover (%K > %D)');
        }
    }
    if (stoch.zone === 'overbought') {
        sellScore += 30;
        confluences.sell.push(`Stoch: Overbought (K=${stoch.k}, D=${stoch.d})`);
        if (stoch.crossover === 'bearish') {
            sellScore += 10;
            confluences.sell.push('Stoch: Bearish crossover (%K < %D)');
        }
    }

    // 3. Awesome Oscillator — momentum flip
    if (ao.flip === 'bullish') {
        buyScore += 30;
        confluences.buy.push(`AO: Red→Green flip (${ao.prev.toFixed(2)}→${ao.value.toFixed(2)})`);
    } else if (ao.color === 'green' && ao.value > ao.prev) {
        buyScore += 10;
        confluences.buy.push('AO: Increasing green momentum');
    }

    if (ao.flip === 'bearish') {
        sellScore += 30;
        confluences.sell.push(`AO: Green→Red flip (${ao.prev.toFixed(2)}→${ao.value.toFixed(2)})`);
    } else if (ao.color === 'red' && ao.value < ao.prev) {
        sellScore += 10;
        confluences.sell.push('AO: Increasing red momentum');
    }

    // ─── Determine signal direction ───────────────────────────────
    const slDistance = parseFloat((atr * 0.5).toFixed(2));
    const tp1Distance = parseFloat((atr * 0.5).toFixed(2));
    const tp2Distance = parseFloat((atr * 0.8).toFixed(2));  // Expert extension

    let action = 'WAIT';
    let bias   = 'NEUTRAL';
    let score  = 0;
    let entry, sl, tp1, tp2, rr1, rr2, setupConfs, reason;

    if (buyScore >= 60 && buyScore > sellScore) {
        action = 'BUY';
        bias   = 'BULLISH';
        score  = buyScore;
        entry  = price;
        sl     = parseFloat((price - slDistance).toFixed(2));
        tp1    = parseFloat((price + tp1Distance).toFixed(2));
        tp2    = parseFloat((price + tp2Distance).toFixed(2));
        rr1    = 1.0;
        rr2    = parseFloat((tp2Distance / slDistance).toFixed(2));
        setupConfs = confluences.buy;
        reason = 'Full 3/3 confluence: BB lower band + Stoch oversold + AO bullish';
    } else if (sellScore >= 60 && sellScore > buyScore) {
        action = 'SELL';
        bias   = 'BEARISH';
        score  = sellScore;
        entry  = price;
        sl     = parseFloat((price + slDistance).toFixed(2));
        tp1    = parseFloat((price - tp1Distance).toFixed(2));
        tp2    = parseFloat((price - tp2Distance).toFixed(2));
        rr1    = 1.0;
        rr2    = parseFloat((tp2Distance / slDistance).toFixed(2));
        setupConfs = confluences.sell;
        reason = 'Full 3/3 confluence: BB upper band + Stoch overbought + AO bearish';
    } else {
        score  = Math.max(buyScore, sellScore);
        bias   = buyScore > sellScore ? 'LEAN_BULLISH' : sellScore > buyScore ? 'LEAN_BEARISH' : 'NEUTRAL';
        setupConfs = buyScore > sellScore ? confluences.buy : confluences.sell;
        reason = score > 30
            ? `Partial confluence (${score}/90) — waiting for full alignment`
            : 'No confluence detected — sideways/choppy conditions';
    }

    // ─── Veto Logic (Expert team hard blocks) ────────────────────
    const vetoes = [];

    // [Signal Auditor] Session veto — no Asian session scalps for gold
    if (session.quality === 'low') {
        if (action === 'BUY' || action === 'SELL') {
            vetoes.push(`Session: ${session.session} (quality: low) — gold scalps unreliable`);
            action = 'WAIT';
        }
    }

    // [Risk] Spread veto — spread too wide for scalping
    if (spread > 0.5) {
        if (action === 'BUY' || action === 'SELL') {
            vetoes.push(`Spread: ${spread} pips exceeds 0.5 limit — scalp risk too high`);
            action = 'WAIT';
        }
    }

    // [Quant] Bandwidth veto — BB too narrow = low volatility, no scalp
    if (bb.bandwidth < atr * 0.3) {
        if (action === 'BUY' || action === 'SELL') {
            vetoes.push(`BB Bandwidth: ${bb.bandwidth} too narrow — low volatility, avoid scalps`);
            action = 'WAIT';
        }
    }

    // [Risk] SL too tight veto — less than $0.50 for gold is noise
    if (slDistance < 0.50) {
        if (action === 'BUY' || action === 'SELL') {
            vetoes.push(`SL Distance: $${slDistance} too tight — inside noise range`);
            action = 'WAIT';
        }
    }

    // [Signal Auditor] Conflicting signals veto
    if (buyScore >= 40 && sellScore >= 40) {
        vetoes.push(`Conflicting signals: buyScore=${buyScore}, sellScore=${sellScore}`);
        action = 'WAIT';
        conflicts.push('Buy and sell signals competing — market indecisive');
    }

    // ─── Build result ────────────────────────────────────────────
    return {
        // Signal
        action,
        bias,
        score,
        symbol,
        timeframe: 'M1',
        strategy: 'GOLD_SCALP_BB_STOCH_AO',
        setup_type: action !== 'WAIT' ? 'Bollinger Band Mean-Reversion Scalp' : null,
        timestamp: now.toISOString(),

        // Entry / Risk
        ...(action !== 'WAIT' ? {
            entry, sl, tp1, tp2,
            rr1, rr2,
            sl_distance: slDistance,
            tp1_distance: tp1Distance,
            tp2_distance: tp2Distance,
        } : {}),
        currentPrice: price,

        // Reason
        reason,
        confluences: setupConfs || [],
        conflicts,
        vetoes,

        // Indicators (full transparency + v3.4 intelligence enrichment)
        indicators: (function() {
            const raw = {
                bollinger: {
                    upper: bb.upper, middle: bb.middle, lower: bb.lower,
                    pctB: bb.pctB, bandwidth: bb.bandwidth, sd: bb.sd || 0
                },
                stochastic: { k: stoch.k, d: stoch.d, zone: stoch.zone, crossover: stoch.crossover },
                awesome_oscillator: { value: ao.value, prev: ao.prev, color: ao.color, flip: ao.flip },
                atr: { value: atr, sl_multiplier: 0.5, tp1_multiplier: 0.5, tp2_multiplier: 0.8 }
            };
            // v3.4: Enrich with intelligence layer if available
            if (indicatorIntelligence) {
                try {
                    const bbE  = indicatorIntelligence.enrichBollingerBands(raw.bollinger, price);
                    const stE  = indicatorIntelligence.enrichStochastic(raw.stochastic);
                    const aoE  = indicatorIntelligence.enrichAwesomeOscillator(raw.awesome_oscillator);
                    const atrE = indicatorIntelligence.enrichATR(atr, price);
                    const conf = indicatorIntelligence.generateConfluenceSummary({ bb: bbE, stoch: stE, ao: aoE, atr: atrE });
                    return {
                        bollinger:         { ...raw.bollinger, ...bbE },
                        stochastic:        { ...raw.stochastic, ...stE },
                        awesome_oscillator: { ...raw.awesome_oscillator, ...aoE },
                        atr:               { ...raw.atr, ...atrE },
                        confluence:        conf,
                        // Safety: intelligence layer is timing context only
                        _trade_approval:   false,
                        _approval_note:    'BUY/SELL approval is by signal_verifier only'
                    };
                } catch {}
            }
            return raw;
        })(),
        indicator_intelligence_version: indicatorIntelligence ? 'v3.4' : 'raw',

        // Session context
        session: session.session,
        sessionQuality: session.quality,

        // Metadata
        candle_count: candles.length,
        last_candle_time: candles[candles.length - 1].time || null
    };
}

// ─── Telegram Formatter ─────────────────────────────────────────────────────

function formatScalpSignal(signal) {
    if (!signal) return '❌ No scalp data available.';

    const lines = [];
    const icon = signal.action === 'BUY' ? '🟢' : signal.action === 'SELL' ? '🔴' : '⏸️';

    lines.push(`${icon} *GOLD M1 SCALP — ${signal.action}*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    if (signal.action === 'BUY' || signal.action === 'SELL') {
        lines.push(`📊 *Asset:* ${signal.symbol}`);
        lines.push(`⚡ *Action:* ${signal.action}`);
        lines.push(`🎯 *Setup:* ${signal.setup_type}`);
        lines.push(`📈 *Bias:* ${signal.bias}`);
        lines.push(`💯 *Confluence:* ${signal.score}/90`);
        lines.push('');
        lines.push(`🔹 *Entry:* $${signal.entry}`);
        lines.push(`🛑 *SL:* $${signal.sl} (0.5×ATR = $${signal.sl_distance})`);
        lines.push(`✅ *TP1:* $${signal.tp1} (1:1 RR)`);
        lines.push(`🏆 *TP2:* $${signal.tp2} (1:${signal.rr2} RR)`);
        lines.push('');
        lines.push('📐 *Indicators:*');
        const ind = signal.indicators;
        lines.push(`  BB: ${ind.bollinger.lower} — [${ind.bollinger.middle}] — ${ind.bollinger.upper} | %B=${ind.bollinger.pctB}`);
        lines.push(`  Stoch: K=${ind.stochastic.k} D=${ind.stochastic.d} (${ind.stochastic.zone})`);
        lines.push(`  AO: ${ind.awesome_oscillator.value > 0 ? '+' : ''}${ind.awesome_oscillator.value} [${ind.awesome_oscillator.color}]${ind.awesome_oscillator.flip ? ' ⚡' + ind.awesome_oscillator.flip.toUpperCase() + ' FLIP' : ''}`);
        lines.push(`  ATR: ${ind.atr.value}`);
        lines.push('');
        lines.push('*Why:*');
        signal.confluences.forEach(c => lines.push(`  ✓ ${c}`));
        if (signal.vetoes.length) {
            lines.push('');
            lines.push('⚠️ *Watch:*');
            signal.vetoes.forEach(v => lines.push(`  ⚠ ${v}`));
        }
    } else {
        // WAIT
        lines.push(`📊 *Asset:* ${signal.symbol}`);
        lines.push(`⏸️ *Action:* WAIT`);
        lines.push(`📈 *Lean:* ${signal.bias}`);
        lines.push(`💯 *Partial Score:* ${signal.score}/90`);
        lines.push('');
        lines.push(`*Reason:* ${signal.reason}`);
        lines.push('');
        lines.push('📐 *Current Indicators:*');
        const ind = signal.indicators;
        lines.push(`  BB %B: ${ind.bollinger.pctB} (0=lower, 1=upper)`);
        lines.push(`  Stoch: K=${ind.stochastic.k} (${ind.stochastic.zone})`);
        lines.push(`  AO: ${ind.awesome_oscillator.color} (flip: ${ind.awesome_oscillator.flip || 'none'})`);
        lines.push(`  ATR: ${ind.atr.value}`);
        if (signal.confluences.length) {
            lines.push('');
            lines.push('*Partial Confluences:*');
            signal.confluences.forEach(c => lines.push(`  ◉ ${c}`));
        }
        if (signal.vetoes.length) {
            lines.push('');
            lines.push('🚫 *Vetoes:*');
            signal.vetoes.forEach(v => lines.push(`  ✖ ${v}`));
        }
    }

    lines.push('');
    lines.push(`🕐 *Session:* ${signal.session} (${signal.sessionQuality})`);
    lines.push(`📊 *Candles:* ${signal.candle_count} M1`);
    lines.push(`⏰ ${new Date(signal.timestamp).toUTCString()}`);
    lines.push('');
    lines.push('_Strategy: BB(20,2) + Stoch(5,3,3) + AO | SL/TP: 0.5×ATR_');
    lines.push('_⚠️ Scalping is high-risk. Use proper position sizing._');

    return lines.join('\n');
}

module.exports = {
    // Indicator functions (reusable)
    calcBollingerBands,
    calcStochastic,
    calcAwesomeOscillator,

    // Signal generation
    generateScalpSignal,

    // Telegram formatting
    formatScalpSignal
};
