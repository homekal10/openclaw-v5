/**
 * wait-formatter.cjs — WAIT message formatter v4.0
 * Spec format: Asset/Action/Setup Type/Reason/Main Conflict/Needed Confirmation/Event Risk/Watch Level
 */
"use strict";

const toArr = v => Array.isArray(v) ? v : (v ? String(v).split(' | ').filter(Boolean) : []);

function formatWaitMessage(symbol, synthesis) {
    const setupLabel = synthesis.setup_label || synthesis.setup_type || "None Confirmed";
    const whyNot     = toArr(synthesis.why_not_trade);
    const vetoes     = toArr(synthesis.veto_summary);
    const topReason  = whyNot[0] || vetoes[0] || "Conditions not met";
    const mainConflict = vetoes[0] || whyNot[0] || topReason;
    const neededConf = toArr(synthesis.needed_confirmation).slice(0, 2).join(" | ") || "Awaiting setup completion";
    const eventRisk  = synthesis.event_risk || "Low";
    const watchLevel = synthesis.entry_zone || synthesis.invalidation_level || "—";
    const session    = typeof synthesis.session === 'string'
        ? synthesis.session.replace(/_/g, " ")
        : synthesis.session?.current?.replace(/_/g, " ") || "unknown";

    return [
        `⏳ *${symbol} — WAIT*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📊 Asset: ${symbol}`,
        `⏸ Action: *WAIT*`,
        `🎯 Setup Type: ${setupLabel}`,
        `📊 Score: ${synthesis.total_score || 0}/100`,
        `🕐 Session: ${session}`,
        ``,
        `❌ *Reason:* ${topReason}`,
        `⚠️ *Main Conflict:* ${mainConflict}`,
        `🔍 *Needed Confirmation:* ${neededConf}`,
        `📅 *Event Risk:* ${eventRisk}`,
        `👁 *Watch Level:* \`${watchLevel}\``,
        ``,
        `_Do not enter. Conditions insufficient for institutional execution._`
    ].join("\n");
}
module.exports = { formatWaitMessage };
