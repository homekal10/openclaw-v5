'use strict';
/**
 * strategy_router.cjs — Indicator-Based Timing Filter Engine v1.0
 *
 * ARCHITECTURE:
 *   Trend + Structure + Liquidity + FVG = trade idea (existing scoring engine)
 *   BB + Stochastic + AO = timing confirmation filters (THIS FILE)
 *   ATR = risk placement guide (THIS FILE)
 *   Verifier = final gate (existing verifier)
 *
 * RULES:
 *   - Indicators are TIMING FILTERS ONLY — they add bonus scoring (0–15 pts max)
 *   - Indicators CANNOT generate BUY/SELL alone
 *   - They NEVER unlock a WAIT → LONG/SHORT
 *   - ATR R:R < 1.8 → AUTO-VETO (hard block, not a warning)
 */

// ── Timing bonus: max 15 pts across all checks ─────────────────────────────
const MAX_INDICATOR_BONUS = 15;
const MIN_RR = 1.8; // ATR R:R auto-veto threshold

// ── Strategy definitions with timing rules + session/regime requirements ──
const STRATEGIES = {
    london_sweep_reversal: {
        name: 'London Sweep Reversal',
        requires: ['liquidity_sweep'],
        sessions: ['london_open', 'london'],
        regimes: null, // any regime
        invalidation: ['no_sweep_detected', 'price_already_reclaimed'],
        avoid_when: ['asian_session', 'off_hours', 'no_liquidity'],
        timing: {
            bb_stretch: { weight: 4, desc: 'BB stretched beyond upper/lower' },
            stoch_exhaustion: { weight: 4, desc: 'Stoch K in oversold (<20) or overbought (>80)' },
            ao_flip: { weight: 5, desc: 'AO red→green or green→red flip after sweep' },
            atr_beyond_sweep: { weight: 2, desc: 'ATR stop placed beyond sweep candle' }
        }
    },
    ny_continuation: {
        name: 'NY Continuation',
        requires: ['trend'],
        sessions: ['ny_open', 'ny_london_overlap', 'ny'],
        regimes: ['BULLISH', 'BEARISH'],
        invalidation: ['range_market', 'adx_below_15'],
        avoid_when: ['asian_session', 'off_hours', 'stoch_overextended_chase'],
        timing: {
            ao_aligned: { weight: 5, desc: 'AO histogram aligned with trend direction' },
            stoch_not_overextended: { weight: 4, desc: 'Stoch K not chasing (30–70 zone entering)' },
            bb_midline_hold: { weight: 4, desc: 'Price holding above/below BB midline' },
            no_stoch_chase: { weight: 2, desc: 'K not at extreme against trend' }
        }
    },
    ema_pullback_fvg: {
        name: 'EMA Pullback + FVG',
        requires: ['trend', 'value_zone'],
        sessions: ['london', 'ny', 'ny_london_overlap'],
        regimes: ['BULLISH', 'BEARISH'],
        invalidation: ['no_fvg', 'price_past_value_zone'],
        avoid_when: ['range_market', 'off_hours'],
        timing: {
            stoch_reset: { weight: 5, desc: 'Stoch pulled back to neutral (40–60)' },
            ao_momentum_resume: { weight: 5, desc: 'AO turning back toward trend color' },
            bb_midline_support: { weight: 3, desc: 'BB midline acts as support/resistance' },
            atr_stop_fvg: { weight: 2, desc: 'ATR stop placed beyond FVG/structure' }
        }
    },
    range_sweep_trap: {
        name: 'Range Sweep Trap',
        requires: ['range', 'sweep'],
        sessions: ['london', 'ny', 'ny_london_overlap'],
        regimes: ['RANGE'],
        invalidation: ['breakout_confirmed', 'no_range_detected'],
        avoid_when: ['strong_trend', 'off_hours'],
        timing: {
            bb_stretch: { weight: 4, desc: 'BB stretched at range extreme' },
            stoch_extreme: { weight: 4, desc: 'Stoch K at extreme zone (>80 or <20)' },
            ao_flip: { weight: 5, desc: 'AO flip back after sweep' },
            midline_target: { weight: 2, desc: 'Target BB midline / opposite liquidity' }
        }
    },
    trend_breakout_retest: {
        name: 'Trend Breakout Retest',
        requires: ['structure_break', 'retest'],
        sessions: ['london', 'ny', 'ny_london_overlap'],
        regimes: ['BULLISH', 'BEARISH'],
        invalidation: ['no_structure_break', 'retest_failed'],
        avoid_when: ['range_market', 'off_hours', 'asian_session'],
        timing: {
            bb_expansion: { weight: 5, desc: 'BB expanding after consolidation break' },
            ao_confirmation: { weight: 5, desc: 'AO moving in breakout direction' },
            atr_expansion: { weight: 3, desc: 'ATR expanding (increasing volatility)' },
            stoch_pullback: { weight: 2, desc: 'Stoch pulling back on retest (not at extreme)' }
        }
    },
    asian_range_break: {
        name: 'Asian Range Break',
        requires: ['asia_range'],
        sessions: ['london_open'],
        regimes: null,
        invalidation: ['no_asia_range', 'false_break'],
        avoid_when: ['ny_session', 'off_hours'],
        timing: {
            ao_confirm: { weight: 6, desc: 'AO confirms break direction (not false break)' },
            atr_confirm: { weight: 5, desc: 'ATR expanding (not compression false break)' },
            stoch_aligned: { weight: 4, desc: 'Stoch aligned with break direction' }
        }
    },
    liquidity_grab_reversal: {
        name: 'Liquidity Grab Reversal',
        requires: ['sweep', 'reclaim_or_fvg'],
        sessions: ['london', 'ny', 'ny_london_overlap'],
        regimes: null,
        invalidation: ['no_sweep', 'no_reclaim'],
        avoid_when: ['off_hours', 'asian_session'],
        timing: {
            stoch_exhaustion: { weight: 5, desc: 'Stoch at extreme (>80 or <20) before reversal' },
            ao_flip: { weight: 6, desc: 'AO flip toward reversal direction' },
            bb_stretch: { weight: 4, desc: 'BB stretched at grab extreme' }
        }
    }
};

/**
 * getTimingConfirmation(indicators, strategyKey, setupContext)
 *
 * Returns:
 *   {
 *     strategy: string,
 *     bonus: number (0–15),
 *     checks: [{ name, passed, weight, desc }],
 *     timing_label: 'CONFIRMED' | 'PARTIAL' | 'UNCONFIRMED',
 *     atr_veto: boolean,
 *     atr_veto_reason: string | null,
 *     meta: { bb, stoch, ao, atr }
 *   }
 */
function getTimingConfirmation(indicators, strategyKey, setupContext = {}) {
    const strategy = STRATEGIES[strategyKey];
    if (!strategy) {
        return { strategy: strategyKey, bonus: 0, checks: [], timing_label: 'UNKNOWN', atr_veto: false, meta: {} };
    }

    const bb   = indicators.bollinger        || {};
    const st   = indicators.stochastic       || {};
    const ao   = indicators.awesome_oscillator || {};
    const atr  = typeof indicators.atr === 'number' ? indicators.atr : null;
    const meta = { bb, stoch: st, ao, atr };

    // ── ATR R:R auto-veto check ───────────────────────────────────────────────
    // Priority: R:R veto is primary. Stop-size veto only fires when no target (can't compute R:R).
    let atr_veto = false;
    let atr_veto_reason = null;
    if (atr !== null && setupContext.entry && setupContext.stop) {
        const riskPips   = Math.abs(setupContext.entry - setupContext.stop);
        const rewardPips = setupContext.target ? Math.abs(setupContext.target - setupContext.entry) : null;
        if (rewardPips !== null) {
            // R:R check — this is the definitive test when a target is given
            const rr = rewardPips / riskPips;
            if (rr < MIN_RR) {
                atr_veto = true;
                atr_veto_reason = `ATR R:R = ${rr.toFixed(2)} < minimum ${MIN_RR} → AUTO-VETO`;
            }
            // If R:R is good, do NOT apply stop-size veto (target already validates reward is sufficient)
        } else {
            // No target provided — can only check stop tightness
            if (riskPips < atr * 0.5) {
                atr_veto = true;
                atr_veto_reason = `Stop ${riskPips.toFixed(5)} < 0.5× ATR ${(atr * 0.5).toFixed(5)} → AUTO-VETO`;
            }
        }
    }

    // ── Per-strategy timing checks ────────────────────────────────────────────
    const checks = [];
    let rawBonus = 0;

    for (const [checkKey, rule] of Object.entries(strategy.timing)) {
        let passed = false;

        switch (checkKey) {
            case 'bb_stretch':
                passed = bb.pct_b != null && (bb.pct_b > 1.0 || bb.pct_b < 0.0);
                break;
            case 'bb_expansion':
                passed = bb.squeeze_state === 'EXPANSION';
                break;
            case 'bb_midline_hold':
            case 'bb_midline_support':
                // Price near midline: pct_b between 0.4–0.6
                passed = bb.pct_b != null && bb.pct_b >= 0.35 && bb.pct_b <= 0.65;
                break;
            case 'stoch_exhaustion':
                passed = st.k != null && (st.k > 80 || st.k < 20);
                break;
            case 'stoch_extreme':
                passed = st.k != null && (st.k > 80 || st.k < 20);
                break;
            case 'stoch_reset':
                passed = st.k != null && st.k >= 40 && st.k <= 60;
                break;
            case 'stoch_not_overextended':
            case 'no_stoch_chase':
                passed = st.k != null && st.k >= 25 && st.k <= 75;
                break;
            case 'stoch_aligned':
                // setupContext.direction: 'LONG' or 'SHORT'
                if (setupContext.direction === 'LONG')  passed = st.k != null && st.k < 70;
                if (setupContext.direction === 'SHORT') passed = st.k != null && st.k > 30;
                break;
            case 'stoch_pullback':
                passed = st.k != null && st.k >= 35 && st.k <= 65;
                break;
            case 'ao_flip':
                passed = ao.flip === true;
                break;
            case 'ao_aligned':
            case 'ao_confirmation':
            case 'ao_confirm':
                if (setupContext.direction === 'LONG')  passed = ao.color === 'green';
                if (setupContext.direction === 'SHORT') passed = ao.color === 'red';
                if (!setupContext.direction) passed = ao.value != null && ao.value !== 0;
                break;
            case 'ao_momentum_resume':
                passed = ao.flip === true || (ao.value != null && Math.abs(ao.value) > 0);
                break;
            case 'atr_beyond_sweep':
            case 'atr_stop_fvg':
            case 'atr_expansion':
            case 'atr_confirm':
                // ATR guide: pass if ATR is available and > 0
                passed = atr !== null && atr > 0;
                break;
            case 'midline_target':
                // Structural: always passable if setup has target defined
                passed = !!setupContext.target;
                break;
            default:
                passed = false;
        }

        checks.push({ name: checkKey, passed, weight: rule.weight, desc: rule.desc });
        if (passed) rawBonus += rule.weight;
    }

    // ── Clamp to MAX_INDICATOR_BONUS ─────────────────────────────────────────
    const bonus = Math.min(rawBonus, MAX_INDICATOR_BONUS);

    // ── Timing label ─────────────────────────────────────────────────────────
    const totalWeight = Object.values(strategy.timing).reduce((s, r) => s + r.weight, 0);
    const passedWeight = checks.filter(c => c.passed).reduce((s, c) => s + c.weight, 0);
    const ratio = totalWeight > 0 ? passedWeight / totalWeight : 0;
    const timing_label = ratio >= 0.7 ? 'CONFIRMED' : ratio >= 0.35 ? 'PARTIAL' : 'UNCONFIRMED';

    return { strategy: strategy.name, strategyKey, bonus, checks, timing_label, atr_veto, atr_veto_reason, meta };
}

/**
 * getATRGuides(atr)
 * Returns the three ATR reference levels for SL/TP placement.
 * IMPORTANT: 0.5× ATR is a micro-scalp reference only.
 *            It does NOT override the minimum R:R of 1.8.
 */
function getATRGuides(atr) {
    if (!atr || atr <= 0) return null;
    return {
        atr,
        half_atr:      parseFloat((atr * 0.5).toFixed(6)),
        full_atr:      parseFloat((atr * 1.0).toFixed(6)),
        one_half_atr:  parseFloat((atr * 1.5).toFixed(6)),
        label_half:    '0.5× ATR (micro-scalp guide — must still satisfy R:R ≥ 1.8)',
        label_full:    '1.0× ATR (normal SL guide)',
        label_1_5:     '1.5× ATR (volatility/wide SL guide)',
        min_rr:        MIN_RR
    };
}

/**
 * listStrategies()
 * Returns metadata about all known strategies for dashboard display.
 */
function listStrategies() {
    return Object.entries(STRATEGIES).map(([key, s]) => ({
        key,
        name: s.name,
        requires: s.requires,
        sessions: s.sessions || [],
        regimes: s.regimes || null,
        timing_factors: Object.keys(s.timing).length,
        max_bonus: Math.min(
            Object.values(s.timing).reduce((sum, r) => sum + r.weight, 0),
            MAX_INDICATOR_BONUS
        )
    }));
}

/**
 * classifyStrategies(indicators, marketContext)
 *
 * Classifies all 7 strategies as ACTIVE / WATCHLIST / AVOID.
 *
 * marketContext: {
 *   session: string (e.g. 'london_open', 'ny', 'asian'),
 *   regime: string (e.g. 'BULLISH', 'BEARISH', 'RANGE'),
 *   structures: string[] (e.g. ['liquidity_sweep', 'trend']),
 *   direction: 'LONG' | 'SHORT' | null
 * }
 *
 * RULES:
 *   - ACTIVE: session matches, regime matches (or any), >=1 structure requirement met, timing >= PARTIAL
 *   - WATCHLIST: session matches, regime matches, but structures incomplete or timing UNCONFIRMED
 *   - AVOID: wrong session, wrong regime, or invalidation condition present
 *   - This function NEVER outputs BUY/SELL — it classifies strategies only.
 */
function classifyStrategies(indicators, marketContext = {}) {
    const session    = (marketContext.session || '').toLowerCase();
    const regime     = (marketContext.regime || '').toUpperCase();
    const structures = Array.isArray(marketContext.structures) ? marketContext.structures : [];
    const direction  = marketContext.direction || null;
    const results = [];

    for (const [key, strat] of Object.entries(STRATEGIES)) {
        // Session check
        const sessionOK = !strat.sessions || strat.sessions.some(s => session.includes(s));
        // Regime check
        const regimeOK  = !strat.regimes || strat.regimes.includes(regime);
        // Structure requirements check
        const structsMet = strat.requires.filter(r => structures.includes(r));
        const structsOK  = structsMet.length === strat.requires.length;
        const structsPartial = structsMet.length > 0;
        // Avoid conditions check
        const avoidHit = (strat.avoid_when || []).some(a => {
            if (a === 'asian_session' && session.includes('asian')) return true;
            if (a === 'off_hours' && (session.includes('off') || session === '')) return true;
            if (a === 'range_market' && regime === 'RANGE') return true;
            if (a === 'strong_trend' && (regime === 'BULLISH' || regime === 'BEARISH')) return true;
            if (a === 'no_liquidity' && !structures.includes('liquidity_sweep')) return true;
            return false;
        });

        // Timing confirmation
        const timing = getTimingConfirmation(indicators, key, { direction });

        // Classify
        let state, reason, required_confirmation = [];
        if (avoidHit) {
            state = 'AVOID';
            reason = `Avoid condition: ${(strat.avoid_when || []).filter(a => {
                if (a === 'asian_session') return session.includes('asian');
                if (a === 'off_hours') return session.includes('off') || session === '';
                if (a === 'range_market') return regime === 'RANGE';
                if (a === 'strong_trend') return regime === 'BULLISH' || regime === 'BEARISH';
                return false;
            }).join(', ') || 'market conditions'}`;
        } else if (!sessionOK) {
            state = 'AVOID';
            reason = `Wrong session (need: ${strat.sessions.join('/')}, have: ${session || 'unknown'})`;
        } else if (!regimeOK) {
            state = 'AVOID';
            reason = `Wrong regime (need: ${strat.regimes.join('/')}, have: ${regime || 'unknown'})`;
        } else if (structsOK && timing.timing_label !== 'UNCONFIRMED') {
            state = 'ACTIVE';
            reason = `All requirements met, timing: ${timing.timing_label}`;
            required_confirmation = timing.checks.filter(c => !c.passed).map(c => c.desc);
        } else if (structsPartial || (structsOK && timing.timing_label === 'UNCONFIRMED')) {
            state = 'WATCHLIST';
            const missing = strat.requires.filter(r => !structures.includes(r));
            reason = missing.length
                ? `Missing: ${missing.join(', ')}`
                : `Timing unconfirmed (${timing.checks.filter(c => !c.passed).length} checks pending)`;
            required_confirmation = missing.length ? missing : timing.checks.filter(c => !c.passed).map(c => c.desc);
        } else {
            state = 'WATCHLIST';
            reason = `No structure requirements detected yet`;
            required_confirmation = strat.requires;
        }

        results.push({
            key,
            name: strat.name,
            state,
            reason,
            required_confirmation,
            timing_label: timing.timing_label,
            timing_bonus: timing.bonus,
            atr_veto: timing.atr_veto
        });
    }

    return results;
}

/**
 * getStrategySnapshot(indicators, marketContext)
 * Returns a structured summary suitable for snapshot storage.
 */
function getStrategySnapshot(indicators, marketContext = {}) {
    const classified = classifyStrategies(indicators, marketContext);
    return {
        session: marketContext.session || 'unknown',
        regime: marketContext.regime || 'unknown',
        active: classified.filter(s => s.state === 'ACTIVE').map(s => s.name),
        watchlist: classified.filter(s => s.state === 'WATCHLIST').map(s => s.name),
        avoid: classified.filter(s => s.state === 'AVOID').map(s => s.name),
        strategies: classified,
        timestamp: new Date().toISOString()
    };
}

module.exports = { getTimingConfirmation, getATRGuides, listStrategies, classifyStrategies, getStrategySnapshot, STRATEGIES, MAX_INDICATOR_BONUS, MIN_RR };
