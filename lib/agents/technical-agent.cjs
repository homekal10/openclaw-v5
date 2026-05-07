/**
 * technical-agent.cjs — OpenClaw Technical Agent v2.5
 *
 * Role: Analyze trend, structure, liquidity, FVG, momentum, session fit.
 *
 * FIXED: Blockers are now calibrated correctly.
 * - Sweep/FVG blockers are SETUP-SPECIFIC (not universal)
 * - A new 6th setup "momentum_trend" catches trending markets without ICT structures
 * - Mid-range only blocks when the 4H trend is explicitly RANGE
 * - Score of 0 no longer possible for clean trending setups
 */

'use strict';

const { analyze }         = require('../../strategy_engine.cjs');
const { classifySetup }   = require('../scoring/setup-classifier.cjs');
const { computeScore, formatScoreBreakdown } = require('../scoring/scoring-engine.cjs');
const { applyVetoes }     = require('../veto/veto_engine.cjs');

/**
 * runTechnicalAgent(symbol, candles4H, candles1H, candles15M) → TechnicalOutput
 */
async function runTechnicalAgent(symbol, candles4H, candles1H, candles15M) {
    const startTime = Date.now();

    try {
        // ── Run analysis on both timeframes ──────────────────────────────────
        const analysis4H = candles4H?.length >= 50 ? analyze(candles4H, '4H') : null;
        const analysis1H = candles1H?.length >= 30 ? analyze(candles1H, '1H') : null;

        // Use best available timeframe for primary analysis
        const primary = analysis4H || analysis1H;
        if (!primary) {
            return buildError('INSUFFICIENT_DATA', 'Not enough candle data for analysis');
        }

        // ── Trend classification ──────────────────────────────────────────────
        const trend4H = analysis4H?.trend || 'UNKNOWN';
        const trend1H = analysis1H?.trend || trend4H;

        // ── Extract key indicators ────────────────────────────────────────────
        const { currentPrice, rsi, rsiZone, atr, adx, macd, divergence,
                structure, fvg, sweep, session, sessionQuality,
                pricePosition, priceNearEMA, isChaseEntry,
                volumeTrend, atrExpanding } = primary;

        const adxValue = adx?.adx ?? null;

        // ── Momentum helpers ──────────────────────────────────────────────────
        const macdBullish = macd?.trend === 'BULLISH';
        const macdBearish = macd?.trend === 'BEARISH';
        const momentumContinuing = (trend4H === 'BULLISH' && macdBullish) ||
                                   (trend4H === 'BEARISH' && macdBearish);
        const momentumReversing  = !momentumContinuing && (macdBullish || macdBearish);

        // ── Setup Classification ──────────────────────────────────────────────
        const setupContext = {
            session, trend4H, trend1H,
            sweepDetected:  sweep?.swept,
            sweepType:      sweep?.type,
            fvgDetected:    fvg?.detected,
            fvgInEntryZone: fvg?.inEntryZone,
            structureState: structure?.state,
            bosDetected:    structure?.bosDetected,
            chochDetected:  structure?.chochDetected,
            priceNearEMA,
            adxValue,
            momentumReversing,
            momentumContinuing,
            equalHighDetected: primary.equalHighDetected,
            equalLowDetected:  primary.equalLowDetected
        };
        let setupResult = classifySetup(setupContext);

        // v4.0: No fallback setup types. If no approved setup matches, signal is WAIT.
        // This enforces strict 5-setup discipline: london_sweep_reversal, ny_continuation,
        // ema_pullback_fvg, range_sweep_trap, trend_breakout_retest.

        // ── Hard Blockers Check ───────────────────────────────────────────────
        const blockers = [];

        // 1. Weak ADX for trend-following setups only
        const trendSetups = ['ny_continuation', 'ema_pullback_fvg', 'trend_breakout_retest'];
        if (setupResult.setupType &&
            trendSetups.includes(setupResult.setupType) &&
            adxValue != null && adxValue < 15) {   // Relaxed from 20 → 15 for daily candles
            blockers.push(`ADX ${adxValue} too weak — no directional momentum`);
        }

        // 2. Neutral trend + mixed structure (only when truly ranging)
        if (trend4H === 'RANGE' &&
            ['MIXED', 'NEUTRAL', 'UNCLEAR', 'INSUFFICIENT_PIVOTS'].includes(structure?.state)) {
            blockers.push('Ranging market with mixed structure — no directional edge');
        }

        // 3. Sweep only required for sweep-specific setups
        if (['london_sweep_reversal', 'range_sweep_trap'].includes(setupResult.setupType) && !sweep?.swept) {
            blockers.push(`${setupResult.label} requires a confirmed liquidity sweep`);
        }

        // 4. FVG only required for FVG-specific setups
        if (setupResult.setupType === 'ema_pullback_fvg' &&
            (!fvg?.detected || !fvg?.inEntryZone || fvg?.reclaimed)) {
            blockers.push('EMA Pullback setup requires an unmitigated FVG in the entry zone');
        }

        // 5. Chase entry — don't buy extreme overbought or sell extreme oversold
        if (isChaseEntry) {
            blockers.push('Chase entry: RSI extreme at trend extremity — wait for pullback');
        }

        // 6. Price mid-range ONLY in a 4H range (no trend to trade)
        if (pricePosition === 'MID_RANGE' && trend4H === 'RANGE') {
            blockers.push('Ranging 4H structure: price mid-range — wait for premium/discount extremes');
        }

        // 7. No setup type at all (trend is RANGE and no ICT setup fired)
        if (!setupResult.setupType) {
            blockers.push('No tradeable setup pattern — market is ranging without clear structure');
        }

        // 8. Multi-TF Confluence (only when both TFs are clear, not RANGE/UNKNOWN)
        if (trend4H !== 'UNKNOWN' && trend1H !== 'UNKNOWN' &&
            trend4H !== 'RANGE'   && trend1H !== 'RANGE') {
            if (trend4H !== trend1H) {
                blockers.push(`Multi-TF conflict: 4H ${trend4H} vs 1H ${trend1H} — await resolution`);
            }
        }

        // 9. Asset-class session filters
        const isCrypto = ['BTC','ETH','SOL','XRP','ADA','DOGE','BNB'].some(c => symbol.toUpperCase().startsWith(c));
        const isForex  = ['EUR','GBP','AUD','NZD','CAD','CHF','USD'].some(c => symbol.toUpperCase().startsWith(c));

        // Forex needs active sessions (London or NY)
        if (isForex && sessionQuality === 'low' && !isCrypto) {
            blockers.push('Forex: low liquidity session — avoid until London or NY open');
        }

        // 10. Volume confirmation for breakouts
        if (volumeTrend === 'DECLINING' && setupResult.setupType?.includes('breakout')) {
            blockers.push('Declining volume on breakout — fakeout risk elevated');
        }

        // ── Determine technical decision ─────────────────────────────────────
        let technicalDecision;
        if (blockers.length >= 3) {
            technicalDecision = 'REJECTED';
        } else if (blockers.length >= 1) {
            technicalDecision = setupResult.setupType ? 'WATCHLIST' : 'WAIT';
        } else {
            technicalDecision = 'CANDIDATE';
        }

        // ── Entry / Stop / TP logic ──────────────────────────────────────────
        const isBullish = trend4H === 'BULLISH';
        const entryZone = fvg?.detected && fvg?.inEntryZone
            ? `${fvg.gapLow.toFixed(5)} – ${fvg.gapHigh.toFixed(5)}`
            : priceNearEMA
                ? `Near EMA zone ~${currentPrice.toFixed(5)}`
                : `~${currentPrice.toFixed(5)}`;

        const invalidationLevel = isBullish
            ? (sweep?.level || structure?.lastL || (currentPrice - atr * 1.5))?.toFixed(5)
            : (sweep?.level || structure?.lastH || (currentPrice + atr * 1.5))?.toFixed(5);

        // ── Momentum state ────────────────────────────────────────────────────
        const macdAligned = macd && (
            (trend4H === 'BULLISH' && macd.trend === 'BULLISH') ||
            (trend4H === 'BEARISH' && macd.trend === 'BEARISH')
        );
        const momentumConflict = macdAligned === false ? 'STRONG' : 'NONE';
        const momentumState = {
            macdTrend:       macd?.trend || 'N/A',
            macdHistogram:   macd?.histogram,
            macdAligned,
            rsi,
            rsiZone,
            divergence,
            atrExpanding,
            momentumConflict
        };

        // ── Score (technical layer only) ──────────────────────────────────────
        const scoreInput = {
            trend4H, trend1H,
            sweepDetected:   sweep?.swept,
            sweepType:       sweep?.type,
            sweepFreshness:  sweep?.freshness,
            fvgDetected:     fvg?.detected,
            fvgType:         fvg?.type,
            fvgInEntryZone:  fvg?.inEntryZone,
            fvgReclaimed:    fvg?.reclaimed,
            macdAligned,
            macdStrong:      Math.abs(macd?.histogram || 0) > 0.01,
            rsiZone,
            atrExpanding,
            divergence,
            session,
            eventRiskLevel: 'none',
            regimeAligned:   true,
            macroConflict:   false,
            rrValue:         2.0,
            stopValid:       !!invalidationLevel,
            spreadAcceptable: true
        };

        const scoreResult = computeScore(scoreInput);
        const techVeto = applyVetoes(scoreInput);

        // Technical bias for macro cross-check
        const technicalBias = isBullish ? 'BULLISH' : trend4H === 'BEARISH' ? 'BEARISH' : 'NEUTRAL';

        return {
            technical_decision: technicalDecision,
            technical_score:    scoreResult.total,
            technical_bias:     technicalBias,
            setup_type:         setupResult.setupType || null,
            setup_label:        setupResult.label,
            setup_confidence:   setupResult.confidence,
            blockers,
            why_not_trade:      blockers,
            why_trade:          setupResult.reasons || [],
            momentum_state:     momentumState,
            entry_zone:         entryZone,
            invalidation_level: invalidationLevel,
            veto_flags:         techVeto,
            score_breakdown:    scoreResult.breakdown,
            // Raw indicators for downstream agents
            indicators: {
                currentPrice, rsi, rsiZone, atr, adx, macd,
                ema20: primary.ema20, ema50: primary.ema50, ema200: primary.ema200,
                trend4H, trend1H, structure, fvg, sweep,
                session, sessionQuality, volumeTrend,
                divergence, pricePosition
            },
            run_ms: Date.now() - startTime
        };

    } catch(e) {
        return buildError('AGENT_EXCEPTION', e.message);
    }
}

function buildError(code, message) {
    return {
        technical_decision: 'ERROR',
        technical_score:    0,
        technical_bias:     'NEUTRAL',
        setup_type:         null,
        blockers:           [message],
        why_not_trade:      [message],
        why_trade:          [],
        indicators:         {},
        error_code:         code,
        run_ms:             0
    };
}

module.exports = { runTechnicalAgent };
