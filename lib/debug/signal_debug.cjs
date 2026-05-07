/**
 * signal_debug.cjs — OpenClaw Admin Debug Mode
 *
 * Used by /signal SYMBOL debug command.
 * Runs the full orchestrator and returns a detailed
 * breakdown for admin use only (never shown to regular users).
 *
 * Output includes:
 *   - run_id
 *   - Stage timings
 *   - Each veto that fired
 *   - Each gate that passed/failed
 *   - Score breakdown
 *   - Provider health at time of run
 *   - Full synthesis output
 */
'use strict';

const { verify, formatVerificationSummary } = require('../verification/signal_verifier.cjs');
const { applyVetoes, formatVetoSummary }    = require('../veto/veto_engine.cjs');
const { getAllHealth }                       = require('../providers/provider_registry.cjs');
const { getRecentErrors }                   = require('../errors/error_classifier.cjs');

/**
 * formatDebugReport(orchResult) → Telegram-safe debug string for admin
 */
function formatDebugReport(orchResult) {
    const {
        run_id, symbol, final_action, total_score, confidence,
        setup_type, verification_state, veto_result, failed_gates,
        run_duration_ms, error_count, agent_outputs, session_at_signal
    } = orchResult;

    const lines = [];

    // ── Header ───────────────────────────────────────────────────────────────
    lines.push(`🔬 *Debug: ${symbol || '?'}* (admin)`);
    lines.push(`\`run_id: ${run_id || 'N/A'}\``);
    lines.push(`\`${new Date().toISOString().substring(0,16).replace('T',' ')} UTC\``);
    lines.push('');

    // ── Final Decision ────────────────────────────────────────────────────────
    const actionIcon = { BUY:'🟢', SELL:'🔴', WAIT:'⏳', WATCHLIST:'👁', REJECTED:'❌', ERROR:'⚠️' };
    lines.push(`*Decision:* ${actionIcon[final_action] || '?'} \`${final_action}\``);
    lines.push(`*Score:* \`${total_score}/100\` | *Confidence:* \`${confidence}/88\``);
    lines.push(`*Setup:* \`${setup_type || 'N/A'}\``);
    lines.push(`*Session:* \`${session_at_signal || 'N/A'}\``);
    lines.push(`*Duration:* \`${run_duration_ms || 0}ms\` | *Errors in run:* \`${error_count || 0}\``);
    lines.push('');

    // ── Verification State ────────────────────────────────────────────────────
    lines.push(`*Verification:* \`${verification_state || 'not run'}\``);
    if (failed_gates && failed_gates.length > 0) {
        lines.push('*Failed Gates:*');
        failed_gates.slice(0, 5).forEach(g => lines.push(`  ❌ \`${g.gate}\`: ${g.reason || ''}`));
    } else {
        lines.push('*Gates:* ✅ All passed');
    }
    lines.push('');

    // ── Veto Result ───────────────────────────────────────────────────────────
    if (veto_result?.vetoed) {
        lines.push('*Vetoes Fired:*');
        (veto_result.vetoes || []).forEach((v, i) => {
            lines.push(`  🚫 \`${v}\`: ${veto_result.reasons?.[i] || ''}`);
        });
    } else {
        lines.push('*Vetoes:* ✅ None fired');
    }
    lines.push('');

    // ── Technical Agent ───────────────────────────────────────────────────────
    const tech = agent_outputs?.technical;
    if (tech) {
        lines.push('*Technical Agent:*');
        lines.push(`  Decision: \`${tech.technical_decision || '?'}\` | Score: \`${tech.technical_score || 0}\``);
        lines.push(`  Trend 4H: \`${tech.trend_state_4H || '?'}\` | RSI: \`${tech.rsi || '?'}\` | ADX: \`${tech.adx || '?'}\``);
        lines.push(`  FVG: \`${tech.fvg_state?.gapFound ? 'Yes' : 'No'}\` | Liquidity: \`${tech.liquidity_context?.type || 'None'}\``);
        lines.push('');
    }

    // ── Macro Agent ───────────────────────────────────────────────────────────
    const macro = agent_outputs?.macro;
    if (macro) {
        lines.push('*Macro Agent:*');
        lines.push(`  Decision: \`${macro.macro_decision || '?'}\` | Event Risk: \`${macro.event_risk_level || '?'}\``);
        lines.push(`  Score: \`${macro.macro_score || 0}\` | Bias: \`${macro.macro_bias || '?'}\``);
        lines.push('');
    }

    // ── Risk Agent ────────────────────────────────────────────────────────────
    const risk = agent_outputs?.risk;
    if (risk) {
        lines.push('*Risk Agent:*');
        lines.push(`  Decision: \`${risk.risk_decision || '?'}\` | R:R: \`${risk.rr_value || 0}\``);
        lines.push(`  Stop: \`${risk.stop_validation || '?'}\` | Size: \`${risk.position_size || '?'}\``);
        lines.push('');
    }

    // ── Provider Health ───────────────────────────────────────────────────────
    const providers = getAllHealth().filter(p => p.provider?.tier === 'free');
    const healthy   = providers.filter(p => p.healthy).length;
    lines.push(`*Providers at run:* ${healthy}/${providers.length} healthy`);
    providers.filter(p => !p.healthy).forEach(p => lines.push(`  ❌ \`${p.name}\`${p.lastError ? ': ' + p.lastError.substring(0,40) : ''}`));
    lines.push('');

    // ── Recent Errors ─────────────────────────────────────────────────────────
    const recentErrs = getRecentErrors(5);
    if (recentErrs.length > 0) {
        lines.push('*Recent System Errors (last 5):*');
        recentErrs.slice(0,3).forEach(e => {
            const age = Math.round((Date.now() - new Date(e.timestamp).getTime())/60000);
            lines.push(`  ${e.severity==='HIGH'?'🔴':'🟡'} [${age}m] ${e.error_class}: ${e.human_summary.substring(0,50)}`);
        });
    }

    lines.push('');
    lines.push('_Admin debug — not for regular users_');

    return lines.join('\n');
}

module.exports = { formatDebugReport };
