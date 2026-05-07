/**
 * orchestrator.cjs — OpenClaw Master Orchestrator
 *
 * Coordinates: Technical → Macro → Risk → Synthesis
 * Gracefully degrades if any agent fails.
 * NEVER surfaces raw errors to users.
 *
 * Usage:
 *   const { runOrchestrator } = require('./orchestrator.cjs');
 *   const result = await runOrchestrator('XAUUSD', options);
 */

'use strict';

const path = require('path');
const { fetchCandles }         = require('../../market_fetcher.cjs');
const { fetchAllNews }         = require('../../news_collector.cjs');
const { runTechnicalAgent }    = require('../agents/technical-agent.cjs');
const { runMacroAgent }        = require('../agents/macro-agent.cjs');
const { runRiskAgent }         = require('../agents/risk-agent.cjs');
const { runSynthesisAgent }    = require('../agents/synthesis-agent.cjs');
const { formatSignalMessage }  = require('../telegram/signal-formatter.cjs');
const { analyze }              = require('../../strategy_engine.cjs');
const { saveSignalSnapshot }   = require('../storage/signal-store.cjs');
const { applyVetoes }          = require('../veto/veto_engine.cjs');
const { verify, resolveAction }= require('../verification/signal_verifier.cjs');
const { RunContext, STAGES }   = require('../errors/error_classifier.cjs');

// Internal log only — never surface to users
function logInternal(tag, msg, data = '') {
    const line = `[${new Date().toISOString()}] [ORCH:${tag}] ${msg}`;
    console.log(line, data ? JSON.stringify(data).substring(0, 200) : '');
}

/**
 * runOrchestrator(symbol, options) → OrchestrationResult
 *
 * @param {string} symbol   e.g. 'XAUUSD', 'BTC', 'EURUSD'
 * @param {Object} options
 * @param {number} options.accountSize     optional
 * @param {string} options.direction       'LONG' | 'SHORT' | 'AUTO' (default AUTO)
 * @param {boolean} options.forceAnalysis  skip session/time filters if true
 */
async function runOrchestrator(symbol, options = {}) {
    const ctx       = new RunContext('orch', symbol, options.command || '/signal');
    const startTime = ctx.startMs;
    logInternal('START', `[${ctx.runId}] Running orchestration for ${symbol}`);

    try {
        // ── Phase 1: Data Collection ─────────────────────────────────────────
        let candles4H, candles1H, candles1D, headlines;

        try {
            // Fetch candles — Yahoo returns daily by default; for multi-TF, use same candles
            // with different slice windows as a practical approximation
            const primary = await fetchCandles(symbol).catch(e => {
                logInternal('DATA_WARN', `Primary fetch failed: ${e.message}`);
                return null;
            });

            // Use same candle array, sliced differently for each TF proxy
            if (primary?.candles) {
                candles1D = primary;
                // 4H proxy: last 90 candles of daily = roughly 90 days = 540 4H bars
                candles4H = { candles: primary.candles.slice(-90), display: primary.display };
                // 1H proxy: last 30 candles
                candles1H = { candles: primary.candles.slice(-30), display: primary.display };
            }
        } catch (e) {
            logInternal('DATA_ERROR', `Candle fetch failed for ${symbol}`, e.message);
        }


        const primaryCandles = candles4H?.candles || candles1H?.candles || candles1D?.candles;
        if (!primaryCandles || primaryCandles.length < 20) {
            return buildUserSafeError(symbol, 'Insufficient market data — please try again shortly', startTime);
        }

        try {
            const newsResult = await fetchAllNews(symbol).catch(() => null);
            headlines = newsResult?.headlines || newsResult || [];
        } catch (e) {
            logInternal('NEWS_ERROR', 'News fetch failed', e.message);
            headlines = [];
        }

        // ── Phase 2: Technical Agent ──────────────────────────────────────────
        let techOutput;
        try {
            techOutput = await runTechnicalAgent(
                symbol,
                candles4H?.candles || primaryCandles,
                candles1H?.candles || null,
                null // 15M optional
            );
            logInternal('TECH', techOutput.technical_decision, {
                setup: techOutput.setup_type,
                score: techOutput.technical_score
            });
        } catch (e) {
            logInternal('TECH_ERROR', 'Technical agent failed', e.message);
            techOutput = { technical_decision: 'ERROR', why_not_trade: ['Technical analysis unavailable'], blockers: [], technical_score: 0 };
        }

        // Early exit: Technical agent hard rejected
        if (techOutput.technical_decision === 'REJECTED' && techOutput.blockers?.length >= 3) {
            logInternal('EARLY_EXIT', 'Technical rejected — skipping macro/risk');
            const { formatRejectedMessage } = require('../telegram/rejected-formatter.cjs');
            return {
                symbol,
                run_id:             ctx.runId,
                final_action:       'REJECTED',
                total_score:        techOutput.technical_score || 0,
                confidence:         0,
                setup_type:         techOutput.setup_type,
                verification_state: 'REJECTED_TECHNICAL',
                why_not_trade:      techOutput.why_not_trade,
                veto_summary:       techOutput.blockers,
                error_count:        ctx.errors.length,
                formatted_message:  formatRejectedMessage(symbol, techOutput),
                run_duration_ms:    Date.now() - startTime,
                agent_outputs:      { technical: techOutput }
            };
        }

        // ── Phase 3: Macro Agent ──────────────────────────────────────────────
        let macroOutput;
        try {
            macroOutput = await runMacroAgent(symbol, headlines, {
                expectedBias: techOutput.technical_bias
            });
            logInternal('MACRO', macroOutput.macro_decision, {
                eventRisk: macroOutput.event_risk_level,
                score: macroOutput.macro_score
            });
        } catch (e) {
            logInternal('MACRO_ERROR', 'Macro agent failed — using neutral', e.message);
            macroOutput = {
                macro_decision: 'PROCEED', trade_restriction: false,
                macro_score: 5, event_risk_level: 'LOW',
                macro_bias: 'NEUTRAL', why_trade: [], why_not_trade: ['Macro data unavailable']
            };
        }

        // ── Phase 4: Build entry/stop/TP ─────────────────────────────────────
        let entryParams;
        try {
            const analysis = analyze(primaryCandles);
            const isBull   = techOutput.technical_bias === 'BULLISH';
            const atr      = analysis.atr;
            const price    = analysis.currentPrice;

            // Simple institutional entry model
            const fvg = techOutput.fvg_state;
            const entryPrice = fvg?.inEntryZone
                ? (fvg.gapLow + fvg.gapHigh) / 2
                : price;

            const stopLoss   = isBull
                ? parseFloat((entryPrice - atr * 1.5).toFixed(5))
                : parseFloat((entryPrice + atr * 1.5).toFixed(5));

            const tp1 = isBull
                ? parseFloat((entryPrice + atr * 3.0).toFixed(5))
                : parseFloat((entryPrice - atr * 3.0).toFixed(5));

            const tp2 = isBull
                ? parseFloat((entryPrice + atr * 5.0).toFixed(5))
                : parseFloat((entryPrice - atr * 5.0).toFixed(5));

            entryParams = {
                entryPrice, stopLoss, takeProfit1: tp1, takeProfit2: tp2,
                direction: isBull ? 'LONG' : 'SHORT',
                atr, symbol,
                accountSize:       options.accountSize,
                invalidationLevel: techOutput.invalidation_level,
                eventRiskLevel:    macroOutput.event_risk_level
            };
        } catch (e) {
            logInternal('ENTRY_CALC_ERROR', 'Entry calc failed', e.message);
            entryParams = { entryPrice: 0, stopLoss: 0, takeProfit1: 0, symbol, direction: 'LONG' };
        }

        // ── Phase 5: Risk Agent ───────────────────────────────────────────────
        let riskOutput;
        try {
            riskOutput = await runRiskAgent(entryParams);
            logInternal('RISK', riskOutput.risk_decision, { rr: riskOutput.rr_value });
        } catch (e) {
            logInternal('RISK_ERROR', 'Risk agent failed', e.message);
            riskOutput = {
                risk_decision: 'CAUTION', risk_score: 5,
                rr_value: 0, stop_validation: 'UNKNOWN',
                why_not_trade: ['Risk validation unavailable']
            };
        }

        // ── Phase 6: Synthesis Agent ──────────────────────────────────────────
        let synthesis;
        try {
            synthesis = await runSynthesisAgent(techOutput, macroOutput, riskOutput, {
                symbol,
                direction:         entryParams.direction,
                triggerActive:     techOutput.technical_decision === 'CANDIDATE',
                invalidationLevel: entryParams.invalidationLevel
            });
            logInternal('SYNTHESIS', synthesis.final_action, {
                score: synthesis.total_score, confidence: synthesis.confidence
            });
        } catch (e) {
            logInternal('SYNTH_ERROR', 'Synthesis failed — using fallback', e.message);
            return buildUserSafeError(symbol, 'Signal synthesis unavailable — try /signal again', startTime);
        }

        // ── Phase 6a: Hard Veto Layer ──────────────────────────────────
        ctx.stage(STAGES.VETO);
        let vetoResult = { vetoed: false, vetoes: [], warnings: [], reasons: [], summary: 'No vetoes', vetoCount: 0 };
        try {
            // Extract raw indicators from technical agent output
            const ind = techOutput.indicators || {};
            const sweep     = ind.sweep     || {};
            const fvg       = ind.fvg       || {};
            const structure = ind.structure || {};
            const macd      = ind.macd      || {};

            const signalForVeto = {
                // Setup identity
                setupType:          techOutput.setup_type,
                setup_type:         techOutput.setup_type,

                // Direction (needed by chase & momentum conflict vetoes)
                direction:          synthesis.final_action,
                final_action:       synthesis.final_action,

                // Technical indicators
                adx:                ind.adx?.adx ?? null,
                rsi:                ind.rsi ?? techOutput.rsi ?? null,
                atr:                ind.atr ?? entryParams.atr ?? null,
                trend4H:            ind.trend4H || techOutput.technical_bias?.toUpperCase() || 'UNKNOWN',
                trend1H:            ind.trend1H || ind.trend4H || 'UNKNOWN',
                structureState:     structure.state || 'UNKNOWN',
                incompleteStructure: structure.state === 'INSUFFICIENT_DATA' || structure.state === 'INSUFFICIENT_PIVOTS',
                sweepDetected:      sweep.swept === true,
                sweepType:          sweep.type || null,
                fvgDetected:        fvg.detected === true,
                fvgInEntryZone:     fvg.inEntryZone === true,
                fvgReclaimed:       fvg.reclaimed === true,
                pricePosition:      ind.pricePosition || 'UNKNOWN',
                priceInMidRange:    ind.pricePosition === 'MID_RANGE',
                isChaseEntry:       ind.isChaseEntry || false,
                invalidation:       techOutput.invalidation_level || entryParams.invalidationLevel,
                invalidation_level: techOutput.invalidation_level || entryParams.invalidationLevel,
                macdTrend:          macd.trend || null,
                divergence:         ind.divergence || 'NONE',

                // Stop distances for tight/wide vetoes
                sl_distance:        entryParams.stopLoss && entryParams.entryPrice
                    ? Math.abs(entryParams.entryPrice - entryParams.stopLoss) : 0,
                sl:                 entryParams.stopLoss,
                stopLoss:           entryParams.stopLoss,

                // Session
                session:            ind.session || ind.sessionQuality || 'unknown',

                // Macro
                eventRiskLevel:     macroOutput.event_risk_level || 'none',
                highEventRisk:      (macroOutput.event_risk_level || '').toLowerCase() === 'high',
                macroConflict:      macroOutput.macro_bias === 'CONFLICTING',
                tradeRestriction:   macroOutput.trade_restriction === true,

                // Risk
                rr:                 riskOutput.rr_value || 0,
                rrValue:            riskOutput.rr_value || 0,
                stopValid:          !!(entryParams.stopLoss && entryParams.stopLoss !== 0),
                spreadAcceptable:   true,

                // Data quality
                sentimentOnly:      false,
                onlySentimentSignal: false
            };

            vetoResult = applyVetoes(signalForVeto);

            logInternal('VETO', vetoResult.summary, {
                vetoed: vetoResult.vetoed,
                count: vetoResult.vetoCount,
                categories: vetoResult.categories
            });
            if (vetoResult.vetoed) {
                synthesis.final_action = 'REJECTED';
                synthesis.veto_summary = vetoResult.reasons.join(' | ');
                synthesis.why_not_trade = [...(synthesis.why_not_trade || []), ...vetoResult.reasons];
            }
        } catch (e) {
            logInternal('VETO_ERROR', 'Veto engine failed — skipping', e.message);
        }

        // ── Phase 6b: Signal Verifier ─────────────────────────────────
        ctx.stage(STAGES.VERIFICATION);
        let verificationResult = null;
        try {
            const signalForVerify = {
                ...synthesis,
                direction:    synthesis.final_action,
                rr:           riskOutput.rr_value,
                sl:           entryParams.stopLoss,
                stopLoss:     entryParams.stopLoss,
                invalidation: entryParams.invalidationLevel,
                setupType:    synthesis.setup_type,
                rsi:          techOutput.rsi,
                adx:          techOutput.adx,
                liquidity:    techOutput.liquidity_context?.type,
                fvg:          techOutput.fvg_state?.gapFound,
                structure:    { type: techOutput.structure_label }
            };
            verificationResult = verify(signalForVerify, {
                asset:        symbol,
                runId:        ctx.runId,
                vetoResult,
                session:      techOutput.session_fit?.current,
                highEventRisk: macroOutput.event_risk_level === 'HIGH',
                priceAgeMs:   0
            });
            // Verifier can downgrade action
            const resolvedAction = resolveAction(synthesis, verificationResult);
            if (resolvedAction !== synthesis.final_action) {
                logInternal('VERIFY', `Action downgraded: ${synthesis.final_action} → ${resolvedAction}`);
                synthesis.final_action = resolvedAction;
            }
            logInternal('VERIFY', verificationResult.state, { gates: verificationResult.criticalFails });
        } catch (e) {
            logInternal('VERIFY_ERROR', 'Verifier failed — proceeding without verification', e.message);
        }

        // ── Phase 7: Format output ────────────────────────────────────────────
        let formattedMessage;
        try {
            formattedMessage = formatSignalMessage(symbol, synthesis, entryParams);
        } catch (e) {
            logInternal('FORMAT_ERROR', 'Formatter failed', e.message);
            formattedMessage = buildFallbackMessage(symbol, synthesis);
        }

        const orchResult = {
            symbol,
            run_id:            ctx.runId,
            final_action:      synthesis.final_action,
            confidence:        synthesis.confidence,
            total_score:       synthesis.total_score,
            setup_type:        synthesis.setup_type,
            setup_label:       synthesis.setup_label,
            setup_confidence:  synthesis.setup_confidence || null,
            score_breakdown:   synthesis.score_breakdown  || null,
            why_trade:         synthesis.why_trade,
            why_not_trade:     synthesis.why_not_trade,
            veto_summary:      vetoResult.summary,
            veto_result:       vetoResult,
            verification_state:verificationResult?.state,
            failed_gates:      verificationResult?.failedGates || [],
            entry_price:       entryParams.entryPrice,
            stop_loss:         entryParams.stopLoss,
            take_profit_1:     entryParams.takeProfit1,
            take_profit_2:     entryParams.takeProfit2,
            rr_value:          riskOutput.rr_value,
            position_size:     riskOutput.position_size,
            dollar_risk:       riskOutput.dollar_risk,
            session:           techOutput.session_fit,
            session_at_signal: techOutput.session_fit?.current,
            trend_4h:          techOutput.trend_state_4H,
            invalidation:      techOutput.invalidation_level,
            event_risk:        macroOutput.event_risk_level,
            formatted_message: formattedMessage,
            run_duration_ms:   ctx.duration(),
            error_count:       ctx.errors.length,
            agent_outputs: {
                technical: techOutput,
                macro:     macroOutput,
                risk:      riskOutput,
                synthesis
            }
        };

        // Non-blocking Supabase save
        saveSignalSnapshot(orchResult, orchResult.agent_outputs).catch(e =>
            logInternal('STORE_WARN', `Signal snapshot not saved: ${e.message}`)
        );

        return orchResult;

    } catch (err) {
        logInternal('FATAL_ERROR', 'Orchestration failed', err.message);
        return buildUserSafeError(symbol, 'Analysis temporarily unavailable — using cached data', startTime);
    }
}

function buildUserSafeError(symbol, userMessage, startTime) {
    return {
        symbol,
        final_action:      'ERROR',
        confidence:        0,
        total_score:       0,
        formatted_message: `⚠️ *${symbol} Analysis*\n\n${userMessage}\n\n_Please try again in a moment._`,
        run_duration_ms:   Date.now() - startTime
    };
}

function buildFallbackMessage(symbol, synthesis) {
    const icons = { BUY:'🟢', SELL:'🔴', WAIT:'⏳', WATCHLIST:'📋', REJECTED:'🚫' };
    const icon  = icons[synthesis.final_action] || '📊';
    return `${icon} *${symbol} — ${synthesis.final_action}*\nScore: ${synthesis.total_score}/100\n${synthesis.final_summary || ''}`;
}

module.exports = { runOrchestrator };
