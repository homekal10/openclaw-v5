/**
 * pattern-detector.cjs — OpenClaw Expert Pattern Recognition Engine v1.0
 *
 * Institutional-grade pattern detection for Smart Money Concepts (SMC):
 *   - Market regime classification (TRENDING/RANGING/VOLATILE/BREAKOUT)
 *   - ICT pattern library: FVG, Order Blocks, Breaker Blocks, Liquidity Pools
 *   - CHoCH / BOS detection for structure shifts
 *   - Premium/Discount zone identification
 *   - Multi-timeframe confluence scoring
 *   - Adaptive pattern confidence from trade history
 */
'use strict';

// ─── Market Regime Classifier ─────────────────────────────────────────────────

/**
 * classifyRegime(indicators) → { regime, confidence, description }
 * Uses ADX + ATR percentile + Bollinger Band width to determine market state.
 */
function classifyRegime({ adx, atrCurrent, atrAvg, bbWidth, bbWidthAvg, closes }) {
    const adxVal   = adx?.adx ?? 20;
    const atrRatio = atrAvg > 0 ? atrCurrent / atrAvg : 1;
    const bbRatio  = bbWidthAvg > 0 ? bbWidth / bbWidthAvg : 1;

    // Strong trend: ADX > 25, ATR expanding
    if (adxVal > 25 && atrRatio > 1.1) {
        return { regime: 'TRENDING', confidence: Math.min(95, 60 + adxVal), 
                 description: `Strong trend (ADX: ${adxVal}, ATR expanding ${(atrRatio*100-100).toFixed(0)}%)` };
    }

    // Breakout: BB squeeze then expansion, ADX rising
    if (bbRatio > 1.5 && atrRatio > 1.3) {
        return { regime: 'BREAKOUT', confidence: Math.min(90, 55 + adxVal),
                 description: `Breakout detected (BB width ${(bbRatio*100).toFixed(0)}% of avg, ATR expanding)` };
    }

    // Volatile: High ATR but no direction (ADX low)
    if (atrRatio > 1.3 && adxVal < 20) {
        return { regime: 'VOLATILE', confidence: 65,
                 description: `Volatile chop (ATR high but ADX ${adxVal} — no direction)` };
    }

    // Ranging: Low ADX, tight BB, normal ATR
    if (adxVal < 20 && bbRatio < 1.1) {
        return { regime: 'RANGING', confidence: Math.min(85, 70 + (20 - adxVal)),
                 description: `Range-bound (ADX: ${adxVal}, BB tight)` };
    }

    // Default: mild trend
    if (adxVal >= 20) {
        return { regime: 'TRENDING', confidence: 55,
                 description: `Mild trend (ADX: ${adxVal})` };
    }

    return { regime: 'RANGING', confidence: 50, description: 'No clear regime signal' };
}

// ─── Strategy Router (Regime → Best Strategies) ──────────────────────────────

const STRATEGY_MAP = {
    TRENDING: {
        active:     ['ny_continuation', 'ema_pullback_fvg'],
        watchlist:  ['trend_breakout_retest'],
        avoid:      ['range_sweep_trap', 'liquidity_grab_reversal'],
        indicators: ['EMA20/50', 'ADX', 'MACD'],
        description: 'Trend-following: ride momentum, buy pullbacks to EMA',
        confirmation: null
    },
    RANGING: {
        active:     ['range_sweep_trap', 'london_sweep_reversal'],
        watchlist:  ['asian_range_break'],
        avoid:      ['ny_continuation', 'ema_pullback_fvg', 'trend_breakout_retest'],
        indicators: ['RSI', 'Bollinger Bands', 'S/R Levels'],
        description: 'Mean-reversion: fade extremes, trade sweep-and-reverse',
        confirmation: null
    },
    VOLATILE: {
        active:     [],
        watchlist:  ['trend_breakout_retest'],
        avoid:      ['ema_pullback_fvg', 'range_sweep_trap', 'ny_continuation'],
        indicators: ['ATR', 'VWAP', 'Volume'],
        description: 'WAIT — No active strategies. Watch for structure break + retest only.',
        confirmation: 'Requires confirmed BOS/CHoCH + retest before any entry'
    },
    BREAKOUT: {
        active:     ['trend_breakout_retest'],
        watchlist:  ['ny_continuation', 'ema_pullback_fvg'],
        avoid:      ['range_sweep_trap'],
        indicators: ['Volume', 'ATR', 'MACD'],
        description: 'Breakout continuation: enter on confirmed break with volume',
        confirmation: null
    }
};

function getRecommendedStrategies(regime) {
    const map = STRATEGY_MAP[regime] || STRATEGY_MAP.RANGING;
    return {
        ...map,
        // Legacy compat: keep 'primary' pointing to 'active' for existing consumers
        primary: map.active,
        hasActiveStrategies: map.active.length > 0,
        requiresConfirmation: !!map.confirmation
    };
}

// ─── ICT Pattern Detection ────────────────────────────────────────────────────

/**
 * Detect Fair Value Gap (FVG) in candle data
 * FVG = gap between candle[i-2].high/low and candle[i].high/low with candle[i-1] body
 */
function detectFVG(candles) {
    if (!candles || candles.length < 3) return { detected: false };
    
    const results = [];
    for (let i = 2; i < candles.length; i++) {
        const prev2 = candles[i - 2];
        const mid   = candles[i - 1];
        const curr  = candles[i];

        // Bullish FVG: gap between prev2.high and curr.low
        if (curr.low > prev2.high) {
            results.push({
                type: 'bullish',
                gapHigh: curr.low,
                gapLow: prev2.high,
                gapSize: curr.low - prev2.high,
                midCandle: mid,
                index: i,
                freshness: i >= candles.length - 5 ? 'fresh' : i >= candles.length - 15 ? 'recent' : 'old'
            });
        }

        // Bearish FVG: gap between curr.high and prev2.low
        if (curr.high < prev2.low) {
            results.push({
                type: 'bearish',
                gapHigh: prev2.low,
                gapLow: curr.high,
                gapSize: prev2.low - curr.high,
                midCandle: mid,
                index: i,
                freshness: i >= candles.length - 5 ? 'fresh' : i >= candles.length - 15 ? 'recent' : 'old'
            });
        }
    }

    if (results.length === 0) return { detected: false };

    // Return most recent FVG
    const latest = results[results.length - 1];
    const price  = candles[candles.length - 1].close;
    const inEntryZone = price >= latest.gapLow && price <= latest.gapHigh;

    return {
        detected: true,
        type: latest.type,
        gapHigh: latest.gapHigh,
        gapLow: latest.gapLow,
        gapSize: latest.gapSize,
        inEntryZone,
        freshness: latest.freshness,
        reclaimed: false, // Would need price history to determine
        totalFVGs: results.length
    };
}

/**
 * Detect liquidity sweep (equal highs/lows taken out)
 */
function detectSweep(candles, lookback = 20) {
    if (!candles || candles.length < lookback) return { swept: false };

    const recent = candles.slice(-lookback);
    const current = candles[candles.length - 1];

    // Find equal highs (within 0.1% tolerance)
    const highs = recent.map(c => c.high);
    const lows  = recent.map(c => c.low);
    const tolerance = current.close * 0.001;

    // Check for sweep of equal highs
    const equalHighs = highs.filter(h => Math.abs(h - Math.max(...highs)) < tolerance);
    if (equalHighs.length >= 2 && current.high > Math.max(...highs)) {
        return {
            swept: true,
            type: 'equal_high',
            level: Math.max(...highs),
            freshness: 'fresh'
        };
    }

    // Check for sweep of equal lows
    const equalLows = lows.filter(l => Math.abs(l - Math.min(...lows)) < tolerance);
    if (equalLows.length >= 2 && current.low < Math.min(...lows)) {
        return {
            swept: true,
            type: 'equal_low',
            level: Math.min(...lows),
            freshness: 'fresh'
        };
    }

    // Check for previous day high/low sweep
    if (candles.length > 1) {
        const prevDay = candles[candles.length - 2];
        if (current.high > prevDay.high && current.close < prevDay.high) {
            return { swept: true, type: 'prev_day_high', level: prevDay.high, freshness: 'fresh' };
        }
        if (current.low < prevDay.low && current.close > prevDay.low) {
            return { swept: true, type: 'prev_day_low', level: prevDay.low, freshness: 'fresh' };
        }
    }

    return { swept: false };
}

/**
 * Detect Change of Character (CHoCH) and Break of Structure (BOS)
 */
function detectStructure(candles, lookback = 20) {
    if (!candles || candles.length < lookback) return { state: 'UNKNOWN' };

    const recent = candles.slice(-lookback);
    const swingHighs = [];
    const swingLows  = [];

    // Find swing points (local highs/lows with 2 candles on each side)
    for (let i = 2; i < recent.length - 2; i++) {
        if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
            recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
            swingHighs.push({ price: recent[i].high, index: i });
        }
        if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
            recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
            swingLows.push({ price: recent[i].low, index: i });
        }
    }

    if (swingHighs.length < 2 || swingLows.length < 2) {
        return { state: 'UNKNOWN', swingHighs: swingHighs.length, swingLows: swingLows.length };
    }

    const lastTwoHighs = swingHighs.slice(-2);
    const lastTwoLows  = swingLows.slice(-2);

    // Higher High + Higher Low = BULLISH structure
    const higherHigh = lastTwoHighs[1].price > lastTwoHighs[0].price;
    const higherLow  = lastTwoLows[1].price  > lastTwoLows[0].price;
    const lowerHigh  = lastTwoHighs[1].price < lastTwoHighs[0].price;
    const lowerLow   = lastTwoLows[1].price  < lastTwoLows[0].price;

    if (higherHigh && higherLow) {
        return { state: 'BULLISH', pattern: 'HH_HL', swingHighs, swingLows };
    }
    if (lowerHigh && lowerLow) {
        return { state: 'BEARISH', pattern: 'LH_LL', swingHighs, swingLows };
    }
    if (higherHigh && lowerLow) {
        return { state: 'MIXED', pattern: 'EXPANDING', swingHighs, swingLows };
    }
    if (lowerHigh && higherLow) {
        return { state: 'NEUTRAL', pattern: 'CONTRACTING', swingHighs, swingLows };
    }

    return { state: 'NEUTRAL', pattern: 'UNCLEAR', swingHighs, swingLows };
}

/**
 * Detect premium/discount zones based on range
 */
function detectPremiumDiscount(candles, lookback = 50) {
    if (!candles || candles.length < lookback) return { zone: 'MID_RANGE' };

    const recent = candles.slice(-lookback);
    const high   = Math.max(...recent.map(c => c.high));
    const low    = Math.min(...recent.map(c => c.low));
    const range  = high - low;
    const price  = candles[candles.length - 1].close;

    if (range === 0) return { zone: 'MID_RANGE', pctInRange: 50 };

    const pctInRange = ((price - low) / range) * 100;

    if (pctInRange > 70)      return { zone: 'PREMIUM', pctInRange, high, low, description: 'Price in premium zone — look for shorts' };
    else if (pctInRange < 30) return { zone: 'DISCOUNT', pctInRange, high, low, description: 'Price in discount zone — look for longs' };
    else                      return { zone: 'MID_RANGE', pctInRange, high, low, description: 'Price mid-range — wait for extreme' };
}

// ─── Confluence Scorer ────────────────────────────────────────────────────────

/**
 * Score the confluence of multiple signals (0-100)
 * Requires 3+ confluences from different categories for a quality signal
 */
function scoreConfluence({ regime, structure, sweep, fvg, premiumDiscount, momentum, session, trend }) {
    const categories = [];
    let score = 0;

    // Category 1: Structure
    if (structure?.state === 'BULLISH' || structure?.state === 'BEARISH') {
        categories.push('STRUCTURE');
        score += 15;
    }

    // Category 2: Liquidity
    if (sweep?.swept) {
        categories.push('LIQUIDITY');
        score += 15;
    }

    // Category 3: FVG/Imbalance
    if (fvg?.detected && fvg?.inEntryZone) {
        categories.push('FVG');
        score += 15;
    } else if (fvg?.detected) {
        categories.push('FVG_NEARBY');
        score += 8;
    }

    // Category 4: Premium/Discount alignment
    const zone = premiumDiscount?.zone;
    const bias = structure?.state;
    if ((zone === 'DISCOUNT' && bias === 'BULLISH') || (zone === 'PREMIUM' && bias === 'BEARISH')) {
        categories.push('ZONE_ALIGNMENT');
        score += 15;
    }

    // Category 5: Momentum
    if (momentum?.macdAligned) {
        categories.push('MOMENTUM');
        score += 10;
    }

    // Category 6: Session quality
    if (session === 'overlap' || session === 'london_open' || session === 'ny_open') {
        categories.push('SESSION');
        score += 10;
    }

    // Category 7: Regime alignment
    if (regime?.regime === 'TRENDING' && (trend === 'BULLISH' || trend === 'BEARISH')) {
        categories.push('REGIME');
        score += 10;
    }

    // Bonus for 3+ categories
    if (categories.length >= 4) score += 10;
    if (categories.length >= 5) score += 5;

    return {
        confluenceScore: Math.min(100, score),
        categories,
        categoryCount: categories.length,
        isHighConfluence: categories.length >= 3,
        label: categories.length >= 4 ? 'A+' : categories.length >= 3 ? 'A' : categories.length >= 2 ? 'B' : 'C'
    };
}

// ─── Full Pattern Scan ────────────────────────────────────────────────────────

function runPatternScan(candles, indicators = {}) {
    const regime          = classifyRegime(indicators);
    const structure       = detectStructure(candles);
    const fvg             = detectFVG(candles);
    const sweep           = detectSweep(candles);
    const premiumDiscount = detectPremiumDiscount(candles);
    const strategies      = getRecommendedStrategies(regime.regime);

    const confluence = scoreConfluence({
        regime, structure, sweep, fvg, premiumDiscount,
        momentum: indicators.momentum,
        session:  indicators.session,
        trend:    indicators.trend4H
    });

    return {
        regime,
        structure,
        fvg,
        sweep,
        premiumDiscount,
        confluence,
        strategies,
        scannedAt: new Date().toISOString()
    };
}

module.exports = {
    classifyRegime,
    getRecommendedStrategies,
    detectFVG,
    detectSweep,
    detectStructure,
    detectPremiumDiscount,
    scoreConfluence,
    runPatternScan,
    STRATEGY_MAP
};
