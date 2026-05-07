/**
 * signal_verifier.cjs — OpenClaw Signal Verification Layer
 *
 * Runs after scoring, before Telegram/dashboard publication.
 * 13 verification gates. Every gate must pass for VERIFIED_ACTIVE.
 *
 * Output states:
 *   VERIFIED_ACTIVE    → may become BUY/SELL
 *   VERIFIED_WATCHLIST → becomes WATCHLIST
 *   WAIT               → setup exists but trigger not ready
 *   REJECTED           → hard failure, do not publish as trade
 */
'use strict';

const { classifyError, STAGES } = require('../errors/error_classifier.cjs');

// ─── Approved Setup Types (Strict — only the 5 spec-approved families) ────────
const APPROVED_SETUP_TYPES = [
    'london_sweep_reversal',
    'ny_continuation',
    'ema_pullback_fvg',
    'range_sweep_trap',
    'trend_breakout_retest',
    'asian_range_break',
    'liquidity_grab_reversal'
];

// ─── Session Windows (UTC hours) ─────────────────────────────────────────────
const SESSION_WINDOWS = {
    london:    { start: 7,  end: 16 },
    new_york:  { start: 12, end: 21 },
    overlap:   { start: 12, end: 16 },
    asia:      { start: 0,  end: 7  }
};

function getCurrentSession() {
    const h = new Date().getUTCHours();
    if (h >= 12 && h < 16) return 'overlap';
    if (h >= 7  && h < 16) return 'london';
    if (h >= 12 && h < 21) return 'new_york';
    if (h >= 0  && h < 7)  return 'asia';
    return 'off_session';
}

// ─── Gate Definitions ─────────────────────────────────────────────────────────
const GATES = {
    G01_SETUP_TYPE:       'Setup must match an approved setup type',
    G02_TREND_VALID:      'Trend must be classified (not flat/unknown)',
    G03_STRUCTURE_VALID:  'Market structure must show HH/HL or LH/LL sequence',
    G04_LIQUIDITY:        'A liquidity event must be present (sweep, equal highs/lows)',
    G05_FVG:              'FVG or imbalance must exist where setup requires it',
    G06_SESSION_FIT:      'Session must be appropriate for the setup type',
    G07_MACRO_RISK:       'No high-impact event risk in next 4 hours',
    G08_RR_VALID:         'R:R must be >= 1.8',
    G09_INVALIDATION:     'Clear invalidation level must be defined',
    G10_CHASE_CHECK:      'Entry must not be a chase into extreme RSI/momentum',
    G11_DATA_FRESH:       'Provider data must be fresh (< 5 min for price, < 60 min for news)',
    G12_PROVIDER_HEALTH:  'Minimum provider health required (not all stale/failed)',
    G13_VETO_CLEAR:       'No hard veto must have fired'
};

// ─── Session fitness by setup type ───────────────────────────────────────────
const SETUP_SESSION_MAP = {
    london_sweep_reversal:   ['london', 'overlap'],
    ny_continuation:         ['new_york', 'overlap'],
    ema_pullback_fvg:        ['london', 'new_york', 'overlap'],
    range_sweep_trap:        ['london', 'new_york', 'overlap'],
    trend_breakout_retest:   ['london', 'new_york', 'overlap'],
    asian_range_break:       ['london', 'overlap'],
    liquidity_grab_reversal: ['london', 'new_york', 'overlap']
};

// ─── Main Verifier ─────────────────────────────────────────────────────────────
/**
 * verify(signal, context) → VerificationResult
 *
 * @param {object} signal  - From scoring engine: { score, confidence, direction, setupType, ... }
 * @param {object} context - { asset, providers, vetoResult, marketData, newsData, runId }
 * @returns {VerificationResult}
 */
function verify(signal, context = {}) {
    const { asset = 'UNKNOWN', runId = 'no-run-id' } = context;
    const gateResults = [];
    const failedGates = [];
    const warnings    = [];
    let watchlistOnly = false;

    // Helper: record a gate pass/fail
    function gate(id, passed, reason, critical = true) {
        const result = { gate: id, label: GATES[id], passed, reason };
        gateResults.push(result);
        if (!passed) {
            if (critical) failedGates.push(result);
            else          warnings.push(result);
        }
        return passed;
    }

    // ── G01: Setup Type ──────────────────────────────────────────────────────
    const setupType = (signal.setupType || signal.setup_type || '').toLowerCase().replace(/\s+/g, '_');
    const setupValid = APPROVED_SETUP_TYPES.includes(setupType);
    gate('G01_SETUP_TYPE', setupValid,
        setupValid ? `Setup: ${setupType}` : `Unknown or missing setup type: "${setupType}"`);

    // ── G02: Trend Valid ─────────────────────────────────────────────────────
    const trend = (signal.trend || signal.trend_1h || signal.trend4h || '').toLowerCase();
    const trendValid = ['bullish', 'bearish', 'uptrend', 'downtrend'].some(t => trend.includes(t));
    gate('G02_TREND_VALID', trendValid,
        trendValid ? `Trend: ${trend}` : `Trend unclear or missing: "${trend}"`);

    // ── G03: Structure Valid ─────────────────────────────────────────────────
    const structure = signal.structure || signal.market_structure || {};
    const hasStructure = structure.type || structure.sequence || signal.structureType;
    const structureValid = !!hasStructure;
    if (!structureValid) watchlistOnly = true; // soft failure
    gate('G03_STRUCTURE_VALID', structureValid,
        structureValid ? `Structure: ${structure.type || structure.sequence || signal.structureType}`
                       : 'No market structure data provided', false); // non-critical — → watchlist

    // ── G04: Liquidity Event ─────────────────────────────────────────────────
    const liquidity = signal.liquidity || signal.liquidityEvent || signal.sweepDetected;
    const liquidityValid = !!liquidity;
    // Only critical for sweep-based setups; trend setups don't need sweeps
    const sweepCriticalSetups = ['london_sweep_reversal', 'range_sweep_trap', 'liquidity_grab_reversal'];
    const liquidityCritical = sweepCriticalSetups.includes(setupType);
    gate('G04_LIQUIDITY', liquidityValid,
        liquidityValid ? `Liquidity: ${typeof liquidity === 'string' ? liquidity : 'detected'}`
                       : 'No liquidity event (sweep, equal highs/lows) detected',
        liquidityCritical); // Only critical for sweep setups

    // ── G05: FVG / Imbalance ─────────────────────────────────────────────────
    const fvgRequiredSetups = ['ema_pullback_fvg', 'london_sweep_reversal', 'liquidity_grab_reversal'];
    const fvgRequired = fvgRequiredSetups.includes(setupType);
    const fvgPresent  = !!(signal.fvg || signal.imbalance || signal.gapFill || signal.fvgZone);
    const fvgPasses   = !fvgRequired || fvgPresent;
    gate('G05_FVG', fvgPasses,
        fvgPasses ? (fvgPresent ? 'FVG/imbalance present' : 'FVG not required for this setup')
                  : `FVG required for ${setupType} but not detected`);

    // ── G06: Session Fit ─────────────────────────────────────────────────────
    const currentSession = context.session || getCurrentSession();
    const allowedSessions = SETUP_SESSION_MAP[setupType] || ['london', 'new_york', 'overlap'];
    const sessionFit = allowedSessions.includes(currentSession);
    if (!sessionFit) watchlistOnly = true;
    gate('G06_SESSION_FIT', sessionFit,
        sessionFit ? `Session: ${currentSession} ✓ for ${setupType}`
                   : `Session ${currentSession} not ideal for ${setupType} (best: ${allowedSessions.join('/')})`,
        false); // non-critical — → watchlist

    // ── G07: Macro Risk ──────────────────────────────────────────────────────
    const highEventRisk = signal.highEventRisk || signal.event_risk_high || context.highEventRisk;
    gate('G07_MACRO_RISK', !highEventRisk,
        !highEventRisk ? 'No high-impact events in window'
                       : `High event risk detected: ${signal.eventRiskNote || 'major USD/macro event'}`);

    // ── G08: R:R Valid ───────────────────────────────────────────────────────
    const rr = parseFloat(signal.rr || signal.risk_reward || signal.rrRatio || 0);
    const rrValid = rr >= 1.8;
    gate('G08_RR_VALID', rrValid,
        rrValid ? `R:R ${rr.toFixed(2)} ≥ 1.8` : `R:R ${rr.toFixed(2)} < 1.8 minimum`);

    // ── G09: Clear Invalidation ──────────────────────────────────────────────
    const hasInvalidation = !!(signal.invalidation || signal.invalidation_level || signal.stopLoss || signal.sl);
    gate('G09_INVALIDATION', hasInvalidation,
        hasInvalidation ? `Invalidation: ${signal.invalidation || signal.invalidation_level || signal.sl}`
                        : 'No clear invalidation or stop loss level defined');

    // ── G10: Chase Check ─────────────────────────────────────────────────────
    const rsi = parseFloat(signal.rsi || signal.ta?.rsi || 50);
    const direction = (signal.direction || signal.action || '').toUpperCase();
    const isChase = (direction === 'BUY'  && rsi > 75) ||
                   (direction === 'SELL' && rsi < 25);
    gate('G10_CHASE_CHECK', !isChase,
        !isChase ? `RSI ${rsi} — no chase detected`
                 : `Chase entry: RSI ${rsi} is extreme for ${direction} direction`);

    // ── G11: Data Freshness ──────────────────────────────────────────────────
    const priceAgeMs  = context.priceAgeMs  || 0;
    const newsAgeMs   = context.newsAgeMs   || 0;
    const MAX_PRICE_MS = 5  * 60 * 1000; // 5 min
    const MAX_NEWS_MS  = 60 * 60 * 1000; // 60 min
    const dataFresh = priceAgeMs < MAX_PRICE_MS;
    const newsFresh = newsAgeMs  < MAX_NEWS_MS;
    if (!newsFresh) warnings.push({ gate: 'G11_NEWS_STALE', passed: false, reason: `News data ${Math.round(newsAgeMs/60000)}min old` });
    gate('G11_DATA_FRESH', dataFresh,
        dataFresh ? `Price data ${Math.round(priceAgeMs/1000)}s old — fresh`
                  : `Price data ${Math.round(priceAgeMs/60000)}min old — stale (max 5min)`);

    // ── G12: Provider Health ─────────────────────────────────────────────────
    const providers     = context.providers || {};
    const totalProviders = Object.keys(providers).length;
    const healthyCount   = Object.values(providers).filter(p => p.healthy !== false).length;
    const healthRatio    = totalProviders > 0 ? healthyCount / totalProviders : 1;
    const providerHealthy = healthRatio >= 0.5; // at least 50% of providers healthy
    gate('G12_PROVIDER_HEALTH', providerHealthy,
        providerHealthy ? `${healthyCount}/${totalProviders} providers healthy`
                        : `Only ${healthyCount}/${totalProviders} providers healthy — data integrity risk`);

    // ── G13: Veto Clear ──────────────────────────────────────────────────────
    const vetoResult = context.vetoResult || signal.vetoResult || {};
    const vetoFired  = vetoResult.vetoed === true || (vetoResult.vetoes && vetoResult.vetoes.length > 0);
    gate('G13_VETO_CLEAR', !vetoFired,
        !vetoFired ? 'No hard vetoes fired'
                   : `Veto(s): ${(vetoResult.vetoes || ['unknown']).join(', ')}`);

    // ── v3.4: Explicit single-source trade prevention ─────────────────────────
    const scoreOnly = signal.score_only_trade || (!hasStructure && !liquidityValid && !fvgPresent);
    if (scoreOnly) {
        gate('G14_NO_SCORE_ONLY', false, 'Score alone cannot generate BUY/SELL — requires structural confluence');
    }
    const indicatorOnly = signal.indicator_only_trade || false;
    if (indicatorOnly) {
        gate('G15_NO_INDICATOR_ONLY', false, 'Indicator alone cannot generate BUY/SELL — requires setup type');
    }

    // ── Determine Final State ────────────────────────────────────────────────
    const criticalFails = failedGates.length;
    let state, reason;

    if (criticalFails === 0 && !watchlistOnly) {
        state  = 'VERIFIED_ACTIVE';
        reason = 'All gates passed';
    } else if (criticalFails === 0 && watchlistOnly) {
        state  = 'VERIFIED_WATCHLIST';
        reason = `Setup valid but not trigger-ready (${warnings.map(w => w.gate).join(', ')})`;
    } else if (criticalFails === 1 && failedGates[0].gate === 'G06_SESSION_FIT') {
        state  = 'WAIT';
        reason = `Waiting for appropriate session (${allowedSessions.join(' or ')})`;
    } else if (criticalFails <= 2 && !failedGates.some(g =>
        ['G08_RR_VALID','G07_MACRO_RISK','G13_VETO_CLEAR','G10_CHASE_CHECK','G14_NO_SCORE_ONLY','G15_NO_INDICATOR_ONLY'].includes(g.gate))) {
        state  = 'WAIT';
        reason = `${criticalFails} condition(s) not yet met`;
    } else {
        state  = 'REJECTED';
        reason = `${criticalFails} critical gate(s) failed`;
    }

    // Score check override
    const score = parseFloat(signal.score || signal.total_score || 0);
    if (score < 60 && state !== 'REJECTED') {
        state  = 'REJECTED';
        reason = `Score ${score}/100 below minimum threshold of 60`;
    } else if (score < 75 && state === 'VERIFIED_ACTIVE') {
        state  = 'WAIT';
        reason = `Score ${score}/100 below execution threshold of 75`;
    }

    // v3.4: Build 8-layer conditions summary
    const conditions = {
        trend_condition: trendValid ? trend : 'UNCLEAR',
        structure_condition: structureValid ? (structure.type || 'present') : 'MISSING',
        liquidity_condition: liquidityValid ? 'detected' : 'none',
        fvg_condition: fvgPresent ? 'present' : (fvgRequired ? 'MISSING_REQUIRED' : 'not_required'),
        session_condition: sessionFit ? currentSession : 'OFF_SESSION',
        macro_condition: highEventRisk ? 'HIGH_RISK' : 'clear',
        risk_condition: rrValid ? `R:R ${rr.toFixed(2)}` : `R:R ${rr.toFixed(2)} BELOW_MIN`,
        momentum_condition: isChase ? 'CHASE_DETECTED' : 'normal'
    };

    return {
        state,
        reason,
        score,
        setupType,
        currentSession,
        gateResults,
        failedGates,
        warnings,
        criticalFails,
        watchlistOnly,
        conditions,
        needed_confirmation: signal.needed_confirmation || [],
        invalidation_level: signal.invalidation || signal.invalidation_level || signal.sl || null,
        verifiedAt: new Date().toISOString(),
        runId,
        asset
    };
}

// ─── Format Verification for Telegram ────────────────────────────────────────
function formatVerificationSummary(result) {
    const icon = {
        VERIFIED_ACTIVE:    '✅',
        VERIFIED_WATCHLIST: '👁',
        WAIT:               '⏳',
        REJECTED:           '❌'
    }[result.state] || '❓';

    const lines = [`${icon} *Verification:* \`${result.state}\``, `_${result.reason}_`];

    if (result.failedGates.length > 0) {
        lines.push('\n*Failed Gates:*');
        result.failedGates.forEach(g => lines.push(`• ${g.gate}: ${g.reason}`));
    }
    if (result.warnings.length > 0) {
        lines.push('\n*Warnings:*');
        result.warnings.forEach(w => lines.push(`⚠️ ${w.reason}`));
    }

    return lines.join('\n');
}

// ─── Map state to final action ────────────────────────────────────────────────
function resolveAction(signal, verificationResult) {
    switch (verificationResult.state) {
        case 'VERIFIED_ACTIVE':
            return signal.direction || signal.action || 'WAIT';
        case 'VERIFIED_WATCHLIST':
            return 'WATCHLIST';
        case 'WAIT':
            return 'WAIT';
        case 'REJECTED':
        default:
            return 'REJECTED';
    }
}

module.exports = {
    verify,
    resolveAction,
    formatVerificationSummary,
    APPROVED_SETUP_TYPES,
    GATES,
    getCurrentSession
};
