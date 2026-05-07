/**
 * trading_engine.cjs — OpenClaw Signal Engine (Institutional Hybrid)
 *
 * Priority:
 *   1. Institutional Orchestrator (8-layer scoring, 4 agents, veto engine)
 *   2. Fallback Pipeline (simplified local scoring)
 *   3. Legacy heuristic (backward compatibility only)
 *
 * Sentiment is CONTEXT only — never an execution trigger.
 * R:R < 1.8 is always REJECTED. Score < 60 is always WAIT.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const { fetchCandles }    = require('./market_fetcher.cjs');
const { analyze }         = require('./strategy_engine.cjs');
const { evaluate }        = require('./risk_manager.cjs');

const LOG_DIR   = path.join(__dirname, 'logs');
const LOG_PATH  = path.join(LOG_DIR, 'trading_log.json');
const ACCT_FILE = path.join(LOG_DIR, 'account.json');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ─── Account ────────────────────────────────────────────────────────────────
function getAccountSize() {
    try { return JSON.parse(fs.readFileSync(ACCT_FILE, 'utf8')).size || null; }
    catch { return null; }
}
function setAccountSize(size) {
    fs.writeFileSync(ACCT_FILE, JSON.stringify({ size, updatedAt: new Date().toISOString() }));
}

// ─── Signal log ──────────────────────────────────────────────────────────────
function saveSignal(symbol, analysis, signal, meta = {}) {
    let logs = [];
    try { if (fs.existsSync(LOG_PATH)) logs = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch {}
    logs.push({
        timestamp:          new Date().toISOString(),
        symbol,
        trend:              analysis?.trend,
        price:              analysis?.currentPrice,
        rsi:                analysis?.rsi,
        atr:                analysis?.atr,
        adx:                analysis?.adx?.adx,
        signal:             signal?.direction || meta.final_action || 'NO_SETUP',
        entry:              signal?.entry || meta.entry_price,
        sl:                 signal?.stopLoss || meta.stop_loss,
        tp:                 signal?.takeProfit || meta.take_profit_1,
        rewardRisk:         signal?.rewardRisk || meta.rr_value,
        score:              meta.total_score || signal?.score,
        confidence:         meta.confidence || signal?.confidence,
        // Institutional fields
        setup_type:         meta.setup_type,
        veto_passed:        meta.veto_passed,
        institutional_score: meta.total_score,
        final_action:       meta.final_action,
        why_trade:          meta.why_trade,
        why_not_trade:      meta.why_not_trade,
        session:            meta.session,
        rr_value:           meta.rr_value,
        score_breakdown:    meta.score_breakdown,
        engine:             meta.engine || 'legacy'
    });
    if (logs.length > 500) logs = logs.slice(-500);
    try { fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2)); } catch {}
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function getMonthlyStats() {
    try {
        const logs  = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
        const now   = new Date();
        const month = logs.filter(l => {
            const d = new Date(l.timestamp);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        const signals  = month.filter(l => l.signal !== 'NO_SETUP' && l.signal !== 'WAIT' && l.signal !== 'REJECTED');
        const avgRR    = signals.length ? (signals.reduce((s, l) => s + (l.rewardRisk || 0), 0) / signals.length).toFixed(2) : 'N/A';
        const avgScore = signals.length ? Math.round(signals.reduce((s, l) => s + (l.score || 0), 0) / signals.length) : 'N/A';
        const institutional = month.filter(l => l.engine === 'orchestrator').length;
        return { total: month.length, signals: signals.length, avgRR, avgScore, institutional };
    } catch { return null; }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────
function fmt(p) {
    if (!p && p !== 0) return '—';
    return p > 100 ? p.toFixed(2) : p.toFixed(5);
}
function rrColor(rr) {
    if (rr >= 2) return '🟢';
    if (rr >= 1) return '🟡';
    return '🔴';
}
function scoreBar(score) {
    const filled = Math.round(score / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}/100`;
}
function adxLabel(adx) {
    if (!adx) return 'N/A';
    if (adx >= 40) return `${adx} 🔥 Strong`;
    if (adx >= 25) return `${adx} ✅ Trending`;
    return `${adx} ⚠️ Weak (<20 = no trade)`;
}

// ─── Legacy message builder (used only as fallback) ──────────────────────────
function buildLegacyMessage(display, analysis, signal, score) {
    const { trend, rsi, currentPrice, ema20, ema50, atr, adx, macd, divergence } = analysis;
    const trendIcon = { BULLISH: '🟢', BEARISH: '🔴', RANGE: '🟡' }[trend];
    const rsiNote = rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral';
    const divNote = divergence !== 'NONE' ? `\n⚡ RSI Divergence: *${divergence.replace('_', ' ')}*` : '';

    if (!signal) {
        return `📊 *${display} — ANALYSIS (Legacy)*\n` +
            `_⚠️ Institutional engine unavailable — simplified output_\n\n` +
            `${trendIcon} Trend: *${trend}* | Price: \`${fmt(currentPrice)}\`\n` +
            `RSI: \`${rsi}\` — ${rsiNote}${divNote}\n` +
            `ADX: \`${adxLabel(adx?.adx)}\`\n` +
            `\`${scoreBar(score || 0)}\`\n\n` +
            `⏸ *NO SETUP* — Score < threshold or R:R insufficient\n` +
            `_Run /signal again for full institutional analysis._`;
    }

    const dirIcon = signal.direction === 'LONG' ? '🟢 LONG (BUY)' : '🔴 SHORT (SELL)';
    return `🚨 *${display} — SIGNAL (Legacy Fallback)*\n` +
        `_⚠️ Institutional engine unavailable — using simplified scoring_\n\n` +
        `${trendIcon} Trend: *${trend}* | ATR: \`${atr}\`\n` +
        `RSI: \`${rsi}\`${divNote}\n` +
        `ADX: \`${adxLabel(adx?.adx)}\`\n\n` +
        `${dirIcon}\n` +
        `Entry: \`${fmt(signal.entry)}\` | SL: \`${fmt(signal.stopLoss)}\` | TP: \`${fmt(signal.takeProfit)}\`\n` +
        `${rrColor(signal.rewardRisk)} R:R: *${signal.rewardRisk}:1*\n` +
        `\`${scoreBar(signal.score)}\`\n\n` +
        `⚠️ _Legacy analysis — NOT institutional grade. Use /signal for full analysis._`;
}

// ─── Main signal generator ────────────────────────────────────────────────────
async function generateSignal(symbolInput, timeframe = '1D', accountSize = null) {
    const sym = symbolInput.toUpperCase();

    // ── Path 1: Institutional Orchestrator ──────────────────────────────────
    try {
        const { runOrchestrator } = require('./lib/orchestration/orchestrator.cjs');
        const acctSize = accountSize || getAccountSize();
        const result   = await runOrchestrator(sym, { accountSize: acctSize });

        if (result && result.formatted_message && result.final_action !== 'ERROR') {
            // Save to log with full institutional metadata
            saveSignal(sym, { trend: result.trend_4h, currentPrice: result.entry_price }, null, {
                ...result, engine: 'orchestrator'
            });
            return result.formatted_message;
        }
    } catch (orchErr) {
        console.log(`[Engine] Orchestrator failed for ${sym}: ${orchErr.message} — trying fallback`);
    }

    // ── Path 2: Fallback Pipeline ────────────────────────────────────────────
    try {
        const { runFallbackPipeline } = require('./lib/orchestration/fallback-pipeline.cjs');
        const result = await runFallbackPipeline(sym);
        if (result && result.formatted_message) {
            saveSignal(sym, {}, null, { ...result, engine: 'fallback' });
            return result.formatted_message;
        }
    } catch (fbErr) {
        console.log(`[Engine] Fallback pipeline failed for ${sym}: ${fbErr.message} — using legacy`);
    }

    // ── Path 3: Legacy heuristic (last resort) ───────────────────────────────
    try {
        const { candles, display } = await fetchCandles(sym);
        if (!candles || candles.length < 20) {
            return `❌ Insufficient data for ${sym} (${candles?.length ?? 0} candles).`;
        }
        const analysis = analyze(candles, timeframe);
        const signal   = evaluate(analysis, sym, accountSize || getAccountSize());
        const { calcSetupScore } = require('./strategy_engine.cjs');
        const score = calcSetupScore({
            trend: analysis.trend, rsi: analysis.rsi,
            rr: signal?.rewardRisk || 0,
            volumeTrend: analysis.volumeTrend,
            adx: analysis.adx, macd: analysis.macd,
            divergence: analysis.divergence
        });
        saveSignal(sym, analysis, signal, { engine: 'legacy' });
        return buildLegacyMessage(display, analysis, signal, score);
    } catch (legacyErr) {
        return `⚠️ *${sym} Analysis Unavailable*\n\n_All analysis paths failed. Please try again shortly._\n\`${legacyErr.message.substring(0, 100)}\``;
    }
}

// ─── Market overview ─────────────────────────────────────────────────────────
async function marketOverview() {
    const targets = [
        { sym: 'BTC',    label: 'BTC/USD' },
        { sym: 'XAUUSD', label: 'GOLD'    },
        { sym: 'EURUSD', label: 'EUR/USD' }
    ];
    const lines = [`📈 *MARKET OVERVIEW*\n_${new Date().toUTCString()}_\n`];
    for (const t of targets) {
        try {
            const { candles } = await fetchCandles(t.sym);
            const a = analyze(candles);
            const s = evaluate(a, t.sym);
            const icon = { BULLISH: '🟢', BEARISH: '🔴', RANGE: '🟡' }[a.trend];
            const sig  = s ? `${s.direction} (R:R ${s.rewardRisk}:1)` : 'No setup';
            lines.push(`${icon} *${t.label}*: \`${fmt(a.currentPrice)}\`\nRSI: ${a.rsi} | ADX: ${a.adx?.adx || '—'}\n${sig}`);
        } catch (e) {
            lines.push(`⚠️ *${t.label}*: ${e.message.substring(0, 60)}`);
        }
    }
    const stats = getMonthlyStats();
    if (stats) {
        lines.push(`\n📅 *This Month:* ${stats.signals} signals | ${stats.institutional} institutional | Avg R:R ${stats.avgRR}:1`);
    }
    lines.push(`\n_Run /signal <symbol> for full institutional analysis._`);
    return lines.join('\n\n');
}

module.exports = { generateSignal, marketOverview, getMonthlyStats, setAccountSize, getAccountSize };
