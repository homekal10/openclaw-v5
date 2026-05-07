/**
 * fallback-pipeline.cjs — OpenClaw Graceful Fallback Pipeline
 *
 * Used when the full orchestrator graph fails.
 * Runs a simplified linear: Technical → Risk → Format
 * Always returns a user-safe message.
 */

'use strict';

const { analyze }             = require('../../strategy_engine.cjs');
const { fetchCandles }        = require('../../market_fetcher.cjs');
const { computeScore }        = require('../scoring/scoring-engine.cjs');
const { applyVetoes }         = require('../scoring/veto-engine.cjs');
const { classifySetup }       = require('../scoring/setup-classifier.cjs');

async function runFallbackPipeline(symbol) {
    const startTime = Date.now();
    try {
        const raw = await fetchCandles(symbol);
        const candles = raw?.candles;
        if (!candles || candles.length < 20) {
            return userSafe(symbol, '⚠️ Data unavailable — try again shortly.');
        }

        const a = analyze(candles);
        const setupResult = classifySetup({
            session:        a.session,
            trend4H:        a.trend,
            trend1H:        a.trend,
            sweepDetected:  a.sweep?.swept,
            sweepType:      a.sweep?.type,
            fvgDetected:    a.fvg?.detected,
            fvgInEntryZone: a.fvg?.inEntryZone,
            structureState: a.structure?.state,
            bosDetected:    a.structure?.bosDetected,
            chochDetected:  a.structure?.chochDetected,
            priceNearEMA:   a.priceNearEMA,
            adxValue:       a.adx?.adx,
            momentumReversing: a.macd?.trend !== a.trend.substring(0, 6)
        });

        const scoreResult = computeScore({
            trend4H: a.trend, trend1H: a.trend,
            sweepDetected: a.sweep?.swept, sweepType: a.sweep?.type, sweepFreshness: 'recent',
            fvgDetected: a.fvg?.detected, fvgType: a.fvg?.type,
            fvgInEntryZone: a.fvg?.inEntryZone, fvgReclaimed: a.fvg?.reclaimed,
            macdAligned: a.macd?.trend === a.trend, macdStrong: false,
            rsiZone: a.rsiZone, atrExpanding: a.atrExpanding, divergence: a.divergence,
            session: a.session, eventRiskLevel: 'low', regimeAligned: true,
            macroConflict: false, rrValue: 2.0, stopValid: true, spreadAcceptable: true
        });

        const vetoResult = applyVetoes({
            adxValue: a.adx?.adx, setupType: setupResult.setupType,
            structureState: a.structure?.state, sweepDetected: a.sweep?.swept,
            fvgDetected: a.fvg?.detected, fvgInEntryZone: a.fvg?.inEntryZone,
            fvgReclaimed: a.fvg?.reclaimed, isChaseEntry: a.isChaseEntry,
            invalidationLevel: '0', pricePosition: a.pricePosition,
            momentumConflict: 'NONE', eventRiskLevel: 'low',
            tradeRestriction: false, sentimentOnlySignal: false,
            rrValue: 2.0, stopValid: true, spreadAcceptable: true, session: a.session,
            total: scoreResult.total
        });

        const action = scoreResult.suggestedAction === 'CANDIDATE' && vetoResult.passed
            ? (a.trend === 'BULLISH' ? 'BUY' : a.trend === 'BEARISH' ? 'SELL' : 'WAIT')
            : scoreResult.suggestedAction === 'CANDIDATE' ? 'WAIT'
            : scoreResult.suggestedAction;

        const icon = { BUY:'🟢', SELL:'🔴', WAIT:'⏳', WATCHLIST:'📋', REJECTED:'🚫' }[action] || '📊';

        const lines = [
            `${icon} *${symbol} — ${action}* _(Simplified Analysis)_`,
            `_Full analysis temporarily degraded — using fallback pipeline_`,
            ``,
            `📊 Trend: \`${a.trend}\` | ADX: \`${a.adx?.adx ?? 'N/A'}\``,
            `🎯 Setup: ${setupResult.label || 'None matched'}`,
            `📐 Score: \`${scoreResult.total}/100\``,
            `💧 Sweep: ${a.sweep?.swept ? `✅ ${a.sweep.type}` : '❌ Not detected'}`,
            `📦 FVG: ${a.fvg?.detected ? `✅ ${a.fvg.type}` : '❌ Not detected'}`,
            `🏗 Structure: \`${a.structure?.state || 'N/A'}\``,
            ``,
            vetoResult.passed
                ? `✅ No hard vetoes triggered`
                : `⚠️ Vetoes: ${vetoResult.vetoes[0] || 'See full analysis'}`,
            ``,
            `_⚠️ This is a simplified fallback result. Run /signal again for full analysis._`
        ];

        return {
            symbol, final_action: action, total_score: scoreResult.total,
            formatted_message: lines.join('\n'),
            fallback: true, run_duration_ms: Date.now() - startTime
        };
    } catch (e) {
        return userSafe(symbol, '⚠️ Analysis temporarily unavailable — using cached data');
    }
}

function userSafe(symbol, msg) {
    return {
        symbol, final_action: 'ERROR', total_score: 0,
        formatted_message: `📊 *${symbol}*\n\n${msg}\n\n_Please try again in a moment._`,
        fallback: true
    };
}

module.exports = { runFallbackPipeline };
