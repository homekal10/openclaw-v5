/**
 * veto-engine.cjs — OpenClaw Hard Veto Rules v2.5
 *
 * CALIBRATION FIX (2026-04-25):
 * - Vetoes 3, 4, 5, 12 are now SETUP-SPECIFIC — they only fire when the
 *   active setup REQUIRES those conditions. This prevents 100% rejection
 *   rates in trending markets where ICT structures haven't formed yet.
 * - momentum_trend setup bypasses sweep/FVG/structure vetoes.
 * - Hard vetoes for chase entry, event risk, spread, and R:R remain absolute.
 */

'use strict';

/**
 * applyVetoes(context) → { passed: bool, vetoes: string[], warnings: string[] }
 */
function applyVetoes(context) {
    const vetoes   = [];
    const warnings = [];

    const {
        adxValue, setupType, structureState, sweepDetected,
        fvgDetected, fvgInEntryZone, fvgReclaimed, isChaseEntry,
        invalidationLevel, pricePosition, trend4H, trend1H,
        momentumConflict, divergence,
        eventRiskLevel, macroConflict, tradeRestriction,
        sentimentOnlySignal, headlineRelevanceScore,
        rrValue, stopValid, spreadAcceptable,
        session,
        total: scoreTotal
    } = context;

    // Normalise setup type
    const setup = (setupType || '').toLowerCase().replace(/\s+/g, '_');

    // ── Hard Veto 1: No valid setup type ────────────────────────────────────────
    const APPROVED_SETUPS = [
        'london_sweep_reversal',
        'ny_continuation',
        'ema_pullback_fvg',
        'range_sweep_trap',
        'trend_breakout_retest',
        'momentum_trend'           // NEW: fallback for clear trending markets
    ];
    if (!setup || !APPROVED_SETUPS.includes(setup)) {
        vetoes.push('NO_VALID_SETUP_TYPE: No approved setup pattern — market is ranging without edge');
    }

    // ── Hard Veto 2: Weak ADX for trend-following setups only ───────────────────
    const trendSetups = ['ny_continuation', 'ema_pullback_fvg', 'trend_breakout_retest', 'momentum_trend'];
    const isTrendSetup = setup && trendSetups.includes(setup);
    if (isTrendSetup && adxValue != null && adxValue < 15) {
        vetoes.push(`WEAK_ADX: ADX ${adxValue} < 15 — insufficient directional momentum for trend setup`);
    }

    // ── Hard Veto 3: Structure — only block for ICT structure setups ────────────
    const structureDependentSetups = ['london_sweep_reversal', 'ny_continuation', 'ema_pullback_fvg', 'trend_breakout_retest'];
    if (structureDependentSetups.includes(setup)) {
        const badStructure = ['MIXED', 'UNCLEAR', 'NONE'];
        if (!structureState || badStructure.includes((structureState || '').toUpperCase())) {
            warnings.push(`WEAK_STRUCTURE: Structure is ${structureState ?? 'unknown'} — prefer HH/HL or LH/LL confirmation`);
            // Warning only — not a hard veto, let score penalize instead
        }
    }

    // ── Hard Veto 4: Liquidity event — only for sweep-based setups ──────────────
    const sweepSetups = ['london_sweep_reversal', 'range_sweep_trap'];
    if (sweepSetups.includes(setup) && !sweepDetected) {
        vetoes.push('NO_LIQUIDITY_EVENT: Sweep/reversal setup requires a confirmed liquidity event');
    }

    // ── Hard Veto 5: FVG — only for FVG-specific setups ────────────────────────
    if (setup === 'ema_pullback_fvg') {
        if (!fvgDetected || !fvgInEntryZone || fvgReclaimed) {
            const reason = !fvgDetected ? 'no FVG detected'
                : !fvgInEntryZone ? 'FVG not in entry zone'
                : 'FVG already reclaimed';
            vetoes.push(`NO_FVG: EMA Pullback + FVG setup requires valid FVG — ${reason}`);
        }
    }

    // ── Hard Veto 6: Chase entry (universal — never buy tops/sell bottoms) ───────
    if (isChaseEntry) {
        vetoes.push('CHASE_ENTRY: RSI extreme at trend extremity — wait for pullback/retest');
    }

    // ── Hard Veto 7: Weak invalidation ──────────────────────────────────────────
    if (!invalidationLevel || String(invalidationLevel).toLowerCase() === 'undefined') {
        vetoes.push('WEAK_INVALIDATION: No calculable invalidation level — structural stop required');
    }

    // ── Hard Veto 8: R:R below minimum ──────────────────────────────────────────
    if (rrValue != null && rrValue < 1.5) {
        vetoes.push(`RR_TOO_LOW: R:R is ${rrValue} — minimum 1.5 required`);
    }

    // ── Hard Veto 9: Material momentum conflict (MACD vs price action) ──────────
    if (momentumConflict === 'STRONG' && (divergence === 'BEARISH_DIVERGENCE' || divergence === 'BULLISH_DIVERGENCE')) {
        // Only veto when BOTH MACD conflict AND price/RSI divergence confirm the conflict
        vetoes.push('MOMENTUM_CONFLICT: MACD + RSI divergence both oppose trade direction');
    }

    // ── Hard Veto 10: High macro event risk ─────────────────────────────────────
    if ((eventRiskLevel || '').toUpperCase() === 'HIGH') {
        vetoes.push('HIGH_EVENT_RISK: Major macro event within 6h — avoid new entries');
    }

    // ── Hard Veto 11: Abnormal spread ───────────────────────────────────────────
    if (spreadAcceptable === false) {
        vetoes.push('ABNORMAL_SPREAD: Spread too wide for reliable entry/stop');
    }

    // ── Hard Veto 12: Price mid-range ONLY in a RANGE market ────────────────────
    // (Not a veto for momentum trends — mid-range in a BULLISH trend is fine)
    if ((pricePosition || '').toUpperCase() === 'MID_RANGE' &&
        (trend4H || '').toUpperCase() === 'RANGE') {
        vetoes.push('MID_RANGE_IN_RANGE: Price mid-range in ranging 4H — wait for premium/discount extremes');
    }

    // ── Hard Veto 13: Sentiment-only signal ─────────────────────────────────────
    if (sentimentOnlySignal) {
        vetoes.push('SENTIMENT_ONLY: Signal based purely on sentiment without technical structure');
    }

    // ── Hard Veto 14: External trade restriction from macro agent ────────────────
    if (tradeRestriction) {
        vetoes.push('TRADE_RESTRICTED: Macro agent issued trade restriction for this asset');
    }

    // ── Warnings (non-blocking) ──────────────────────────────────────────────────
    if ((session || '').toLowerCase() === 'off_hours' || (session || '').toLowerCase() === 'asian') {
        warnings.push('POOR_SESSION: Off-hours/Asian — low liquidity, monitor only');
    }
    if (!sweepDetected && !['london_sweep_reversal', 'range_sweep_trap'].includes(setup)) {
        warnings.push('NO_SWEEP: No liquidity sweep detected — reduces setup quality');
    }
    if (!fvgDetected) {
        warnings.push('NO_FVG: No Fair Value Gap detected — reduces precision entry');
    }

    return {
        passed:    vetoes.length === 0,
        vetoes,
        warnings,
        vetoCount: vetoes.length
    };
}

/**
 * resolveAction(scoreResult, vetoResult, options) → final action
 */
function resolveAction(scoreResult, vetoResult, { setupConfirmed, triggerActive } = {}) {
    if (!vetoResult.passed) {
        const softVetoOnly = vetoResult.vetoes.every(v =>
            v.startsWith('MID_RANGE') ||
            v.startsWith('POOR_SESSION') ||
            v.startsWith('LOW_HEADLINE') ||
            v.startsWith('NO_SWEEP') ||
            v.startsWith('NO_FVG')
        );
        return softVetoOnly ? 'WAIT' : 'REJECTED';
    }
    if (scoreResult.total < 60) return 'REJECTED';
    if (scoreResult.total < 75) return 'WAIT';
    if (!setupConfirmed) return 'WAIT';
    if (!triggerActive)  return 'WATCHLIST';
    return 'CANDIDATE';
}

module.exports = { applyVetoes, resolveAction };
