/**
 * indicator_intelligence.cjs — OpenClaw v5.1 Indicator Intelligence Layer
 *
 * Enriches raw indicator calculations with:
 * - Bollinger squeeze/expansion/stretch states
 * - Stochastic exhaustion + cross states
 * - AO zero-line, flip, momentum shift
 * - ATR volatility regime classification
 * - Confluence summary (timing filter only — NEVER trade approval)
 *
 * HARD RULES:
 * - BB lower band alone ≠ BUY
 * - BB upper band alone ≠ SELL
 * - Stoch oversold alone ≠ BUY
 * - Stoch overbought alone ≠ SELL
 * - AO flip alone ≠ trade
 * - 0.5 ATR SL/TP cannot bypass minimum R:R check
 */
'use strict';

// ── Bollinger Band Enrichment ─────────────────────────────────────────────────

/**
 * Enrich raw Bollinger Bands output with v3.4 intelligence.
 * @param {object} bb - { upper, middle, lower, bandwidth, pctB, sd }
 * @param {number} atr - Current ATR value
 * @returns {object} Enriched BB object
 */
function enrichBollingerBands(bb, atr = 0) {
    if (!bb) return null;

    const pctB = bb.pctB ?? bb.pct_b ?? 0.5;
    const bandwidth = bb.bandwidth || 0;

    // Squeeze: bandwidth < 1.5× ATR = low volatility
    const squeezeThreshold = atr > 0 ? atr * 1.5 : bandwidth * 0.3;
    const squeezeState = bandwidth < squeezeThreshold ? 'SQUEEZE' : 'NORMAL';

    // Expansion: bandwidth > 3× ATR = volatility expansion
    const expansionThreshold = atr > 0 ? atr * 3.0 : bandwidth * 1.5;
    const expansionState = bandwidth > expansionThreshold ? 'EXPANDING' : 'STABLE';

    // Upper stretch: price > upper band
    const upperStretch = pctB > 1.0;
    // Lower stretch: price < lower band
    const lowerStretch = pctB < 0.0;

    // Interpretation (timing context only)
    let interpretation = 'neutral';
    if (pctB <= 0.05)      interpretation = 'at_lower_band';
    else if (pctB <= 0.15) interpretation = 'near_lower_band';
    else if (pctB >= 0.95) interpretation = 'at_upper_band';
    else if (pctB >= 0.85) interpretation = 'near_upper_band';
    else if (pctB > 0.4 && pctB < 0.6) interpretation = 'mid_range';

    // Warning: single BB signal cannot approve trade
    const single_source_warning = 'BB alone cannot generate BUY/SELL — requires structural confluence';

    return {
        ...bb,
        pct_b: parseFloat(pctB.toFixed(4)),
        squeeze_state: squeezeState,
        expansion_state: expansionState,
        upper_stretch: upperStretch,
        lower_stretch: lowerStretch,
        interpretation,
        timing_context: interpretation,
        single_source_warning,
        _enriched: true
    };
}

// ── Stochastic Enrichment ─────────────────────────────────────────────────────

/**
 * Enrich raw Stochastic output with exhaustion + cross states.
 * @param {object} stoch - { k, d, kPrev, dPrev, zone, crossover }
 * @returns {object} Enriched Stochastic object
 */
function enrichStochastic(stoch) {
    if (!stoch) return null;

    const k = stoch.k || 0;
    const d = stoch.d || 0;

    // Cross state (alias for crossover)
    const cross_state = stoch.crossover || 'NONE';

    // Exhaustion: K+D both extreme
    let exhaustion_state = 'NONE';
    if (k > 85 && d > 85) exhaustion_state = 'OVERBOUGHT_EXHAUSTION';
    else if (k < 15 && d < 15) exhaustion_state = 'OVERSOLD_EXHAUSTION';
    else if (k > 80) exhaustion_state = 'OVERBOUGHT';
    else if (k < 20) exhaustion_state = 'OVERSOLD';

    // Divergence rough check (K vs D spread)
    const kd_spread = Math.abs(k - d);
    const divergence_signal = kd_spread > 15 ? 'K_D_DIVERGING' : 'ALIGNED';

    // Warning: single stochastic signal cannot approve trade
    const single_source_warning = 'Stoch oversold/overbought alone cannot generate BUY/SELL';

    return {
        ...stoch,
        cross_state,
        exhaustion_state,
        kd_spread: parseFloat(kd_spread.toFixed(2)),
        divergence_signal,
        single_source_warning,
        _enriched: true
    };
}

// ── Awesome Oscillator Enrichment ─────────────────────────────────────────────

/**
 * Enrich raw AO output with zero-line, flip, momentum shift.
 * @param {object} ao - { value, prev, color, prevColor, flip }
 * @returns {object} Enriched AO object
 */
function enrichAwesomeOscillator(ao) {
    if (!ao) return null;

    const value = ao.value || 0;
    const prev  = ao.prev || 0;

    // Zero-line state
    let zero_line_state = 'ABOVE';
    if (value < 0) zero_line_state = 'BELOW';
    if (Math.abs(value) < 0.01) zero_line_state = 'AT_ZERO';

    // Flip state (bullish/bearish/none)
    const flip_state = ao.flip || 'NONE';

    // Momentum shift: comparing velocity
    const velocity = value - prev;
    let momentum_shift = 'STEADY';
    if (velocity > 0 && prev < 0 && value > 0) momentum_shift = 'BULLISH_CROSS';
    else if (velocity < 0 && prev > 0 && value < 0) momentum_shift = 'BEARISH_CROSS';
    else if (Math.abs(velocity) > Math.abs(value) * 0.5) momentum_shift = 'ACCELERATING';
    else if (Math.abs(velocity) < Math.abs(value) * 0.1) momentum_shift = 'DECELERATING';

    // Warning: AO flip alone cannot approve trade
    const single_source_warning = 'AO flip alone cannot generate BUY/SELL — confirmation required';

    return {
        ...ao,
        zero_line_state,
        flip_state,
        momentum_shift,
        velocity: parseFloat(velocity.toFixed(4)),
        single_source_warning,
        _enriched: true
    };
}

// ── ATR Enrichment ────────────────────────────────────────────────────────────

/**
 * Enrich raw ATR value with volatility regime and guides.
 * @param {number} atr - Raw ATR value
 * @param {number} price - Current price
 * @returns {object} Enriched ATR object
 */
function enrichATR(atr, price = 0) {
    if (!atr || atr <= 0) return null;

    // Volatility regime based on ATR as % of price
    const atrPct = price > 0 ? (atr / price) * 100 : 0;
    let volatility_regime = 'NORMAL';
    if (atrPct < 0.1) volatility_regime = 'VERY_LOW';
    else if (atrPct < 0.3) volatility_regime = 'LOW';
    else if (atrPct < 0.6) volatility_regime = 'NORMAL';
    else if (atrPct < 1.0) volatility_regime = 'HIGH';
    else volatility_regime = 'VERY_HIGH';

    // Guides for position sizing (informational only)
    const guides = {
        micro_scalp: parseFloat((atr * 0.5).toFixed(4)),     // 0.5× = micro SL guide
        normal:      parseFloat((atr * 1.0).toFixed(4)),     // 1.0× = standard SL guide
        volatility:  parseFloat((atr * 1.5).toFixed(4)),     // 1.5× = wide-volatility guide
    };

    // Warning: 0.5 ATR SL cannot bypass minimum R:R
    const rr_guard = '0.5× ATR SL/TP CANNOT bypass minimum R:R of 1.8 — verifier enforces this';

    return {
        value: parseFloat(atr.toFixed(4)),
        atr_pct_of_price: parseFloat(atrPct.toFixed(4)),
        volatility_regime,
        guides,
        rr_guard,
        _enriched: true
    };
}

// ── Confluence Summary ────────────────────────────────────────────────────────

/**
 * Generate timing confluence summary from enriched indicators.
 * NEVER approves BUY/SELL — only provides timing filter context.
 *
 * @param {object} enriched - { bb, stoch, ao, atr }
 * @returns {object} Confluence summary
 */
function generateConfluenceSummary(enriched) {
    const { bb, stoch, ao, atr } = enriched;
    const bullishSignals = [];
    const bearishSignals = [];
    const conflicts = [];
    const warnings = [];

    // BB contribution
    if (bb) {
        if (bb.interpretation === 'at_lower_band' || bb.interpretation === 'near_lower_band') {
            bullishSignals.push('BB: Price at/near lower band (mean-reversion potential)');
        }
        if (bb.interpretation === 'at_upper_band' || bb.interpretation === 'near_upper_band') {
            bearishSignals.push('BB: Price at/near upper band (mean-reversion potential)');
        }
        if (bb.squeeze_state === 'SQUEEZE') {
            warnings.push('BB: Squeeze detected — breakout may be imminent, direction unclear');
        }
        if (bb.expansion_state === 'EXPANDING') {
            warnings.push('BB: Expanding volatility — wider SL required');
        }
        if (bb.upper_stretch) warnings.push('BB: Price stretched above upper band');
        if (bb.lower_stretch) warnings.push('BB: Price stretched below lower band');
    }

    // Stochastic contribution
    if (stoch) {
        if (stoch.exhaustion_state === 'OVERSOLD_EXHAUSTION' || stoch.zone === 'oversold') {
            bullishSignals.push(`Stoch: ${stoch.exhaustion_state || 'oversold'} (K=${stoch.k})`);
        }
        if (stoch.exhaustion_state === 'OVERBOUGHT_EXHAUSTION' || stoch.zone === 'overbought') {
            bearishSignals.push(`Stoch: ${stoch.exhaustion_state || 'overbought'} (K=${stoch.k})`);
        }
        if (stoch.cross_state === 'bullish') bullishSignals.push('Stoch: Bullish K/D cross');
        if (stoch.cross_state === 'bearish') bearishSignals.push('Stoch: Bearish K/D cross');
        if (stoch.divergence_signal === 'K_D_DIVERGING') {
            warnings.push(`Stoch: K/D diverging (spread=${stoch.kd_spread}) — uncertainty`);
        }
    }

    // AO contribution
    if (ao) {
        if (ao.flip_state === 'bullish' || ao.momentum_shift === 'BULLISH_CROSS') {
            bullishSignals.push(`AO: ${ao.flip_state === 'bullish' ? 'Red→Green flip' : 'Bullish zero-line cross'}`);
        }
        if (ao.flip_state === 'bearish' || ao.momentum_shift === 'BEARISH_CROSS') {
            bearishSignals.push(`AO: ${ao.flip_state === 'bearish' ? 'Green→Red flip' : 'Bearish zero-line cross'}`);
        }
        if (ao.zero_line_state === 'ABOVE' && ao.color === 'green') {
            bullishSignals.push('AO: Above zero + green momentum');
        }
        if (ao.zero_line_state === 'BELOW' && ao.color === 'red') {
            bearishSignals.push('AO: Below zero + red momentum');
        }
    }

    // ATR contribution
    if (atr) {
        if (atr.volatility_regime === 'VERY_LOW') warnings.push('ATR: Very low volatility — poor scalp conditions');
        if (atr.volatility_regime === 'VERY_HIGH') warnings.push('ATR: Very high volatility — wider SL required');
    }

    // Conflict detection
    if (bullishSignals.length > 0 && bearishSignals.length > 0) {
        conflicts.push(`Mixed signals: ${bullishSignals.length} bullish vs ${bearishSignals.length} bearish — unclear market bias`);
    }

    // Determine timing confirmation
    const totalBull = bullishSignals.length;
    const totalBear = bearishSignals.length;

    let timing_confirmation = 'NEUTRAL_NO_EDGE';
    if (totalBull >= 3 && totalBear === 0) timing_confirmation = 'BULLISH_TIMING_CONFIRMED';
    else if (totalBull >= 2 && totalBear === 0) timing_confirmation = 'BULLISH_TIMING_PARTIAL';
    else if (totalBear >= 3 && totalBull === 0) timing_confirmation = 'BEARISH_TIMING_CONFIRMED';
    else if (totalBear >= 2 && totalBull === 0) timing_confirmation = 'BEARISH_TIMING_PARTIAL';
    else if (conflicts.length > 0) timing_confirmation = 'CONFLICT_WARNING';

    return {
        timing_confirmation,
        bullish_signals: bullishSignals,
        bearish_signals: bearishSignals,
        conflicts,
        warnings,
        total_bullish: totalBull,
        total_bearish: totalBear,
        // CRITICAL: These are timing filters only
        _trade_approval: false,
        _approval_note: 'Confluence summary is timing context only. BUY/SELL requires signal_verifier approval.',
        _enriched: true
    };
}

/**
 * Full enrichment pipeline — enriches all indicators and generates confluence.
 */
function enrichAllIndicators(raw, price = 0) {
    const bb    = raw.bollinger  ? enrichBollingerBands(raw.bollinger, raw.atr?.value || raw.atr || 0) : null;
    const stoch = raw.stochastic ? enrichStochastic(raw.stochastic) : null;
    const ao    = raw.awesome_oscillator ? enrichAwesomeOscillator(raw.awesome_oscillator) : null;
    const atr   = raw.atr ? (typeof raw.atr === 'number' ? enrichATR(raw.atr, price) : enrichATR(raw.atr.value, price)) : null;

    const confluence = generateConfluenceSummary({ bb, stoch, ao, atr });

    return {
        bollinger: bb,
        stochastic: stoch,
        awesome_oscillator: ao,
        atr,
        rsi: raw.rsi || null,
        macd: raw.macd || null,
        adx: raw.adx || null,
        ema20: raw.ema20 || null,
        ema50: raw.ema50 || null,
        vwap: raw.vwap || null,
        confluence,
        _version: '3.4',
        _enriched: true
    };
}

module.exports = {
    enrichBollingerBands,
    enrichStochastic,
    enrichAwesomeOscillator,
    enrichATR,
    generateConfluenceSummary,
    enrichAllIndicators
};
