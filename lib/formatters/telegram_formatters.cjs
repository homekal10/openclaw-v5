/**
 * telegram_formatters.cjs — OpenClaw Institutional Signal Formatters
 *
 * Formats BUY/SELL, WAIT, WATCHLIST, REJECTED signals
 * for mobile-first Telegram delivery.
 *
 * Rules:
 * - Concise, mobile-readable
 * - No hype, no certainty language
 * - Analysis only, not financial advice
 * - Every output shows WHY
 */
'use strict';

// ─── Score Bar ─────────────────────────────────────────────────────────────────
function scoreBar(score, max = 100, width = 10) {
    const filled = Math.round((score / max) * width);
    return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

// ─── Confidence Tag ────────────────────────────────────────────────────────────
function confTag(confidence) {
    if (confidence >= 80) return '🟢 High';
    if (confidence >= 65) return '🟡 Medium';
    return '🔴 Low';
}

// ─── RR Display ────────────────────────────────────────────────────────────────
function rrDisplay(rr) {
    const v = parseFloat(rr || 0);
    return v >= 2.5 ? `✅ ${v.toFixed(2)}` : v >= 1.8 ? `✔️ ${v.toFixed(2)}` : `❌ ${v.toFixed(2)}`;
}

// ─── BUY / SELL Formatter ──────────────────────────────────────────────────────
function formatBuySell(signal) {
    const action = (signal.direction || signal.action || '').toUpperCase();
    const icon   = action === 'BUY' ? '🟢' : '🔴';
    const sym    = signal.asset || signal.symbol || '?';
    const score  = signal.score  || signal.total_score || 0;
    const conf   = Math.min(88, signal.confidence || 70);

    return `${icon} *${action}: ${sym}*

📋 *Setup:* \`${signal.setupType || signal.setup_type || 'N/A'}\`
✅ *Verification:* \`${signal.verificationState || 'VERIFIED_ACTIVE'}\`

💰 *Entry:*  \`${signal.entry || 'Market'}\`
🛑 *SL:*     \`${signal.sl || signal.stopLoss || '—'}\`
🎯 *TP1:*    \`${signal.tp1 || '—'}\` | *TP2:* \`${signal.tp2 || '—'}\`
📐 *R:R:*    ${rrDisplay(signal.rr || signal.risk_reward)}

📊 *Score:*  \`${scoreBar(score)}\` *${score}/100*
🎯 *Confidence:* ${confTag(conf)} \`${conf}/88\`

🔍 *Why trade:*
${(signal.whyTrade || signal.reason || '• Setup conditions met').split('\n').map(l => `• ${l.replace(/^[•\-]\s*/,'')}`).slice(0,4).join('\n')}

⚠️ *Why not:*
${(signal.whyNot || signal.risks || '• Monitor for invalidation').split('\n').map(l => `• ${l.replace(/^[•\-]\s*/,'')}`).slice(0,3).join('\n')}

🚫 *Invalidation:* \`${signal.invalidation || signal.invalidation_level || '—'}\`
${signal.vetoSummary && signal.vetoSummary !== 'No vetoes' ? `🚫 *Veto check:* ${signal.vetoSummary}\n` : ''}
📡 *Data:* \`${signal.priceSource || 'multi-source'}\` | Session: \`${signal.sessionAtSignal || '—'}\`
${signal.runId ? `\`run: ${signal.runId}\`` : ''}

_Analysis only — not financial advice_`;
}

// ─── WAIT Formatter ────────────────────────────────────────────────────────────
function formatWait(signal) {
    const sym = signal.asset || signal.symbol || '?';
    return `⏳ *WAIT: ${sym}*

*Main conflict:*
${signal.waitReason || signal.reason || '• Conditions not yet aligned'}

${signal.neededConfirmation ? `*Needed confirmation:*\n${signal.neededConfirmation}\n` : ''}${signal.watchLevel ? `*Watch level:* \`${signal.watchLevel}\`\n` : ''}
📊 *Score:* \`${signal.score || 0}/100\` — below execution threshold
🎯 *Confidence:* \`${Math.min(88, signal.confidence || 60)}/88\`

_Revisit when conditions align. No trade now._`;
}

// ─── WATCHLIST Formatter ───────────────────────────────────────────────────────
function formatWatchlist(signal) {
    const sym = signal.asset || signal.symbol || '?';
    return `👁 *WATCHLIST: ${sym}*

📋 *Setup:* \`${signal.setupType || signal.setup_type || 'Developing'}\`

🎯 *Trigger zone:* \`${signal.triggerZone || signal.entry || '—'}\`
✅ *Confirmation needed:*
${signal.confirmationNeeded || signal.neededConfirmation || '• Wait for session/structure alignment'}

🚫 *Invalidation before trigger:* \`${signal.invalidation || '—'}\`
⏰ *Best session:* \`${signal.bestSession || 'London/NY overlap'}\`

📊 *Score:* \`${signal.score || 0}/100\`

_Setup valid but trigger not ready. Monitor closely._`;
}

// ─── REJECTED Formatter ────────────────────────────────────────────────────────
function formatRejected(signal) {
    const sym    = signal.asset || signal.symbol || '?';
    const vetoes = signal.vetoes || signal.vetoReasons || [];
    const gates  = signal.failedGates || [];

    return `❌ *REJECTED: ${sym}*

*Missing criteria:*
${gates.length > 0 ? gates.map(g => `• ${g.reason || g.gate}`).join('\n') : '• Setup conditions not met'}

${vetoes.length > 0 ? `*Hard veto(s):*\n${vetoes.map(v => `🚫 ${v}`).join('\n')}\n` : ''}
*Do not trade reason:*
${signal.rejectedReason || signal.reason || '• Signal does not meet institutional criteria'}

📊 *Score:* \`${signal.score || 0}/100\` — ${signal.score < 60 ? 'below 60 minimum' : 'veto override'}

_Do not enter this trade. Conditions not met._`;
}

// ─── Health Summary Formatter ─────────────────────────────────────────────────
function formatHealthSummary(health) {
    const {
        providers = {}, db = 'unknown', queue = 0,
        aiMode = 'unknown', scheduler = 'unknown',
        fallbackCount = 0, staleWarnings = []
    } = health;

    const providerLines = Object.entries(providers)
        .map(([k, v]) => `${v.healthy ? '✅' : '❌'} ${k}${v.lastError ? ` — ${v.lastError.substring(0,40)}` : ''}`)
        .join('\n');

    return `🏥 *System Health*

🤖 *AI Mode:* \`${aiMode}\`
🗄 *Database:* \`${db}\`
📋 *Queue:* \`${queue} pending\`
⏱ *Scheduler:* \`${scheduler}\`
🔄 *Fallbacks today:* \`${fallbackCount}\`

📡 *Providers:*
${providerLines || '— No provider data'}

${staleWarnings.length > 0 ? `⚠️ *Stale warnings:*\n${staleWarnings.map(w => `• ${w}`).join('\n')}` : '✅ All data fresh'}

_${new Date().toISOString().substring(0,16).replace('T',' ')} UTC_`;
}

// ─── Status Formatter ─────────────────────────────────────────────────────────
function formatStatus(status) {
    const { uptime = 0, memory = {}, activeModules = [], lastJobs = [], errors24h = 0, flags = {} } = status;
    const uptimeStr = uptime > 3600 ? `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m` : `${Math.floor(uptime/60)}m`;
    return `⚡ *System Status*

⏱ *Uptime:* \`${uptimeStr}\`
💾 *Memory:* \`${Math.round((memory.heapUsed||0)/1024/1024)}MB / ${Math.round((memory.heapTotal||0)/1024/1024)}MB\`
🚨 *Errors (24h):* \`${errors24h}\`

*Active modules:* ${activeModules.map(m => `\`${m}\``).join(' ') || '—'}

*Last jobs:*
${lastJobs.map(j => `• ${j.name}: ${j.status} (${j.duration || '—'})`).join('\n') || '— No recent jobs'}

*Feature flags:*
${Object.entries(flags).map(([k,v]) => `${v ? '🟢' : '🔴'} \`${k}\``).join('\n') || '— None'}

_${new Date().toISOString().substring(0,16).replace('T',' ')} UTC_`;
}

// ─── Route formatter by action type ──────────────────────────────────────────
function formatSignal(signal) {
    const action = (signal.direction || signal.action || signal.verificationState || '').toUpperCase();
    if (action === 'BUY' || action === 'SELL')  return formatBuySell(signal);
    if (action === 'WAIT')                        return formatWait(signal);
    if (action === 'WATCHLIST')                   return formatWatchlist(signal);
    if (action === 'REJECTED')                    return formatRejected(signal);
    return formatWait(signal); // safe default
}

module.exports = {
    formatBuySell,
    formatWait,
    formatWatchlist,
    formatRejected,
    formatSignal,
    formatHealthSummary,
    formatStatus,
    scoreBar,
    confTag,
    rrDisplay
};
