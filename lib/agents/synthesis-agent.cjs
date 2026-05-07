/**
 * synthesis-agent.cjs — OpenClaw Synthesis Agent
 *
 * Role: Combine all agents, apply scoring + vetoes, decide final state.
 *
 * Decision cascade (strict order):
 *   1. Risk REJECTED → final REJECTED (no override)
 *   2. Technical has no setup_type → WAIT or REJECTED
 *   3. Macro HIGH event risk → WAIT
 *   4. Total score < 60 → REJECTED
 *   5. Total score 60-74 → WAIT
 *   6. Setup confirmed but trigger not active → WATCHLIST
 *   7. Score ≥ 75, all vetoes pass, trigger active → BUY/SELL
 */

'use strict';

const { computeScore, formatScoreBreakdown } = require('../scoring/scoring-engine.cjs');
const { applyVetoes }                         = require('../veto/veto_engine.cjs');

/**
 * runSynthesisAgent(techOutput, macroOutput, riskOutput, context) → SynthesisOutput
 */
async function runSynthesisAgent(techOutput, macroOutput, riskOutput, context = {}) {
    const startTime = Date.now();

    try {
        const { symbol, direction, triggerActive = false } = context;

        // ── Step 1: Risk veto (non-negotiable) ───────────────────────────────
        if (riskOutput?.risk_decision === 'REJECTED') {
            return buildFinal({
                final_action:      'REJECTED',
                confidence:        0,
                veto_summary:      riskOutput.blockers || ['Risk agent rejected trade'],
                why_not_trade:     riskOutput.why_not_trade,
                why_trade:         [],
                agreement_summary: '0/3 agents agree',
                setup_type:        techOutput?.setup_type,
                total_score:       0,
                startTime
            });
        }

        // ── Step 2: Compute full composite score ─────────────────────────────
        // Extract raw indicators from techOutput (new technical-agent v2.5 format)
        const ind = techOutput?.indicators || {};
        const scoreInput = {
            // Setup type (CRITICAL — enables partial credit in scoring engine)
            setupType:       techOutput?.setup_type,
            // Trend (from tech agent indicators)
            trend4H:         ind.trend4H || techOutput?.technical_bias || 'NEUTRAL',
            trend1H:         ind.trend1H || ind.trend4H || 'NEUTRAL',
            // Liquidity (from tech indicators)
            sweepDetected:   ind.sweep?.swept || techOutput?.liquidity_map?.swept,
            sweepType:       ind.sweep?.type  || techOutput?.liquidity_map?.type,
            sweepFreshness:  ind.sweep?.freshness || techOutput?.liquidity_map?.freshness,
            // FVG (from tech indicators)
            fvgDetected:     ind.fvg?.detected    || techOutput?.fvg_state?.detected,
            fvgType:         ind.fvg?.type         || techOutput?.fvg_state?.type,
            fvgInEntryZone:  ind.fvg?.inEntryZone  || techOutput?.fvg_state?.inEntryZone,
            fvgReclaimed:    ind.fvg?.reclaimed     || techOutput?.fvg_state?.reclaimed,
            // Volume
            volumeTrend:     ind.volumeTrend,
            // Momentum (from tech)
            macdAligned:     techOutput?.momentum_state?.macdAligned,
            macdStrong:      Math.abs(techOutput?.momentum_state?.macdHistogram || 0) > 0.01,
            rsiZone:         ind.rsiZone || techOutput?.momentum_state?.rsiZone,
            atrExpanding:    techOutput?.momentum_state?.atrExpanding,
            divergence:      ind.divergence || techOutput?.momentum_state?.divergence,
            // Session (from tech)
            session:         ind.session || techOutput?.session_fit,
            // Macro (from macro agent)
            eventRiskLevel:  macroOutput?.event_risk_level || 'LOW',
            regimeAligned:   !macroOutput?.macro_conflicts?.length,
            macroConflict:   !!(macroOutput?.macro_conflicts?.length),
            // Risk (from risk agent)
            rrValue:         riskOutput?.rr_value || 0,
            stopValid:       riskOutput?.stop_validation === 'VALID',
            spreadAcceptable: riskOutput?.spread_status === 'ACCEPTABLE'
        };

        const scoreResult = computeScore(scoreInput);

        // ── Step 3: Apply veto rules ──────────────────────────────────────────
        const vetoContext = {
            adxValue:              ind.adx?.adx ?? techOutput?.adx_value,
            setupType:             techOutput?.setup_type,
            trend4H:               ind.trend4H || techOutput?.technical_bias || 'UNKNOWN',
            trend1H:               ind.trend1H || ind.trend4H || 'UNKNOWN',
            structureState:        ind.structure?.state || techOutput?.structure_state,
            sweepDetected:         ind.sweep?.swept || techOutput?.liquidity_map?.swept,
            fvgDetected:           ind.fvg?.detected || techOutput?.fvg_state?.detected,
            fvgInEntryZone:        ind.fvg?.inEntryZone || techOutput?.fvg_state?.inEntryZone,
            fvgReclaimed:          ind.fvg?.reclaimed || techOutput?.fvg_state?.reclaimed,
            isChaseEntry:          ind.isChaseEntry || techOutput?.is_chase_entry,
            invalidationLevel:     techOutput?.invalidation_level || context.invalidationLevel,
            pricePosition:         ind.pricePosition || techOutput?.price_position,
            momentumConflict:      techOutput?.momentum_state?.momentumConflict,
            divergence:            ind.divergence || techOutput?.momentum_state?.divergence,
            eventRiskLevel:        macroOutput?.event_risk_level || 'LOW',
            macroConflict:         !!(macroOutput?.macro_conflicts?.length),
            tradeRestriction:      macroOutput?.trade_restriction,
            sentimentOnlySignal:   macroOutput?.sentiment_only,
            headlineRelevanceScore: macroOutput?.headline_relevance_score,
            rrValue:               riskOutput?.rr_value,
            stopValid:             riskOutput?.stop_validation === 'VALID',
            spreadAcceptable:      riskOutput?.spread_status === 'ACCEPTABLE',
            session:               ind.session || techOutput?.session_fit,
            total:                 scoreResult.total
        };

        const vetoResult = applyVetoes(vetoContext);

        // ── Step 4: Agent agreement count ────────────────────────────────────
        const techAgrees  = techOutput?.technical_decision === 'CANDIDATE';
        const macroAgrees = macroOutput?.macro_decision === 'PROCEED';
        const riskAgrees  = riskOutput?.risk_decision === 'APPROVED';
        const agreeCount  = [techAgrees, macroAgrees, riskAgrees].filter(Boolean).length;
        const agreeStr    = `${agreeCount}/3 agents agree`;

        // ── Step 5: Decision cascade ──────────────────────────────────────────
        let finalAction;

        // Hard cascade
        if (macroOutput?.event_risk_level === 'HIGH') {
            finalAction = 'WAIT';
        } else if (scoreResult.total < 60) {
            finalAction = 'REJECTED';
        } else if (scoreResult.total < 75) {
            finalAction = 'WAIT';
        } else if (vetoResult.vetoed) {
            // Score ≥ 75 but veto failed — check severity
            const hardVetoes = vetoResult.vetoes.filter(v =>
                v === 'RR_MINIMUM' || v === 'SETUP_UNCLASSIFIED' ||
                v === 'HIGH_EVENT_RISK' || v === 'SENTIMENT_ONLY' ||
                v === 'NO_STOP_LOSS' || v === 'NO_INVALIDATION'
            );
            finalAction = hardVetoes.length > 0 ? 'REJECTED' : 'WAIT';
        } else if (!techOutput?.setup_type) {
            finalAction = 'WAIT';
        } else if (!triggerActive) {
            finalAction = 'WATCHLIST';
        } else {
            // All clear — direction based on technical bias
            const bias = techOutput?.technical_bias;
            finalAction = bias === 'BULLISH' ? 'BUY'
                        : bias === 'BEARISH' ? 'SELL'
                        : 'WAIT'; // neutral bias can't produce BUY/SELL
        }

        // ── Step 6: Confidence (0-100) ────────────────────────────────────────
        let confidence = scoreResult.total;
        if (vetoResult.vetoed)     confidence = Math.min(confidence, 64);
        if (agreeCount === 3)     confidence = Math.min(100, confidence + 5);
        if (agreeCount === 1)     confidence = Math.min(confidence, 70);
        if (finalAction === 'BUY' || finalAction === 'SELL') {
            confidence = Math.min(88, confidence); // cap at 88 — never claim certainty
        }

        // ── Step 7: Build cases ───────────────────────────────────────────────
        const bullishCase = buildCase(techOutput, macroOutput, 'BULLISH');
        const bearishCase = buildCase(techOutput, macroOutput, 'BEARISH');

        const invalidationCase = context.invalidationLevel
            ? `Trade invalidated if price closes beyond ${context.invalidationLevel}`
            : techOutput?.invalidation_level
                ? `Trade invalidated if price closes beyond ${techOutput.invalidation_level}`
                : 'No clear invalidation defined';

        // Merge all why_trade / why_not_trade from agents
        const allWhyTrade = [
            ...(techOutput?.why_trade || []),
            ...(macroOutput?.why_trade || []),
            ...(riskOutput?.why_trade || [])
        ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);

        const allWhyNot = [
            ...(techOutput?.why_not_trade || []),
            ...(macroOutput?.why_not_trade || []),
            ...(riskOutput?.why_not_trade || []),
            ...vetoResult.reasons
        ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);

        // ── Build needed_confirmation ─────────────────────────────────────────
        const neededConfirmations = [
            ...(techOutput?.needed_confirmation || []),
            ...(macroOutput?.needed_confirmation || [])
        ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);

        // ── Final summary ─────────────────────────────────────────────────────
        const finalSummary = buildFinalSummary(finalAction, scoreResult, agreeCount, vetoResult);

        return {
            symbol,
            final_action:        finalAction,
            confidence:          Math.round(confidence),
            setup_type:          techOutput?.setup_type || null,
            setup_label:         techOutput?.setup_label || 'None',
            total_score:         scoreResult.total,
            score_breakdown:     scoreResult.breakdown,
            score_formatted:     formatScoreBreakdown(scoreResult.breakdown),
            score_label:         scoreResult.label,
            agreement_summary:   agreeStr,
            tech_agrees:         techAgrees,
            macro_agrees:        macroAgrees,
            risk_agrees:         riskAgrees,
            veto_passed:         !vetoResult.vetoed,
            veto_summary:        vetoResult.vetoed ? vetoResult.reasons : [],
            veto_warnings:       vetoResult.categories || [],
            why_trade:           allWhyTrade,
            why_not_trade:       allWhyNot,
            bullish_case:        bullishCase,
            bearish_case:        bearishCase,
            invalidation_case:   invalidationCase,
            needed_confirmation: neededConfirmations,
            final_summary:       finalSummary,
            // Pass-through from agents
            entry_zone:          techOutput?.valid_entry_zone,
            invalidation_level:  techOutput?.invalidation_level,
            session:             techOutput?.session_fit,
            trend_4h:            techOutput?.trend_state_4H,
            trend_1h:            techOutput?.trend_state_1H,
            structure:           techOutput?.structure_state,
            fvg:                 techOutput?.fvg_state,
            sweep:               techOutput?.liquidity_map,
            event_risk:          macroOutput?.event_risk_level,
            rr_value:            riskOutput?.rr_value,
            position_size:       riskOutput?.position_size,
            dollar_risk:         riskOutput?.dollar_risk,
            run_duration_ms:     Date.now() - startTime
        };

    } catch (err) {
        return {
            final_action:    'ERROR',
            confidence:      0,
            total_score:     0,
            error_message:   `Synthesis failed: ${err.message}`,
            why_not_trade:   ['Synthesis agent error — using fallback'],
            run_duration_ms: Date.now() - startTime
        };
    }
}

function buildCase(techOutput, macroOutput, direction) {
    const parts = [];
    const trend = techOutput?.trend_state_4H;

    if (direction === 'BULLISH') {
        if (trend === 'BULLISH') parts.push('4H trend is bullish');
        if (techOutput?.fvg_state?.type === 'bullish') parts.push('Bullish FVG in entry zone');
        if (techOutput?.liquidity_map?.swept) parts.push('Liquidity sweep completed');
        if (macroOutput?.macro_bias === 'BULLISH') parts.push('Macro regime supportive');
    } else {
        if (trend === 'BEARISH') parts.push('4H trend is bearish');
        if (techOutput?.fvg_state?.type === 'bearish') parts.push('Bearish FVG in entry zone');
        if (techOutput?.structure_state === 'LH_LL') parts.push('Lower high/lower low structure');
        if (macroOutput?.macro_bias === 'BEARISH') parts.push('Macro regime bearish');
    }

    return parts.length ? parts.join(' | ') : 'Insufficient evidence for this case';
}

function buildFinalSummary(action, scoreResult, agreeCount, vetoResult) {
    const scoreLabel = scoreResult.label;
    const vetoNote = !vetoResult.vetoed ? 'all vetoes cleared' : `${vetoResult.vetoCount} veto(s) blocked`;

    switch (action) {
        case 'BUY':
        case 'SELL':
            return `${action} signal confirmed — Score: ${scoreResult.total}/100 (${scoreLabel}), ${agreeCount}/3 agents agree, ${vetoNote}`;
        case 'WATCHLIST':
            return `Setup identified but trigger not yet active — monitor for entry signal. Score: ${scoreResult.total}/100`;
        case 'WAIT':
            return `Conditions insufficient — Score: ${scoreResult.total}/100. ${vetoNote}. Wait for better setup.`;
        case 'REJECTED':
            return `Trade rejected — Score: ${scoreResult.total}/100, ${vetoNote}. Do not pursue this setup.`;
        default:
            return `Analysis complete — action: ${action}`;
    }
}

function buildFinal({ final_action, confidence, veto_summary, why_not_trade, why_trade,
                       agreement_summary, setup_type, total_score, startTime }) {
    return {
        final_action, confidence, setup_type,
        total_score,
        agreement_summary,
        veto_summary,
        veto_passed: false,
        why_trade,
        why_not_trade,
        final_summary: `${final_action} — ${veto_summary?.[0] || 'blocked'}`,
        run_duration_ms: Date.now() - startTime
    };
}

module.exports = { runSynthesisAgent };
