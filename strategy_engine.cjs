/**
 * strategy_engine.cjs — Professional-grade analysis engine
 * Implements: ATR, ADX, MACD, RSI Divergence, Volume Trend,
 *             Dynamic S/R (swing points), Multi-TF awareness, Setup Score
 */

// ─── Core Indicators ──────────────────────────────────────────────────────────

function calcEMA(closes, period) {
    const k = 2 / (period + 1);
    let ema = closes[0];
    const result = [ema];
    for (let i = 1; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
        result.push(parseFloat(ema.toFixed(6)));
    }
    return result;
}

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d; else losses -= d;
    }
    let avgG = gains / period, avgL = losses / period;
    const vals = [];
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
        avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
        const rs = avgL === 0 ? 100 : avgG / avgL;
        vals.push(parseFloat((100 - 100 / (1 + rs)).toFixed(2)));
    }
    return vals;
}

function calcATR(candles, period = 14) {
    const trs = candles.map((c, i) => {
        if (i === 0) return c.high - c.low;
        const prev = candles[i - 1];
        return Math.max(
            c.high - c.low,
            Math.abs(c.high - prev.close),
            Math.abs(c.low  - prev.close)
        );
    });
    let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }
    return parseFloat(atr.toFixed(4));
}

function calcADX(candles, period = 14) {
    if (candles.length < period * 2) return null;
    const plusDM = [], minusDM = [], tr = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].high - candles[i - 1].high;
        const l = candles[i - 1].low - candles[i].low;
        plusDM.push(h > l && h > 0 ? h : 0);
        minusDM.push(l > h && l > 0 ? l : 0);
        const atr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low  - candles[i - 1].close)
        );
        tr.push(atr);
    }
    const smooth = (arr, p) => {
        let s = arr.slice(0, p).reduce((a, b) => a + b, 0);
        const res = [s];
        for (let i = p; i < arr.length; i++) { s = s - s / p + arr[i]; res.push(s); }
        return res;
    };
    const sTR = smooth(tr, period), sP = smooth(plusDM, period), sM = smooth(minusDM, period);
    const diP = sP.map((v, i) => sTR[i] ? 100 * v / sTR[i] : 0);
    const diM = sM.map((v, i) => sTR[i] ? 100 * v / sTR[i] : 0);
    const dx  = diP.map((v, i) => (v + diM[i]) ? 100 * Math.abs(v - diM[i]) / (v + diM[i]) : 0);
    const adx = dx.slice(-period).reduce((a, b) => a + b, 0) / period;
    return {
        adx:   parseFloat(adx.toFixed(2)),
        diPlus: parseFloat(diP[diP.length - 1].toFixed(2)),
        diMinus: parseFloat(diM[diM.length - 1].toFixed(2))
    };
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
    if (closes.length < slow + signal) return null;
    const emaFast   = calcEMA(closes, fast);
    const emaSlow   = calcEMA(closes, slow);
    const macdLine  = emaFast.slice(slow - fast).map((v, i) => parseFloat((v - emaSlow[i]).toFixed(6)));
    const signalLine = calcEMA(macdLine, signal);
    const histogram  = macdLine.slice(signal - 1).map((v, i) => parseFloat((v - signalLine[i]).toFixed(6)));
    return {
        macd:      macdLine[macdLine.length - 1],
        signal:    signalLine[signalLine.length - 1],
        histogram: histogram[histogram.length - 1],
        trend:     histogram[histogram.length - 1] > 0 ? 'BULLISH' : 'BEARISH'
    };
}

// ─── Volume Analysis ──────────────────────────────────────────────────────────
function analyzeVolume(candles, period = 10) {
    if (candles.length < period * 2) return { trend: 'UNKNOWN', ratio: 1 };
    const recent = candles.slice(-period).map(c => c.volume).reduce((a, b) => a + b, 0) / period;
    const prior  = candles.slice(-period * 2, -period).map(c => c.volume).reduce((a, b) => a + b, 0) / period;
    const ratio  = prior > 0 ? recent / prior : 1;
    return {
        trend: ratio > 1.1 ? 'INCREASING' : ratio < 0.9 ? 'DECLINING' : 'STABLE',
        ratio: parseFloat(ratio.toFixed(2))
    };
}

// ─── RSI Divergence ──────────────────────────────────────────────────────────
function detectRSIDivergence(candles, rsiVals, lookback = 14) {
    if (!rsiVals || rsiVals.length < lookback) return 'NONE';
    const priceSlice = candles.slice(-lookback);
    const rsiSlice   = rsiVals.slice(-lookback);

    const priceHH = priceSlice[priceSlice.length - 1].close > Math.max(...priceSlice.slice(0, -1).map(c => c.close));
    const priceLL = priceSlice[priceSlice.length - 1].close < Math.min(...priceSlice.slice(0, -1).map(c => c.close));
    const rsiHH   = rsiSlice[rsiSlice.length - 1] > Math.max(...rsiSlice.slice(0, -1));
    const rsiLL   = rsiSlice[rsiSlice.length - 1] < Math.min(...rsiSlice.slice(0, -1));

    if (priceHH && !rsiHH) return 'BEARISH_DIVERGENCE';  // price higher high, RSI lower high
    if (priceLL && !rsiLL) return 'BULLISH_DIVERGENCE';   // price lower low, RSI higher low
    return 'NONE';
}

// ─── Dynamic Support / Resistance (swing points) ─────────────────────────────
function findSwingPoints(candles, lookback = 30) {
    const recent = candles.slice(-lookback);
    const highs  = [], lows = [];

    for (let i = 2; i < recent.length - 2; i++) {
        const c = recent[i];
        if (c.high > recent[i-1].high && c.high > recent[i-2].high &&
            c.high > recent[i+1].high && c.high > recent[i+2].high) {
            highs.push(c.high);
        }
        if (c.low < recent[i-1].low && c.low < recent[i-2].low &&
            c.low < recent[i+1].low && c.low < recent[i+2].low) {
            lows.push(c.low);
        }
    }
    const currentPrice = candles[candles.length - 1].close;
    const nearResistance = highs.filter(h => h > currentPrice).sort((a,b) => a - b)[0] || null;
    const nearSupport    = lows.filter(l => l < currentPrice).sort((a,b) => b - a)[0] || null;
    return { nearSupport, nearResistance };
}

// ─── Structure Detection (HH/HL/LH/LL/BOS/CHOCH) ────────────────────────────
function detectStructure(candles, lookback = 30) {
    if (candles.length < 6) return { state: 'INSUFFICIENT_DATA', bosDetected: false, chochDetected: false };
    const recent = candles.slice(-Math.min(lookback, candles.length));

    // Find swing highs and lows (simplified: local pivots)
    const swingHighs = [], swingLows = [];
    for (let i = 2; i < recent.length - 2; i++) {
        if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
            recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
            swingHighs.push({ idx: i, price: recent[i].high });
        }
        if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
            recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
            swingLows.push({ idx: i, price: recent[i].low });
        }
    }

    if (swingHighs.length < 2 || swingLows.length < 2) {
        return { state: 'INSUFFICIENT_PIVOTS', bosDetected: false, chochDetected: false, swingHighs, swingLows };
    }

    const lastH = swingHighs[swingHighs.length - 1].price;
    const prevH = swingHighs[swingHighs.length - 2].price;
    const lastL = swingLows[swingLows.length - 1].price;
    const prevL = swingLows[swingLows.length - 2].price;

    const higherHigh = lastH > prevH;
    const higherLow  = lastL > prevL;
    const lowerHigh  = lastH < prevH;
    const lowerLow   = lastL < prevL;

    let state;
    if (higherHigh && higherLow) state = 'HH_HL';   // bullish structure
    else if (lowerHigh && lowerLow) state = 'LH_LL'; // bearish structure
    else if (higherHigh && lowerLow) state = 'MIXED';
    else if (lowerHigh && higherLow) state = 'MIXED';
    else state = 'NEUTRAL';

    // BOS: current price broke beyond the last swing high (bullish BOS) or low (bearish BOS)
    const currentPrice  = candles[candles.length - 1].close;
    const bosDetected   = currentPrice > lastH || currentPrice < lastL;
    const bosDirection  = currentPrice > lastH ? 'BULLISH' : currentPrice < lastL ? 'BEARISH' : null;

    // CHOCH: structure state flipped (was bullish, now showing LH/LL or vice versa)
    const chochDetected = (state === 'LH_LL' && prevH > swingHighs[0]?.price) ||
                          (state === 'HH_HL' && prevL < swingLows[0]?.price);

    return { state, bosDetected, bosDirection, chochDetected, swingHighs, swingLows, lastH, lastL };
}

// ─── Fair Value Gap (FVG) Detection ──────────────────────────────────────────
function detectFVG(candles, lookback = 20) {
    if (candles.length < 3) return { detected: false };
    const recent = candles.slice(-Math.min(lookback, candles.length));
    const currentPrice = candles[candles.length - 1].close;
    const atr = calcATR(candles, 14);
    const minGapSize = atr * 0.3; // FVG must be at least 30% of ATR to count

    const gaps = [];
    for (let i = 1; i < recent.length - 1; i++) {
        const prev = recent[i - 1];
        const curr = recent[i];
        const next = recent[i + 1];

        // Bullish FVG: gap between prev candle high and next candle low
        if (next.low > prev.high && (next.low - prev.high) >= minGapSize) {
            const gapLow  = prev.high;
            const gapHigh = next.low;
            const reclaimed = currentPrice < gapLow; // price traded back into gap
            gaps.push({ type: 'bullish', gapLow, gapHigh, reclaimed,
                inEntryZone: currentPrice >= gapLow && currentPrice <= gapHigh });
        }
        // Bearish FVG: gap between prev candle low and next candle high
        if (next.high < prev.low && (prev.low - next.high) >= minGapSize) {
            const gapHigh = prev.low;
            const gapLow  = next.high;
            const reclaimed = currentPrice > gapHigh;
            gaps.push({ type: 'bearish', gapLow, gapHigh, reclaimed,
                inEntryZone: currentPrice >= gapLow && currentPrice <= gapHigh });
        }
    }

    if (!gaps.length) return { detected: false, gaps: [] };

    // Find the most relevant FVG (closest, not reclaimed)
    const activeGaps = gaps.filter(g => !g.reclaimed);
    const inZoneGaps = activeGaps.filter(g => g.inEntryZone);
    const bestGap = inZoneGaps[0] || activeGaps[activeGaps.length - 1] || gaps[gaps.length - 1];

    return {
        detected:     true,
        type:         bestGap.type,
        gapLow:       parseFloat(bestGap.gapLow.toFixed(5)),
        gapHigh:      parseFloat(bestGap.gapHigh.toFixed(5)),
        reclaimed:    bestGap.reclaimed,
        inEntryZone:  bestGap.inEntryZone,
        activeGapCount: activeGaps.length,
        allGaps:      gaps
    };
}

// ─── Liquidity Sweep Detection ────────────────────────────────────────────────
function detectLiquiditySweep(candles, lookback = 50) {
    if (candles.length < 10) return { swept: false };
    const recent  = candles.slice(-Math.min(lookback, candles.length));
    const last    = candles[candles.length - 1];
    const prev    = candles[candles.length - 2];
    const atr     = calcATR(candles, 14);
    const tolerance = atr * 0.15;

    // Equal highs: multiple candles touching ~same high level
    const highs = recent.map(c => c.high);
    const lows  = recent.map(c => c.low);
    const maxHigh = Math.max(...highs.slice(0, -3));
    const minLow  = Math.min(...lows.slice(0, -3));

    // Detect equal high sweep: last candle wick spiked above prior highs then closed below
    const equalHighSweep = last.high > maxHigh + tolerance && last.close < maxHigh;
    // Detect equal low sweep
    const equalLowSweep  = last.low < minLow - tolerance && last.close > minLow;

    if (equalHighSweep) {
        return { swept: true, type: 'equal_high', level: parseFloat(maxHigh.toFixed(5)),
            sweepSize: parseFloat((last.high - maxHigh).toFixed(5)), freshness: 'fresh' };
    }
    if (equalLowSweep) {
        return { swept: true, type: 'equal_low', level: parseFloat(minLow.toFixed(5)),
            sweepSize: parseFloat((minLow - last.low).toFixed(5)), freshness: 'fresh' };
    }

    // Previous session sweep (prev candle swept, current closed away)
    if (prev && prev.high > maxHigh + tolerance && last.close < maxHigh) {
        return { swept: true, type: 'prev_day_high', level: parseFloat(maxHigh.toFixed(5)),
            freshness: 'recent' };
    }
    if (prev && prev.low < minLow - tolerance && last.close > minLow) {
        return { swept: true, type: 'prev_day_low', level: parseFloat(minLow.toFixed(5)),
            freshness: 'recent' };
    }

    return { swept: false, equalHighLevel: parseFloat(maxHigh.toFixed(5)),
        equalLowLevel: parseFloat(minLow.toFixed(5)) };
}

// ─── Session Detection ────────────────────────────────────────────────────────
function detectSession() {
    const now = new Date();
    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const utcTime = utcH + utcM / 60;

    // Session windows (UTC)
    if (utcTime >= 7 && utcTime < 8.5)  return { session: 'london_open',  quality: 'high' };
    if (utcTime >= 12 && utcTime < 13.5) return { session: 'ny_open',      quality: 'high' };
    if (utcTime >= 12 && utcTime < 16)   return { session: 'overlap',       quality: 'high' };
    if (utcTime >= 7  && utcTime < 12)   return { session: 'london',        quality: 'medium' };
    if (utcTime >= 12 && utcTime < 21)   return { session: 'ny',            quality: 'medium' };
    if (utcTime >= 23 || utcTime < 2)    return { session: 'asian',         quality: 'low' };
    if (utcTime >= 2  && utcTime < 7)    return { session: 'asian_london_transition', quality: 'low' };
    return { session: 'off_hours', quality: 'low' };
}

// ─── Price Position Analysis ──────────────────────────────────────────────────
function detectPricePosition(candles, lookback = 50) {
    if (candles.length < 10) return { position: 'UNKNOWN' };
    const recent = candles.slice(-Math.min(lookback, candles.length));
    const highs  = recent.map(c => c.high);
    const lows   = recent.map(c => c.low);
    const rangeH = Math.max(...highs);
    const rangeL = Math.min(...lows);
    const current = candles[candles.length - 1].close;
    const rangeSize = rangeH - rangeL;
    if (rangeSize === 0) return { position: 'UNKNOWN' };

    const pct = (current - rangeL) / rangeSize;
    let position;
    if (pct >= 0.7) position = 'NEAR_HIGH';     // top 30% — potential resistance / overbought
    else if (pct <= 0.3) position = 'NEAR_LOW'; // bottom 30% — potential support / oversold
    else position = 'MID_RANGE';                // 30-70% — no value entry

    return { position, pct: parseFloat((pct * 100).toFixed(1)), rangeHigh: rangeH, rangeLow: rangeL };
}

// ─── Setup Score (0–100) ─────────────────────────────────────────────────────
function calcSetupScore(params) {
    const { trend, rsi, rr, volumeTrend, adx, macd, divergence } = params;
    let score = 0;

    // Trend alignment: 25 pts
    if (trend === 'BULLISH' || trend === 'BEARISH') score += 25;
    else score += 5; // RANGE gets minimal

    // RSI zone: 20 pts
    if (rsi != null) {
        if ((trend === 'BULLISH' && rsi >= 45 && rsi <= 65)) score += 20;
        else if ((trend === 'BEARISH' && rsi >= 35 && rsi <= 55)) score += 20;
        else if (rsi > 30 && rsi < 70) score += 10;
        else score += 0;
    }

    // R:R quality: 25 pts
    if (rr >= 3)      score += 25;
    else if (rr >= 2) score += 18;
    else if (rr >= 1.5) score += 10;
    else if (rr >= 1) score += 5;

    // ADX (trend strength): 15 pts
    if (adx) {
        if (adx.adx >= 30) score += 15;
        else if (adx.adx >= 20) score += 8;
        else score += 2;
    } else score += 7; // neutral if no ADX

    // MACD confirmation: 10 pts
    if (macd) {
        const macdAligned = (trend === 'BULLISH' && macd.trend === 'BULLISH') ||
                            (trend === 'BEARISH' && macd.trend === 'BEARISH');
        score += macdAligned ? 10 : 0;
    } else score += 5;

    // Volume: 5 pts
    if (volumeTrend === 'INCREASING') score += 5;
    else if (volumeTrend === 'STABLE') score += 3;

    // Divergence penalty
    if (divergence === 'BEARISH_DIVERGENCE' && trend === 'BULLISH') score -= 15;
    if (divergence === 'BULLISH_DIVERGENCE' && trend === 'BEARISH') score -= 15;

    return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Main analyze() function ─────────────────────────────────────────────────
function analyze(candles, timeframe = '1D') {
    const closes = candles.map(c => c.close);
    const n      = closes.length;

    // EMAs
    const ema50Vals  = calcEMA(closes, 50);
    const ema200Vals = calcEMA(closes, 200);
    const ema20Vals  = calcEMA(closes, 20);
    const ema50  = ema50Vals[n - 1];
    const ema200 = ema200Vals[n - 1];
    const ema20  = ema20Vals[n - 1];
    const currentPrice = closes[n - 1];

    // RSI
    const rsiVals = calcRSI(closes, 14);
    const rsi     = rsiVals ? rsiVals[rsiVals.length - 1] : null;

    // ATR
    const atr = calcATR(candles, 14);

    // ADX
    const adx = calcADX(candles, 14);

    // MACD
    const macd = calcMACD(closes);

    // Volume
    const volAnalysis = analyzeVolume(candles, 10);

    // RSI Divergence
    const divergence = detectRSIDivergence(candles, rsiVals);

    // Dynamic S/R
    const { nearSupport, nearResistance } = findSwingPoints(candles, 40);

    // Distance to S/R in ATR units
    const srDistanceATR = {
        toResistance: nearResistance && atr ? parseFloat(((nearResistance - currentPrice) / atr).toFixed(2)) : null,
        toSupport:    nearSupport    && atr ? parseFloat(((currentPrice - nearSupport)    / atr).toFixed(2)) : null
    };

    // Trend determination
    let trend;
    if (currentPrice > ema50 && ema50 > ema200) trend = 'BULLISH';
    else if (currentPrice < ema50 && ema50 < ema200) trend = 'BEARISH';
    else trend = 'RANGE';

    // ── NEW: Institutional Layer Detectors ──
    const structure     = detectStructure(candles, 40);
    const fvg           = detectFVG(candles, 30);
    const sweep         = detectLiquiditySweep(candles, 60);
    const sessionInfo   = detectSession();
    const pricePos      = detectPricePosition(candles, 60);

    // Price near EMA zones?
    const priceNearEMA20  = atr ? Math.abs(currentPrice - ema20) / atr < 0.5 : false;
    const priceNearEMA50  = atr ? Math.abs(currentPrice - ema50) / atr < 0.8 : false;
    const priceNearEMA    = priceNearEMA20 || priceNearEMA50;

    // RSI zone classification
    let rsiZone = 'neutral';
    if (rsi != null) {
        if (trend === 'BULLISH' && rsi >= 45 && rsi <= 65) rsiZone = 'bullish_zone';
        else if (trend === 'BEARISH' && rsi >= 35 && rsi <= 55) rsiZone = 'bearish_zone';
        else if (rsi > 70) rsiZone = 'overbought';
        else if (rsi < 30) rsiZone = 'oversold';
    }

    // ATR expansion
    const atrExpanding = candles.length >= 5 ?
        calcATR(candles.slice(-5), 5) > atr * 1.1 : false;

    // Chase detection: price at RSI extreme without pullback
    const isChaseEntry = (rsi != null && rsi > 72 && trend === 'BULLISH') ||
                         (rsi != null && rsi < 28 && trend === 'BEARISH') ||
                         pricePos.position === 'NEAR_HIGH' && trend === 'BULLISH' ||
                         pricePos.position === 'NEAR_LOW'  && trend === 'BEARISH';

    return {
        currentPrice,
        ema20:  parseFloat(ema20.toFixed(4)),
        ema50:  parseFloat(ema50.toFixed(4)),
        ema200: parseFloat(ema200.toFixed(4)),
        rsi, rsiVals, rsiZone,
        atr, atrExpanding,
        adx,
        macd,
        trend,
        nearSupport, nearResistance, srDistanceATR,
        volumeTrend: volAnalysis.trend,
        volumeRatio: volAnalysis.ratio,
        divergence,
        timeframe,
        // ── Institutional Layer ──
        structure,                           // { state, bosDetected, chochDetected, ... }
        fvg,                                 // { detected, type, gapLow, gapHigh, inEntryZone, ... }
        sweep,                               // { swept, type, level, freshness }
        session: sessionInfo.session,
        sessionQuality: sessionInfo.quality,
        pricePosition: pricePos.position,
        pricePositionPct: pricePos.pct,
        priceNearEMA, priceNearEMA20, priceNearEMA50,
        isChaseEntry,
        equalHighDetected: !sweep.swept && !!sweep.equalHighLevel,
        equalLowDetected:  !sweep.swept && !!sweep.equalLowLevel
    };
}

module.exports = {
    analyze, calcEMA, calcRSI, calcATR, calcADX, calcMACD, calcSetupScore,
    // New institutional detectors (exported for direct use in agents)
    detectStructure, detectFVG, detectLiquiditySweep, detectSession, detectPricePosition
};
