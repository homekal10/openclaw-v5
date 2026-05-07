/**
 * signal-formatter.cjs — OpenClaw Telegram Signal Formatter v4.0
 *
 * Formats BUY/SELL/WAIT/WATCHLIST/REJECTED in institutional style.
 * Concise, mobile-readable, no hype, no certainty language.
 * Setup type on every signal. Score decomposition visible.
 */

'use strict';

const { formatScoreBreakdown } = require('../scoring/scoring-engine.cjs');

/**
 * formatSignalMessage(symbol, synthesis, entryParams) → string
 */
function formatSignalMessage(symbol, synthesis, entryParams = {}) {
    const action = synthesis.final_action;

    // Route to correct formatter
    if (action === 'WAIT')      return require('./wait-formatter.cjs').formatWaitMessage(symbol, synthesis);
    if (action === 'WATCHLIST') return require('./watchlist-formatter.cjs').formatWatchlistMessage(symbol, synthesis);
    if (action === 'REJECTED')  return require('./rejected-formatter.cjs').formatRejectedMessage(symbol, synthesis);

    // BUY or SELL — full institutional format
    const icon    = action === 'BUY' ? '🟢' : '🔴';

    const ep  = fmt(entryParams.entryPrice);
    const sl  = fmt(entryParams.stopLoss);
    const tp1 = fmt(entryParams.takeProfit1);
    const tp2 = fmt(entryParams.takeProfit2);
    const rr  = synthesis.rr_value ? `${synthesis.rr_value}:1` : '—';

    const scoreStr = synthesis.score_formatted ||
        (synthesis.score_breakdown ? formatScoreBreakdown(synthesis.score_breakdown) : `${synthesis.total_score}/100`);

    // Safe array helper
    const toArr = v => Array.isArray(v) ? v : (v ? String(v).split('\n').filter(Boolean) : []);

    const trend4H = synthesis.trend_4h || '—';
    const session = typeof synthesis.session === 'string'
        ? synthesis.session.replace(/_/g, ' ')
        : synthesis.session?.current?.replace(/_/g, ' ') || '—';
    const setupLabel = synthesis.setup_label || synthesis.setup_type || 'Unclassified';
    const bias = synthesis.agent_outputs?.technical?.technical_bias || action;

    const whyTrade     = toArr(synthesis.why_trade).slice(0, 3).map(w => `  • ${w}`).join('\n') || '  • Not specified';
    const invalidation = synthesis.invalidation_level || synthesis.invalidation || '—';
    const neededConf   = toArr(synthesis.needed_confirmation).slice(0, 2).join(' | ');
    const riskNote     = synthesis.event_risk ? `Event Risk: ${synthesis.event_risk}` : '';

    const posSize = synthesis.position_size
        ? `💰 Size: \`${synthesis.position_size}\` | Risk: \`$${synthesis.dollar_risk}\``
        : '';

    // Build message per spec format
    let msg = `${icon} *${symbol} — ${action}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Asset: ${symbol}\n`;
    msg += `⚡ Action: *${action}*\n`;
    msg += `📈 Bias: ${bias}\n`;
    msg += `🎯 Setup Type: ${setupLabel}\n`;
    msg += `🕐 Session: ${session}\n`;
    msg += `📐 Trend: 4H \`${trend4H}\`\n`;
    msg += `\n`;
    msg += `🔹 Entry: \`${ep}\`\n`;
    msg += `🛑 SL: \`${sl}\`\n`;
    msg += `✅ TP1: \`${tp1}\`\n`;
    msg += `🏆 TP2: \`${tp2}\`\n`;
    msg += `\n`;
    msg += `⚖️ R:R: *${rr}*\n`;
    msg += `💯 Confidence: *${synthesis.confidence}/100*\n`;
    msg += `📊 Score: *${synthesis.total_score}/100*\n`;
    msg += `\`${scoreStr}\`\n`;
    msg += `\n`;
    msg += `✅ *Why:*\n${whyTrade}\n`;
    msg += `🚫 *Invalidation:* \`${invalidation}\`\n`;
    if (neededConf) msg += `🔍 *Confirm:* ${neededConf}\n`;
    if (riskNote)   msg += `⚠️ ${riskNote}\n`;
    if (posSize)    msg += `${posSize}\n`;
    msg += `\n_${synthesis.agreement_summary || ''} | Not financial advice_`;

    return msg;
}

function fmt(price) {
    if (!price && price !== 0) return '—';
    return price > 100 ? price.toFixed(2) : price.toFixed(5);
}

module.exports = { formatSignalMessage };
