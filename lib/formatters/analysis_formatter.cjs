/**
 * analysis_formatter.cjs — AI Agent Output Formatter
 * 
 * Prevents [object Object] in Telegram by converting raw agent outputs
 * into structured, mobile-readable text sections.
 * 
 * Three output modes:
 *   - telegram: concise mobile-first format
 *   - dashboard: detailed with metadata
 *   - debug: full JSON for admin inspection
 */
'use strict';

function safe(val, fallback = '—') {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') {
        if (val.text) return val.text;
        if (val.summary) return val.summary;
        if (val.message) return val.message;
        try { return JSON.stringify(val); } catch { return fallback; }
    }
    return String(val);
}

function safeList(items, maxItems = 5) {
    if (!items || !Array.isArray(items)) return '  None';
    return items.slice(0, maxItems).map(i => '  • ' + safe(i)).join('\n') || '  None';
}

function biasEmoji(bias) {
    const b = String(bias || '').toLowerCase();
    if (b.includes('bull')) return '🟢';
    if (b.includes('bear')) return '🔴';
    if (b.includes('neutral')) return '⚪';
    return '🔵';
}

function actionEmoji(action) {
    const a = String(action || '').toUpperCase();
    if (a === 'BUY') return '🟢';
    if (a === 'SELL') return '🔴';
    if (a === 'WAIT') return '⏳';
    if (a === 'WATCHLIST') return '📋';
    if (a === 'REJECTED') return '🚫';
    return '🔵';
}

// ── Technical Agent ───────────────────────────────────────────────────────────
function formatTechnicalAgent(data) {
    if (!data || typeof data === 'string') return safe(data);
    const d = typeof data === 'object' ? data : {};
    const lines = [];
    lines.push('📐 Technical Analysis');
    lines.push('━━━━━━━━━━━━━━━');
    if (d.bias) lines.push(biasEmoji(d.bias) + ' Bias: ' + safe(d.bias));
    if (d.trend) lines.push('📊 Trend: ' + safe(d.trend));
    if (d.structure) lines.push('🏗️ Structure: ' + safe(d.structure));
    if (d.regime) lines.push('📈 Regime: ' + safe(d.regime));
    if (d.setup_type) lines.push('🎯 Setup: ' + safe(d.setup_type));
    if (d.entry) lines.push('🎯 Entry: ' + safe(d.entry));
    if (d.sl || d.stop_loss) lines.push('🛑 SL: ' + safe(d.sl || d.stop_loss));
    if (d.tp1) lines.push('✅ TP1: ' + safe(d.tp1));
    if (d.tp2) lines.push('✅ TP2: ' + safe(d.tp2));
    if (d.rr) lines.push('📏 R:R: ' + safe(d.rr));
    if (d.key_findings || d.findings) {
        lines.push('🔍 Key Findings:');
        lines.push(safeList(d.key_findings || d.findings));
    }
    if (d.conflicts) {
        lines.push('⚠️ Conflicts:');
        lines.push(safeList(d.conflicts));
    }
    if (d.score !== undefined) lines.push('💯 Score: ' + safe(d.score) + '/100');
    if (d.confidence !== undefined) lines.push('🎯 Confidence: ' + safe(d.confidence) + '/100');
    return lines.join('\n');
}

// ── Sentiment Agent ───────────────────────────────────────────────────────────
function formatSentimentAgent(data) {
    if (!data || typeof data === 'string') return safe(data);
    const d = typeof data === 'object' ? data : {};
    const lines = [];
    lines.push('💭 Sentiment Analysis');
    lines.push('━━━━━━━━━━━━━━━');
    if (d.bias) lines.push(biasEmoji(d.bias) + ' Bias: ' + safe(d.bias));
    if (d.market_mood || d.mood) lines.push('🌡️ Mood: ' + safe(d.market_mood || d.mood));
    if (d.fear_greed !== undefined) lines.push('😱 F&G: ' + safe(d.fear_greed));
    if (d.social_sentiment) lines.push('📱 Social: ' + safe(d.social_sentiment));
    if (d.sources) {
        lines.push('📡 Sources:');
        lines.push(safeList(d.sources));
    }
    if (d.key_findings || d.findings) {
        lines.push('🔍 Key Findings:');
        lines.push(safeList(d.key_findings || d.findings));
    }
    if (d.confidence !== undefined) lines.push('🎯 Confidence: ' + safe(d.confidence) + '/100');
    if (d.warning) lines.push('⚠️ ' + safe(d.warning));
    return lines.join('\n');
}

// ── News & Macro Agent ────────────────────────────────────────────────────────
function formatNewsMacroAgent(data) {
    if (!data || typeof data === 'string') return safe(data);
    const d = typeof data === 'object' ? data : {};
    const lines = [];
    lines.push('📰 News & Macro Analysis');
    lines.push('━━━━━━━━━━━━━━━');
    if (d.bias) lines.push(biasEmoji(d.bias) + ' Bias: ' + safe(d.bias));
    if (d.macro_regime) lines.push('🏛️ Macro: ' + safe(d.macro_regime));
    if (d.event_risk) lines.push('🚨 Event Risk: ' + safe(d.event_risk));
    if (d.usd_context) lines.push('💵 USD: ' + safe(d.usd_context));
    if (d.headlines || d.relevant_headlines) {
        lines.push('📋 Headlines:');
        lines.push(safeList(d.headlines || d.relevant_headlines, 4));
    }
    if (d.key_findings || d.findings) {
        lines.push('🔍 Key Findings:');
        lines.push(safeList(d.key_findings || d.findings));
    }
    if (d.conflicts) {
        lines.push('⚠️ Conflicts:');
        lines.push(safeList(d.conflicts));
    }
    if (d.confidence !== undefined) lines.push('🎯 Confidence: ' + safe(d.confidence) + '/100');
    return lines.join('\n');
}

// ── Risk Agent ────────────────────────────────────────────────────────────────
function formatRiskAgent(data) {
    if (!data || typeof data === 'string') return safe(data);
    const d = typeof data === 'object' ? data : {};
    const lines = [];
    lines.push('🛡️ Risk Management');
    lines.push('━━━━━━━━━━━━━━━');
    if (d.approval) lines.push((d.approval === 'APPROVED' ? '✅' : '❌') + ' Risk: ' + safe(d.approval));
    if (d.rr || d.risk_reward) lines.push('📏 R:R: ' + safe(d.rr || d.risk_reward));
    if (d.position_size) lines.push('📐 Size: ' + safe(d.position_size));
    if (d.stop_loss || d.sl) lines.push('🛑 Stop: ' + safe(d.stop_loss || d.sl));
    if (d.invalidation) lines.push('❌ Invalid: ' + safe(d.invalidation));
    if (d.spread_ok !== undefined) lines.push('📊 Spread: ' + (d.spread_ok ? '✅ OK' : '⚠️ Wide'));
    if (d.volatility) lines.push('📉 Volatility: ' + safe(d.volatility));
    if (d.key_findings || d.findings) {
        lines.push('🔍 Key Findings:');
        lines.push(safeList(d.key_findings || d.findings));
    }
    if (d.recommendation) lines.push('💡 ' + safe(d.recommendation));
    return lines.join('\n');
}

// ── CIO Synthesis ─────────────────────────────────────────────────────────────
function formatCioSynthesis(data) {
    if (!data || typeof data === 'string') return safe(data);
    const d = typeof data === 'object' ? data : {};
    const lines = [];
    const action = d.final_action || d.action || d.decision || 'UNKNOWN';
    lines.push(actionEmoji(action) + ' CIO SYNTHESIS: ' + action);
    lines.push('━━━━━━━━━━━━━━━');
    if (d.setup_type) lines.push('🎯 Setup: ' + safe(d.setup_type));
    if (d.score !== undefined) lines.push('💯 Score: ' + safe(d.score) + '/100');
    if (d.confidence !== undefined) lines.push('🎯 Confidence: ' + safe(d.confidence) + '/100');
    if (d.why_trade) lines.push('✅ Why: ' + safe(d.why_trade));
    if (d.why_not) lines.push('❌ Why Not: ' + safe(d.why_not));
    if (d.needed_confirmation) lines.push('🔍 Needs: ' + safe(d.needed_confirmation));
    if (d.vetoes) {
        lines.push('🚫 Vetoes:');
        lines.push(safeList(d.vetoes));
    }
    if (d.risk_note) lines.push('⚠️ Risk: ' + safe(d.risk_note));
    return lines.join('\n');
}

// ── Master Formatter ──────────────────────────────────────────────────────────
function formatAgentAnalysis(result, mode = 'telegram') {
    if (!result || typeof result === 'string') return safe(result);

    // Debug mode: raw JSON
    if (mode === 'debug') {
        try { return '```json\n' + JSON.stringify(result, null, 2) + '\n```'; }
        catch { return String(result); }
    }

    const sections = [];
    const symbol = result.symbol || result.asset || '';
    const ts = result.timestamp || new Date().toISOString();

    sections.push('🔭 OpenClaw Expert Analysis' + (symbol ? ' — ' + symbol : ''));
    sections.push('📅 ' + new Date(ts).toUTCString());
    sections.push('');

    // Extract agent sections from various possible shapes
    const tech = result.technical || result.technicalAgent || result.tech;
    const sent = result.sentiment || result.sentimentAgent;
    const news = result.news_macro || result.newsAgent || result.macro || result.newsMacro;
    const risk = result.risk || result.riskAgent;
    const synth = result.synthesis || result.cio || result.cioSynthesis || result.final;

    if (tech) { sections.push(formatTechnicalAgent(tech)); sections.push(''); }
    if (sent) { sections.push(formatSentimentAgent(sent)); sections.push(''); }
    if (news) { sections.push(formatNewsMacroAgent(news)); sections.push(''); }
    if (risk) { sections.push(formatRiskAgent(risk)); sections.push(''); }
    if (synth) { sections.push(formatCioSynthesis(synth)); sections.push(''); }

    // If no sections were extracted, try to format the whole object safely
    if (sections.length <= 3) {
        sections.push('ℹ️ Analysis output:');
        for (const [key, val] of Object.entries(result)) {
            if (['symbol', 'asset', 'timestamp', 'run_id'].includes(key)) continue;
            sections.push('  ' + key + ': ' + safe(val));
        }
    }

    // Model/run info
    if (result.model_used) sections.push('🤖 Model: ' + safe(result.model_used));
    if (result.run_id) sections.push('🆔 Run: ' + safe(result.run_id).substring(0, 8));
    if (result.stale) sections.push('⚠️ STALE DATA — analysis may be outdated');

    return sections.join('\n');
}

module.exports = {
    formatAgentAnalysis,
    formatTechnicalAgent,
    formatSentimentAgent,
    formatNewsMacroAgent,
    formatRiskAgent,
    formatCioSynthesis,
    safe,
    biasEmoji,
    actionEmoji
};
