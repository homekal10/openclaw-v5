/**
 * backtest_engine.cjs — OpenClaw v5.1 Backtest Engine
 *
 * Uses candle snapshots + fresh candle fetch to simulate TP/SL outcomes.
 * Calculates MFE (Max Favorable Excursion) / MAE (Max Adverse Excursion).
 * Output labeled "approximate, not live performance".
 */
'use strict';

const snapStore = require('../snapshots/snapshot_store.cjs');

/**
 * backtestRecent(symbol) — Backtest recent signals using candle data.
 * Fetches fresh candles when available.
 * @param {string} symbol
 * @returns {object} BacktestResult
 */
async function backtestRecent(symbol) {
    const sym = (symbol || 'XAUUSD').toUpperCase();
    const result = {
        symbol: sym,
        timestamp: new Date().toISOString(),
        label: 'APPROXIMATE — NOT LIVE PERFORMANCE',
        trades: [],
        summary: {},
        _is_simulation: true
    };

    // Get candle data — try fresh fetch first, then snapshot
    let candles = [];
    try {
        const { fetchCandles } = require('../../market_fetcher.cjs');
        const fetched = await Promise.race([
            fetchCandles(sym),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
        ]);
        if (fetched?.candles?.length > 20) candles = fetched.candles;
    } catch {}

    if (candles.length < 20) {
        // Fallback to snapshot store
        const snap = snapStore.getLatest('CANDLE', sym);
        if (snap?.payload?.candles?.length > 10) candles = snap.payload.candles;
    }

    if (candles.length < 20) {
        result.error = `Insufficient candle data for ${sym} (${candles.length} candles)`;
        return result;
    }

    // Get recent signals from trading log
    const fs = require('fs');
    const path = require('path');
    const LOG_PATH = path.join(__dirname, '../../logs/trading_log.json');
    let signals = [];
    try {
        signals = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
            .filter(s => s.symbol === sym && (s.signal === 'BUY' || s.signal === 'SELL'))
            .slice(-10);
    } catch {}

    if (signals.length === 0) {
        result.error = `No actionable signals found for ${sym} in trading log`;
        return result;
    }

    // Simulate each signal against candle data
    for (const sig of signals) {
        const entry = parseFloat(sig.entry || sig.price || 0);
        const sl = parseFloat(sig.sl || sig.stopLoss || 0);
        const tp = parseFloat(sig.tp || sig.takeProfit || 0);
        const direction = sig.signal || sig.final_action || 'BUY';

        if (!entry || !sl) continue;

        // Find candles after signal timestamp
        const sigTime = new Date(sig.timestamp).getTime();
        const afterCandles = candles.filter(c => new Date(c.time || c.timestamp).getTime() > sigTime);

        if (afterCandles.length < 2) continue;

        // Calculate MFE and MAE
        let mfe = 0, mae = 0, outcome = 'OPEN';
        for (const c of afterCandles) {
            const high = parseFloat(c.high);
            const low = parseFloat(c.low);

            if (direction === 'BUY') {
                const favorable = high - entry;
                const adverse = entry - low;
                mfe = Math.max(mfe, favorable);
                mae = Math.max(mae, adverse);
                if (tp && high >= tp) { outcome = 'TP_HIT'; break; }
                if (sl && low <= sl) { outcome = 'SL_HIT'; break; }
            } else {
                const favorable = entry - low;
                const adverse = high - entry;
                mfe = Math.max(mfe, favorable);
                mae = Math.max(mae, adverse);
                if (tp && low <= tp) { outcome = 'TP_HIT'; break; }
                if (sl && high >= sl) { outcome = 'SL_HIT'; break; }
            }
        }

        result.trades.push({
            timestamp: sig.timestamp,
            direction,
            entry: entry.toFixed(2),
            sl: sl.toFixed(2),
            tp: tp ? tp.toFixed(2) : 'N/A',
            rr: sig.rewardRisk || sig.rr_value || 'N/A',
            score: sig.score || sig.institutional_score || 0,
            mfe: parseFloat(mfe.toFixed(4)),
            mae: parseFloat(mae.toFixed(4)),
            outcome,
            setup_type: sig.setup_type || 'unknown'
        });
    }

    // Summary
    const wins = result.trades.filter(t => t.outcome === 'TP_HIT').length;
    const losses = result.trades.filter(t => t.outcome === 'SL_HIT').length;
    const open = result.trades.filter(t => t.outcome === 'OPEN').length;
    const totalTrades = result.trades.length;
    const avgMFE = totalTrades ? result.trades.reduce((s, t) => s + t.mfe, 0) / totalTrades : 0;
    const avgMAE = totalTrades ? result.trades.reduce((s, t) => s + t.mae, 0) / totalTrades : 0;

    result.summary = {
        total_trades: totalTrades,
        wins, losses, open,
        win_rate: totalTrades > 0 ? Math.round(wins / totalTrades * 100) : 0,
        avg_mfe: parseFloat(avgMFE.toFixed(4)),
        avg_mae: parseFloat(avgMAE.toFixed(4)),
        mfe_mae_ratio: avgMAE > 0 ? parseFloat((avgMFE / avgMAE).toFixed(2)) : 0,
        candles_used: candles.length
    };

    // Save to snapshot store
    try {
        snapStore.put('BACKTEST_RESULT', sym, null, result, {
            provider: 'backtest_engine',
            source_timestamp: result.timestamp
        });
    } catch {}

    return result;
}

/**
 * Format backtest result for Telegram.
 */
function formatBacktestResult(result) {
    if (result.error) return `❌ *Backtest Error:* ${result.error}`;

    const s = result.summary;
    const trades = result.trades.slice(-5).map(t =>
        `  ${t.direction === 'BUY' ? '🟢' : '🔴'} ${t.direction} @ ${t.entry} → ${t.outcome} | MFE: ${t.mfe} MAE: ${t.mae}`
    ).join('\n');

    return `📊 *Backtest: ${result.symbol}*
_${result.timestamp}_
⚠️ *${result.label}*

*Summary:*
  Trades: ${s.total_trades} | Wins: ${s.wins} | Losses: ${s.losses} | Open: ${s.open}
  Win Rate: ${s.win_rate}% | MFE/MAE: ${s.mfe_mae_ratio}:1
  Avg MFE: ${s.avg_mfe} | Avg MAE: ${s.avg_mae}
  Candles: ${s.candles_used}

*Recent Trades:*
${trades || '  No trades to display'}

_Approximate simulation — not live trading results_`;
}

module.exports = { backtestRecent, formatBacktestResult };
