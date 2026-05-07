/**
 * watchlist-formatter.cjs — WATCHLIST message formatter v4.0
 * Spec format: Asset/Action WATCHLIST/Setup Type/Trigger Zone/What To Wait For/
 *              Invalidation Before Trigger/Session Priority
 */
"use strict";

const toArr = v => Array.isArray(v) ? v : (v ? String(v).split(' | ').filter(Boolean) : []);

function formatWatchlistMessage(symbol, synthesis) {
    const setupLabel = synthesis.setup_label || synthesis.setup_type || "Setup Forming";
    const entryZone  = synthesis.entry_zone || synthesis.invalidation_level || "—";
    const invalidation = synthesis.invalidation_level || "—";
    const neededConf = toArr(synthesis.needed_confirmation);
    const whatToWait = neededConf.length
        ? neededConf.slice(0, 3).map(c => `  • ${c}`).join("\n")
        : "  • Trigger not yet active — monitor for entry signal";

    // Map setup type to best session
    const SESSION_MAP = {
        london_sweep_reversal:  'London Open (07:00-08:00 UTC)',
        ny_continuation:        'NY Open (12:00-13:00 UTC)',
        ema_pullback_fvg:       'London or NY session',
        range_sweep_trap:       'London or NY session',
        trend_breakout_retest:  'London or NY session'
    };
    const sessionPriority = SESSION_MAP[(synthesis.setup_type || '').toLowerCase()] ||
        (typeof synthesis.session === 'string' ? synthesis.session.replace(/_/g, " ") : 'London/NY');

    return [
        `📋 *${symbol} — WATCHLIST*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📊 Asset: ${symbol}`,
        `👁 Action: *WATCHLIST*`,
        `🎯 Setup Type: ${setupLabel}`,
        `📊 Score: ${synthesis.total_score || 0}/100 | Confidence: ${synthesis.confidence || 0}/100`,
        ``,
        `📍 *Trigger Zone:* \`${entryZone}\``,
        `🔍 *What To Wait For:*`,
        whatToWait,
        ``,
        `🚫 *Invalidation Before Trigger:* \`${invalidation}\``,
        `🕐 *Session Priority:* ${sessionPriority}`,
        ``,
        `_Setup structure exists. Trigger not yet active. Monitor closely._`
    ].join("\n");
}
module.exports = { formatWatchlistMessage };
