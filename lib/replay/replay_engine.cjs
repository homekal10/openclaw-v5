/**
 * replay_engine.cjs — OpenClaw v5.1 Signal Replay Engine
 *
 * Re-runs historical SignalSnapshot through current scoring/verifier.
 * Does NOT republish to Telegram. Compares old vs new decision.
 * Saves REPLAY_RESULT snapshot.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const snapStore = require('../snapshots/snapshot_store.cjs');

const LOG_PATH = path.join(__dirname, '../../logs/trading_log.json');

/**
 * replaySignal(signalId) — Re-run old signal through current logic.
 * @param {string} signalId - The signal's timestamp or run_id to replay
 * @returns {object} - Comparison result
 */
function replaySignal(signalId) {
    // Find the old signal in trading log
    let logs = [];
    try { logs = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return { error: 'Cannot read trading log' }; }

    const oldSignal = logs.find(l =>
        l.timestamp === signalId ||
        l.run_id === signalId ||
        (l.institutional_score && l.timestamp?.startsWith(signalId))
    );
    if (!oldSignal) return { error: `Signal "${signalId}" not found in log (${logs.length} entries)` };

    // Re-run through current verifier
    let currentVerification;
    try {
        const { verify } = require('../verification/signal_verifier.cjs');
        currentVerification = verify({
            setupType: oldSignal.setup_type || 'unknown',
            trend: oldSignal.trend || 'unknown',
            direction: oldSignal.signal || oldSignal.final_action || 'WAIT',
            score: oldSignal.score || oldSignal.institutional_score || 0,
            rr: oldSignal.rewardRisk || oldSignal.rr_value || 0,
            rsi: oldSignal.rsi || 50,
            stopLoss: oldSignal.sl,
            invalidation: oldSignal.sl,
            structure: oldSignal.structure || {},
            liquidity: oldSignal.liquidity || false,
            fvg: oldSignal.fvg || false,
        }, {
            asset: oldSignal.symbol,
            runId: `replay_${Date.now()}`
        });
    } catch(e) {
        currentVerification = { state: 'ERROR', reason: e.message };
    }

    // Re-run through current veto engine
    let currentVeto;
    try {
        const { applyVetoes } = require('../veto/veto_engine.cjs');
        currentVeto = applyVetoes({
            setupType: oldSignal.setup_type,
            direction: oldSignal.signal || oldSignal.final_action,
            rr: oldSignal.rewardRisk || oldSignal.rr_value || 0,
            rsi: oldSignal.rsi,
            stopLoss: oldSignal.sl,
            sl: oldSignal.sl,
            invalidation: oldSignal.sl,
            adx: oldSignal.adx,
            macdTrend: oldSignal.macdTrend
        });
    } catch(e) {
        currentVeto = { vetoed: false, vetoes: [], summary: 'Veto unavailable: ' + e.message };
    }

    const oldDecision = oldSignal.final_action || oldSignal.signal || 'UNKNOWN';
    const newDecision = currentVerification.state === 'VERIFIED_ACTIVE'
        ? (oldSignal.signal === 'BUY' || oldSignal.signal === 'SELL' ? oldSignal.signal : 'WAIT')
        : currentVerification.state === 'VERIFIED_WATCHLIST' ? 'WATCHLIST'
        : currentVerification.state === 'WAIT' ? 'WAIT' : 'REJECTED';

    const changed = oldDecision !== newDecision;

    const result = {
        signal_id: signalId,
        symbol: oldSignal.symbol,
        original_timestamp: oldSignal.timestamp,
        replay_timestamp: new Date().toISOString(),
        old_decision: oldDecision,
        new_decision: newDecision,
        decision_changed: changed,
        old_score: oldSignal.score || oldSignal.institutional_score || 0,
        old_rr: oldSignal.rewardRisk || oldSignal.rr_value || 0,
        old_engine: oldSignal.engine || 'unknown',
        current_verification: currentVerification,
        current_veto: currentVeto,
        diff_summary: changed
            ? `Decision changed: ${oldDecision} → ${newDecision}`
            : `Decision unchanged: ${oldDecision}`,
        // SAFETY: Never republish
        _republished: false,
        _telegram_sent: false
    };

    // Save to snapshot store
    try {
        snapStore.put('REPLAY_RESULT', oldSignal.symbol, null, result, {
            provider: 'replay_engine',
            source_timestamp: result.replay_timestamp
        });
    } catch {}

    return result;
}

/**
 * Format replay result for Telegram
 */
function formatReplayResult(result) {
    if (result.error) return `❌ *Replay Error:* ${result.error}`;

    const changeIcon = result.decision_changed ? '🔄' : '✅';
    return `🔁 *Signal Replay: ${result.symbol}*
_Original: ${result.original_timestamp}_
_Replayed: ${result.replay_timestamp}_

*Old Decision:* \`${result.old_decision}\` (${result.old_engine})
*New Decision:* \`${result.new_decision}\`
${changeIcon} *${result.diff_summary}*

*Old Score:* ${result.old_score}/100 | R:R: ${result.old_rr}:1
*Verification:* \`${result.current_verification?.state || 'N/A'}\`
*Veto:* ${result.current_veto?.summary || 'N/A'}

⚠️ _Replay only — NOT republished to Telegram_`;
}

/**
 * Get recent replay results from snapshot store.
 */
function getRecentReplays(n = 10) {
    try {
        return snapStore.getAll('REPLAY_RESULT').slice(-n);
    } catch { return []; }
}

module.exports = { replaySignal, formatReplayResult, getRecentReplays };
