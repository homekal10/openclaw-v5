/**
 * veto_engine.cjs — OpenClaw Hard Veto Layer v4.0
 * ────────────────────────────────────────────────────────────────
 * Runs after scoring. Cannot be overridden by AI or score.
 * 17 hard veto rules enforcing institutional discipline.
 *
 * CRITICAL: Vetoes fire EVEN if score is 85+.
 * AI cannot override. Learning mode cannot remove vetoes.
 * Learning mode can only tighten vetoes, never loosen.
 *
 * Returns { vetoed: bool, vetoes: string[], reasons: string[], summary: string }
 */
'use strict';

const VETO_RULES = [
    // ── Risk Vetoes ──────────────────────────────────────────────────────────
    {
        id: 'RR_MINIMUM',
        category: 'risk',
        severity: 'HARD',
        check: s => parseFloat(s.rr || s.risk_reward || s.rrRatio || 0) < 1.8,
        reason: rr => `R:R ${rr} below minimum 1.8`,
        extract: s => parseFloat(s.rr || s.risk_reward || s.rrRatio || 0).toFixed(2)
    },
    {
        id: 'NO_STOP_LOSS',
        category: 'risk',
        severity: 'HARD',
        check: s => !s.stopLoss && !s.sl && !s.stop_loss,
        reason: () => 'No stop loss defined — entry has no defined risk boundary'
    },
    {
        id: 'NO_INVALIDATION',
        category: 'risk',
        severity: 'HARD',
        check: s => !s.invalidation && !s.invalidation_level,
        reason: () => 'No invalidation level — cannot define when thesis is wrong'
    },
    {
        id: 'SPREAD_ABNORMAL',
        category: 'risk',
        severity: 'HARD',
        check: s => {
            const spread = parseFloat(s.spread || 0);
            const atr = parseFloat(s.atr || s.ta?.atr || 999);
            // Spread > 5% of ATR is abnormal for scalp/swing
            return spread > 0 && atr > 0 && (spread / atr) > 0.05;
        },
        reason: () => 'Spread abnormal relative to ATR — execution cost too high'
    },
    {
        id: 'STOP_TOO_TIGHT',
        category: 'risk',
        severity: 'HARD',
        check: s => {
            const sl = parseFloat(s.sl_distance || s.stopDistance || 0);
            const atr = parseFloat(s.atr || s.ta?.atr || 0);
            return sl > 0 && atr > 0 && sl < atr * 0.3;
        },
        reason: () => 'Stop loss too tight (< 0.3×ATR) — will get stopped by noise'
    },
    {
        id: 'STOP_TOO_WIDE',
        category: 'risk',
        severity: 'HARD',
        check: s => {
            const sl = parseFloat(s.sl_distance || s.stopDistance || 0);
            const atr = parseFloat(s.atr || s.ta?.atr || 0);
            return sl > 0 && atr > 0 && sl > atr * 3.0;
        },
        reason: () => 'Stop loss too wide (> 3×ATR) — risk per trade exceeds bounds'
    },

    // ── Structure Vetoes ─────────────────────────────────────────────────────
    {
        id: 'INCOMPLETE_STRUCTURE',
        category: 'structure',
        severity: 'HARD',
        check: s => !!(s.incompleteStructure || s.structureBroken),
        reason: () => 'Market structure incomplete or broken — setup invalidated'
    },
    {
        id: 'MID_RANGE_PRICE',
        category: 'structure',
        severity: 'HARD',
        check: s => !!(s.midRange || s.priceInMidRange || s.pricePosition === 'MID_RANGE'),
        reason: () => 'Price is mid-range (30-70% of range) — no clear structural edge'
    },
    {
        id: 'NO_LIQUIDITY_EVENT',
        category: 'structure',
        severity: 'HARD',
        check: s => {
            // Trend setups exempt from needing sweep — they use trend as liquidity
            const setup = (s.setupType || s.setup_type || '').toLowerCase();
            const trendSetups = ['ny_continuation', 'ema_pullback_fvg', 'trend_breakout_retest'];
            if (trendSetups.some(t => setup.includes(t))) return false;
            return !s.liquidity && !s.liquidityEvent && !s.sweepDetected;
        },
        reason: () => 'No liquidity event detected — setup lacks institutional context'
    },
    {
        id: 'NO_FVG_REQUIRED',
        category: 'structure',
        severity: 'HARD',
        check: s => {
            const type = (s.setupType || s.setup_type || '').toLowerCase();
            const fvgRequired = ['ema_pullback_fvg', 'london_sweep_reversal', 'range_sweep_trap'];
            return fvgRequired.some(t => type.includes(t)) && !s.fvg && !s.imbalance && !s.fvgZone && !s.fvgDetected;
        },
        reason: () => 'FVG/imbalance required for this setup type but not found'
    },

    // ── Momentum Vetoes ──────────────────────────────────────────────────────
    {
        id: 'CHASE_ENTRY_BUY',
        category: 'momentum',
        severity: 'HARD',
        check: s => {
            const dir = (s.direction || s.final_action || '').toUpperCase();
            const rsi = parseFloat(s.rsi || s.ta?.rsi || 50);
            return dir === 'BUY' && rsi > 75;
        },
        reason: rsi => `Chasing BUY into RSI ${rsi} — overbought entry without pullback`,
        extract: s => parseFloat(s.rsi || s.ta?.rsi || 50).toFixed(1)
    },
    {
        id: 'CHASE_ENTRY_SELL',
        category: 'momentum',
        severity: 'HARD',
        check: s => {
            const dir = (s.direction || s.final_action || '').toUpperCase();
            const rsi = parseFloat(s.rsi || s.ta?.rsi || 50);
            return dir === 'SELL' && rsi < 25;
        },
        reason: rsi => `Chasing SELL into RSI ${rsi} — oversold entry without pullback`,
        extract: s => parseFloat(s.rsi || s.ta?.rsi || 50).toFixed(1)
    },
    {
        id: 'WEAK_ADX_TREND',
        category: 'momentum',
        severity: 'HARD',
        check: s => {
            const type = (s.setupType || s.setup_type || '').toLowerCase();
            const trendSetups = ['ny_continuation', 'ema_pullback_fvg', 'trend_breakout_retest'];
            return trendSetups.some(t => type.includes(t)) && parseFloat(s.adx || s.ta?.adx?.adx || 999) < 20;
        },
        reason: adx => `ADX ${adx} < 20 — trend too weak for trend-following setup`,
        extract: s => parseFloat(s.adx || s.ta?.adx?.adx || 'N/A')
    },
    {
        id: 'MOMENTUM_CONFLICT',
        category: 'momentum',
        severity: 'HARD',
        check: s => {
            const dir = (s.direction || s.final_action || '').toUpperCase();
            const macd = (s.macdTrend || s.ta?.macd?.trend || '').toUpperCase();
            if (!dir || !macd || dir === 'WAIT' || dir === 'REJECTED') return false;
            return (dir === 'BUY' && macd === 'BEARISH') || (dir === 'SELL' && macd === 'BULLISH');
        },
        reason: () => 'MACD trend conflicts materially with trade direction'
    },

    // ── Context Vetoes ───────────────────────────────────────────────────────
    {
        id: 'HIGH_EVENT_RISK',
        category: 'macro',
        severity: 'HARD',
        check: s => !!(s.highEventRisk || s.event_risk_high || (s.eventRiskLevel || '').toLowerCase() === 'high'),
        reason: () => 'High-impact macro event within 4 hours — event risk lockout'
    },
    {
        id: 'SENTIMENT_ONLY',
        category: 'macro',
        severity: 'HARD',
        check: s => !!(s.sentimentOnly || s.onlySentimentSignal),
        reason: () => 'Trade reason is sentiment-only — no technical structure to support entry'
    },
    {
        id: 'POOR_SESSION',
        category: 'session',
        severity: 'HARD',
        check: s => {
            // Off-hours is always a veto for active setups
            const session = (s.session || '').toLowerCase();
            return session === 'off_hours';
        },
        reason: () => 'Off-hours session — no institutional flow, spreads widen'
    },

    // ── Data Vetoes ──────────────────────────────────────────────────────────
    {
        id: 'SETUP_UNCLASSIFIED',
        category: 'setup',
        severity: 'HARD',
        check: s => {
            const known = [
                'london_sweep_reversal', 'ny_continuation', 'ema_pullback_fvg',
                'range_sweep_trap', 'trend_breakout_retest'
            ];
            const type = (s.setupType || s.setup_type || '').toLowerCase().replace(/\s+/g, '_');
            if (!type || type === 'unknown' || type === 'none') return true;
            return !known.includes(type);
        },
        reason: type => `Setup type "${type}" not in approved list — must map to a known pattern`,
        extract: s => s.setupType || s.setup_type || 'unknown'
    },
    {
        id: 'STALE_PRICE_DATA',
        category: 'data',
        severity: 'HARD',
        check: s => (s.priceAgeMs || 0) > 5 * 60 * 1000,
        reason: age => `Price data ${Math.round(age / 60000)}min old — exceeds 5min freshness limit`,
        extract: s => s.priceAgeMs || 0
    },
    {
        id: 'CONFLICTING_SOURCES',
        category: 'data',
        severity: 'HARD',
        check: s => !!(s.sourceConflict || s.priceConflict),
        reason: () => 'Significant price divergence between data sources — data integrity risk'
    }
];

/**
 * applyVetoes(signal) → { vetoed, vetoes, reasons, categories, summary, vetoCount }
 */
function applyVetoes(signal) {
    const firedVetoes = [];
    const reasons     = [];
    const categories  = new Set();

    for (const rule of VETO_RULES) {
        try {
            if (rule.check(signal)) {
                const value  = rule.extract ? rule.extract(signal) : null;
                const reason = rule.reason(value);
                firedVetoes.push(rule.id);
                reasons.push(reason);
                categories.add(rule.category);
            }
        } catch {
            // Never let a veto rule crash the pipeline
        }
    }

    return {
        vetoed:     firedVetoes.length > 0,
        vetoes:     firedVetoes,
        reasons,
        categories: [...categories],
        vetoCount:  firedVetoes.length,
        summary:    firedVetoes.length > 0
            ? `🚫 ${firedVetoes.length} veto(s): ${firedVetoes.slice(0, 4).join(', ')}`
            : '✅ No vetoes'
    };
}

/**
 * formatVetoSummary(vetoResult) → Telegram markdown string
 */
function formatVetoSummary(vetoResult) {
    if (!vetoResult.vetoed) return '✅ No vetoes';
    const lines = [`🚫 *${vetoResult.vetoes.length} Hard Veto(s) Fired:*`];
    vetoResult.reasons.forEach(r => lines.push(`• ${r}`));
    if (vetoResult.categories.length) {
        lines.push(`\n_Categories: ${vetoResult.categories.join(', ')}_`);
    }
    return lines.join('\n');
}

/**
 * getVetoRuleCount() → number of active hard veto rules
 */
function getVetoRuleCount() {
    return VETO_RULES.length;
}

module.exports = { applyVetoes, formatVetoSummary, getVetoRuleCount, VETO_RULES };
