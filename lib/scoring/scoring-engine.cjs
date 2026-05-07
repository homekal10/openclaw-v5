/**
 * scoring-engine.cjs — OpenClaw Institutional Scoring Engine v4.0
 * 8-layer weighted model. Score controls behavior, not just display.
 * Score alone is NOT enough — veto-engine.cjs applies hard blockers after.
 *
 * Weights (total 100):
 *   Trend:     20  (4H + 1H EMA alignment)
 *   Liquidity: 20  (sweep of equal level or session extreme)
 *   FVG:       20  (valid fair value gap in entry zone)
 *   Momentum:  10  (MACD slope, RSI zone, ATR expansion, ADX)
 *   Session:   10  (London/NY/overlap vs off-hours)
 *   Macro:     10  (no event risk + confirming regime)
 *   Risk:      10  (RR >= 1.8 + valid stop + clear invalidation)
 *
 * Thresholds:
 *   85-100 → HIGH QUALITY candidate (still must pass veto)
 *   75-84  → CANDIDATE (still must pass veto)
 *   60-74  → WAIT
 *   0-59   → REJECTED
 *
 * CRITICAL: Score is not decorative. It controls BUY/SELL/WAIT/REJECTED action.
 */

'use strict';

// ─── Category Scorers ──────────────────────────────────────────────────────────

/**
 * Trend score (max 20)
 * Requires 4H alignment. 1H confirmation adds bonus.
 */
function scoreTrend({ trend4H, trend1H }) {
    const t4 = (trend4H || '').toUpperCase();
    const t1 = (trend1H || '').toUpperCase();

    // Both neutral = minimal
    if (t4 === 'NEUTRAL' || t4 === 'RANGE') return 2;

    // Strong directional 4H
    let score = 12;

    // 1H confirms 4H direction
    if (t1 === t4) score += 8;
    // 1H is neutral (acceptable pullback)
    else if (t1 === 'NEUTRAL' || t1 === 'RANGE') score += 4;
    // 1H conflicts with 4H — significant reduction
    else score -= 6;

    return Math.max(0, Math.min(20, score));
}

/**
 * Liquidity score (max 20)
 * Full credit for fresh sweep, partial for no-sweep trend setups.
 */
function scoreLiquidity({ sweepDetected, sweepType, sweepFreshness, setupType }) {
    const setup = (setupType || '').toLowerCase();
    if (!sweepDetected) {
        // Trend-following setups get partial liquidity credit — they don't need a sweep
        if (['momentum_trend', 'ny_continuation', 'ema_pullback_fvg', 'trend_breakout_retest'].includes(setup)) {
            return 6; // Partial — no sweep but trend is the liquidity edge
        }
        return 0;
    }
    const type  = (sweepType || '').toLowerCase();
    const fresh = sweepFreshness || 'old';
    let score = 0;
    if (type === 'asia_high'      || type === 'asia_low')       score = 20;
    else if (type === 'prev_day_high' || type === 'prev_day_low') score = 18;
    else if (type === 'equal_high'   || type === 'equal_low')   score = 16;
    else if (type === 'prev_week')                              score = 14;
    else                                                         score = 10;
    if (fresh === 'recent') score = Math.max(0, score - 3);
    else if (fresh !== 'fresh') score = Math.max(0, score - 5);
    return Math.max(0, Math.min(20, score));
}

/**
 * FVG score (max 20)
 * Full credit when FVG in entry zone, partial when detected but not in zone.
 */
function scoreFVG({ fvgDetected, fvgType, fvgInEntryZone, fvgReclaimed, setupType }) {
    // If no FVG at all, non-FVG setups get partial credit (trend alignment)
    if (!fvgDetected || fvgReclaimed) {
        const setup = (setupType || '').toLowerCase();
        if (['momentum_trend', 'ny_continuation', 'trend_breakout_retest'].includes(setup)) {
            return 5; // Partial credit — trend setup doesn't require FVG
        }
        return 0;
    }
    let score = 0;
    if (fvgInEntryZone) score = 17;
    else score = 9;  // FVG nearby but not in zone — still useful
    const type = (fvgType || '').toLowerCase();
    if (type === 'bullish' || type === 'bearish') score = Math.min(20, score + 3);
    return Math.max(0, Math.min(20, score));
}

/**
 * Momentum score (max 10)
 * MACD slope + RSI zone + ATR expansion + ADX when relevant
 */
function scoreMomentum({ macdAligned, macdStrong, rsiZone, atrExpanding, divergence, adxValue }) {
    let score = 0;
    if (macdAligned && macdStrong) score += 4;
    else if (macdAligned) score += 2;
    const zone = (rsiZone || '').toLowerCase();
    if (zone === 'bullish_zone' || zone === 'bearish_zone') score += 2;
    else if (zone === 'neutral') score += 1;
    if (atrExpanding) score += 2;
    // ADX adds when trending
    if (adxValue != null && adxValue >= 25) score += 2;
    else if (adxValue != null && adxValue >= 20) score += 1;
    // Divergence penalty
    if (divergence === 'BEARISH_DIVERGENCE' || divergence === 'BULLISH_DIVERGENCE') score -= 4;
    return Math.max(0, Math.min(10, score));
}

/**
 * Session score (max 10)
 */
function scoreSession({ session }) {
    const s = (session || '').toLowerCase();
    if (s === 'overlap') return 10;
    if (s === 'london_open' || s === 'ny_open') return 9;
    if (s === 'london' || s === 'ny') return 7;
    if (s === 'asian_london_transition') return 4;
    if (s === 'asian') return 3;
    if (s === 'off_hours') return 0;
    return 4;
}

/**
 * Macro score (max 10)
 */
function scoreMacro({ eventRiskLevel, regimeAligned, macroConflict }) {
    const risk = (eventRiskLevel || 'none').toLowerCase();
    if (risk === 'high') return 0;
    if (risk === 'medium') {
        let score = 4;
        if (regimeAligned) score += 2;
        if (!macroConflict) score += 1;
        return Math.min(10, score);
    }
    let score = 7;
    if (regimeAligned) score += 2;
    if (!macroConflict) score += 1;
    return Math.min(10, score);
}

/**
 * Risk score (max 10)
 */
function scoreRisk({ rrValue, stopValid, invalidationClear, spreadAcceptable }) {
    let score = 0;
    if (rrValue >= 3.0) score += 5;
    else if (rrValue >= 2.5) score += 4;
    else if (rrValue >= 2.0) score += 3;
    else if (rrValue >= 1.8) score += 2;
    else score += 0;  // Below 1.8 — veto will catch this, but score reflects it
    if (stopValid && invalidationClear) score += 3;
    else if (stopValid) score += 1;
    if (spreadAcceptable) score += 2;
    return Math.max(0, Math.min(10, score));
}

// ─── Main Scoring Function ─────────────────────────────────────────────────────

function computeScore(params) {
    const trend     = scoreTrend(params);
    const liquidity = scoreLiquidity(params);
    const fvg       = scoreFVG(params);
    const momentum  = scoreMomentum(params);
    const session   = scoreSession(params);
    const macro     = scoreMacro(params);
    const risk      = scoreRisk(params);

    const total = trend + liquidity + fvg + momentum + session + macro + risk;

    let label, suggestedAction;
    if (total >= 85) {
        label = 'HIGH_QUALITY';
        suggestedAction = 'CANDIDATE';
    } else if (total >= 75) {
        label = 'CANDIDATE';
        suggestedAction = 'CANDIDATE';
    } else if (total >= 60) {
        label = 'WAIT';
        suggestedAction = 'WAIT';
    } else {
        label = 'REJECTED';
        suggestedAction = 'REJECTED';
    }

    return {
        total: Math.min(100, Math.round(total)),
        breakdown: { trend, liquidity, fvg, momentum, session, macro, risk },
        maxWeights: { trend: 20, liquidity: 20, fvg: 20, momentum: 10, session: 10, macro: 10, risk: 10 },
        label,
        suggestedAction,
        scoredAt: new Date().toISOString()
    };
}

function formatScoreBreakdown(b) {
    return (
        `Trd:${b.trend}/20 Liq:${b.liquidity}/20 FVG:${b.fvg}/20 ` +
        `Mom:${b.momentum}/10 Sess:${b.session}/10 Mac:${b.macro}/10 Rsk:${b.risk}/10`
    );
}

module.exports = {
    computeScore,
    scoreTrend, scoreLiquidity, scoreFVG,
    scoreMomentum, scoreSession, scoreMacro, scoreRisk,
    formatScoreBreakdown
};
