/**
 * setup-classifier.cjs — OpenClaw Setup Type Classifier
 *
 * Every BUY/SELL must map to one of 5 approved setup families.
 * If it doesn't clearly match → return null (no trade allowed).
 *
 * The 5 Approved Setup Families:
 * 1. london_sweep_reversal  — Sweep of Asia high/low in London open, FVG entry
 * 2. ny_continuation        — Trend confirmed in London, continuation in NY open
 * 3. ema_pullback_fvg       — Price pulls to EMA zone with FVG, trend intact
 * 4. range_sweep_trap       — Equal highs/lows swept, reversal from value zone
 * 5. trend_breakout_retest  — BOS confirmed, retest of broken structure level
 */

'use strict';

const SETUP_DEFINITIONS = {
    london_sweep_reversal: {
        label:       'London Sweep Reversal',
        description: 'Sweep of Asia high/low in London open with FVG entry',
        requiredConditions: [
            'session is london_open or early_london',
            'sweep of asia_high or asia_low detected',
            'fvg exists in entry zone after sweep',
            'momentum reversing'
        ]
    },
    ny_continuation: {
        label:       'NY Continuation',
        description: 'London confirmed trend, NY open continues in same direction',
        requiredConditions: [
            'trend confirmed in London session',
            'session is ny_open or early_ny',
            'price pulled back to EMA or FVG zone',
            'structure intact (no CHOCH against trade)'
        ]
    },
    ema_pullback_fvg: {
        label:       'EMA Pullback + FVG',
        description: 'Trend intact, price retraces to EMA zone with FVG present',
        requiredConditions: [
            '4H trend clear (not neutral)',
            'price at or near EMA20/50',
            'fvg present in EMA zone',
            'no structure break against trade'
        ]
    },
    range_sweep_trap: {
        label:       'Range Sweep Trap',
        description: 'Equal highs or lows swept, price reverses from liquidity grab',
        requiredConditions: [
            'equal highs or equal lows identified',
            'sweep beyond equal level detected',
            'quick reversal candle(s) after sweep',
            'fvg or imbalance left by reversal move'
        ]
    },
    trend_breakout_retest: {
        label:       'Trend Breakout Retest',
        description: 'BOS confirmed on structure, retest of broken level as new support/resistance',
        requiredConditions: [
            'BOS (break of structure) confirmed on 4H or 1H',
            'price retested the broken level',
            'no CHOCH invalidating the BOS',
            'ADX >= 20 showing trend strength'
        ]
    }
};

/**
 * classifySetup(context) → { setupType, label, confidence, reasons, failedSetups }
 *
 * Attempts to identify the best matching setup from context signals.
 * Returns null setupType if no clear match found.
 */
function classifySetup(context) {
    const {
        session,
        sweepDetected, sweepType,
        fvgDetected, fvgInEntryZone,
        structureState, bosDetected, chochDetected,
        trend4H, trend1H,
        priceNearEMA, emaZone,
        adxValue,
        momentumReversing, momentumContinuing,
        equalHighDetected, equalLowDetected
    } = context;

    const results = [];
    const s = (session || '').toLowerCase();
    const t4 = (trend4H || '').toUpperCase();

    // ── Test 1: London Sweep Reversal ─────────────────────────────────────────
    {
        const conditions = {
            londonSession:  s.includes('london'),
            asiaSwept:      sweepDetected && (sweepType || '').includes('asia'),
            fvgPresent:     fvgDetected && fvgInEntryZone,
            reversing:      momentumReversing === true
        };
        const met = Object.values(conditions).filter(Boolean).length;
        if (met >= 3) {
            results.push({
                setupType:  'london_sweep_reversal',
                score:      met,
                maxScore:   4,
                conditions,
                confidence: met === 4 ? 'FULL' : 'PARTIAL'
            });
        }
    }

    // ── Test 2: NY Continuation ───────────────────────────────────────────────
    {
        const conditions = {
            nySession:      s.includes('ny'),
            trendCleared:   t4 === 'BULLISH' || t4 === 'BEARISH',
            fvgOrEMA:       fvgDetected || priceNearEMA,
            structureOk:    !chochDetected && (structureState || '').toUpperCase() !== 'MIXED',
            continuing:     momentumContinuing === true
        };
        const met = Object.values(conditions).filter(Boolean).length;
        if (met >= 3) {
            results.push({
                setupType:  'ny_continuation',
                score:      met,
                maxScore:   5,
                conditions,
                confidence: met >= 4 ? 'FULL' : 'PARTIAL'
            });
        }
    }

    // ── Test 3: EMA Pullback + FVG ────────────────────────────────────────────
    {
        const conditions = {
            clearTrend4H:   t4 === 'BULLISH' || t4 === 'BEARISH',
            nearEMA:        priceNearEMA === true,
            fvgInZone:      fvgDetected && fvgInEntryZone,
            noChoch:        !chochDetected,
            structureValid: ['HH_HL', 'LH_LL', 'BULLISH', 'BEARISH'].some(
                s2 => (structureState || '').toUpperCase().includes(s2.replace('_', ''))
                    || (structureState || '').toUpperCase() === s2
            )
        };
        const met = Object.values(conditions).filter(Boolean).length;
        if (met >= 3) {
            results.push({
                setupType:  'ema_pullback_fvg',
                score:      met,
                maxScore:   5,
                conditions,
                confidence: met >= 4 ? 'FULL' : 'PARTIAL'
            });
        }
    }

    // ── Test 4: Range Sweep Trap ───────────────────────────────────────────────
    {
        const hasEqualLevel = equalHighDetected || equalLowDetected;
        const conditions = {
            equalLevelExists: hasEqualLevel,
            sweptBeyond:      sweepDetected && hasEqualLevel,
            fvgAfterSweep:    fvgDetected,
            momentumFlip:     momentumReversing === true
        };
        const met = Object.values(conditions).filter(Boolean).length;
        if (met >= 3) {
            results.push({
                setupType:  'range_sweep_trap',
                score:      met,
                maxScore:   4,
                conditions,
                confidence: met === 4 ? 'FULL' : 'PARTIAL'
            });
        }
    }

    // ── Test 5: Trend Breakout Retest ─────────────────────────────────────────
    {
        const conditions = {
            bosConfirmed:    bosDetected === true,
            noChoch:         !chochDetected,
            strongADX:       adxValue != null && adxValue >= 20,
            retest:          sweepDetected || priceNearEMA, // proxy for retest
            trendValid:      t4 === 'BULLISH' || t4 === 'BEARISH'
        };
        const met = Object.values(conditions).filter(Boolean).length;
        if (met >= 3) {
            results.push({
                setupType:  'trend_breakout_retest',
                score:      met,
                maxScore:   5,
                conditions,
                confidence: met >= 4 ? 'FULL' : 'PARTIAL'
            });
        }
    }

    // ── Select best match ─────────────────────────────────────────────────────
    if (results.length === 0) {
        return {
            setupType:    null,
            label:        'None',
            confidence:   'NONE',
            reasons:      ['No approved setup pattern matched'],
            failedSetups: Object.keys(SETUP_DEFINITIONS)
        };
    }

    // Sort by normalized score (met/maxScore)
    results.sort((a, b) => (b.score / b.maxScore) - (a.score / a.maxScore));
    const best = results[0];

    return {
        setupType:    best.setupType,
        label:        SETUP_DEFINITIONS[best.setupType]?.label || best.setupType,
        confidence:   best.confidence,
        matchScore:   `${best.score}/${best.maxScore}`,
        conditions:   best.conditions,
        reasons:      [`Matched ${best.score}/${best.maxScore} conditions for ${best.setupType}`],
        allMatches:   results.map(r => r.setupType),
        failedSetups: Object.keys(SETUP_DEFINITIONS).filter(k => !results.find(r => r.setupType === k))
    };
}

/**
 * getSetupDescription(setupType) → string
 */
function getSetupDescription(setupType) {
    return SETUP_DEFINITIONS[setupType]?.description || 'Unknown setup';
}

/**
 * isApprovedSetup(setupType) → boolean
 */
function isApprovedSetup(setupType) {
    return !!SETUP_DEFINITIONS[(setupType || '').toLowerCase().replace(/\s+/g, '_')];
}

module.exports = { classifySetup, getSetupDescription, isApprovedSetup, SETUP_DEFINITIONS };
