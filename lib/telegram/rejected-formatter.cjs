/**
 * rejected-formatter.cjs — REJECTED message formatter v4.0
 * Spec format: Asset/Action REJECTED/Reason/Missing Criteria/Do Not Trade Because
 */
"use strict";

const toArr = v => Array.isArray(v) ? v : (v ? String(v).split(' | ').filter(Boolean) : []);

function formatRejectedMessage(symbol, synthesis) {
    const vetoes   = toArr(synthesis.veto_summary);
    const whyNot   = toArr(synthesis.why_not_trade);
    const blockers = toArr(synthesis.blockers);
    const allReasons = [...vetoes, ...whyNot, ...blockers]
        .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

    const topReason = allReasons[0] || 'Does not meet institutional quality threshold';
    const missing   = allReasons.slice(0, 4).map(v => `  • ${v}`).join('\n') || '  • Multiple criteria missing';

    // Build the "Do Not Trade Because" — the key reasons
    const doNotTrade = [];
    if (allReasons.some(r => /ADX|trend.*weak/i.test(r))) doNotTrade.push('Trend strength insufficient');
    if (allReasons.some(r => /R:R|reward|risk/i.test(r)))  doNotTrade.push('Risk-reward below minimum');
    if (allReasons.some(r => /sweep|liquidity/i.test(r)))  doNotTrade.push('No liquidity event');
    if (allReasons.some(r => /FVG|imbalance/i.test(r)))    doNotTrade.push('No fair value gap in entry zone');
    if (allReasons.some(r => /chase|overbought|oversold/i.test(r))) doNotTrade.push('Chase entry — wait for pullback');
    if (allReasons.some(r => /session|off.hour/i.test(r))) doNotTrade.push('Session not appropriate');
    if (allReasons.some(r => /event|macro|CPI|FOMC/i.test(r))) doNotTrade.push('High-impact event risk');
    if (allReasons.some(r => /setup.*unclassified|not.*approved/i.test(r))) doNotTrade.push('No approved setup pattern');
    if (allReasons.some(r => /sentiment/i.test(r))) doNotTrade.push('Signal based on sentiment only');
    if (!doNotTrade.length) doNotTrade.push(topReason);

    const doNotTradeStr = doNotTrade.slice(0, 3).map(d => `  • ${d}`).join('\n');

    return [
        `🚫 *${symbol} — REJECTED*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📊 Asset: ${symbol}`,
        `❌ Action: *REJECTED*`,
        `📊 Score: ${synthesis.total_score || 0}/100 (minimum 75 for execution)`,
        ``,
        `❌ *Reason:* ${topReason}`,
        ``,
        `📋 *Missing Criteria:*`,
        missing,
        ``,
        `🚫 *Do Not Trade Because:*`,
        doNotTradeStr,
        ``,
        `_This setup does not meet institutional quality standards. Stand aside._`
    ].join('\n');
}
module.exports = { formatRejectedMessage };
