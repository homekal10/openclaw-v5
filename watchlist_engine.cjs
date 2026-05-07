/**
 * watchlist_engine.cjs — Monitor symbols and alert when setup improves
 * /watch <symbol> [target RR] — adds to watchlist
 * Checks every 15 min, alerts when Reward:Risk reaches threshold
 */

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const WATCH_FILE = path.join(__dirname, 'logs', 'watchlist.json');
const CHECK_INTERVAL = 15 * 60 * 1000; // 15 min

let botRef   = null;
let interval = null;

function loadWatchlist() {
    try { return JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')); }
    catch(e) { return []; }
}

function saveWatchlist(list) {
    fs.writeFileSync(WATCH_FILE, JSON.stringify(list, null, 2));
}

function addWatch(chatId, symbol, targetRR = 2.0, label = '') {
    const list = loadWatchlist();
    const key  = `${chatId}-${symbol.toUpperCase()}`;
    const existing = list.findIndex(w => w.key === key);
    const entry = { key, chatId: chatId.toString(), symbol: symbol.toUpperCase(), targetRR, label, addedAt: new Date().toISOString(), alertedAt: null };
    if (existing >= 0) list[existing] = entry;
    else list.push(entry);
    saveWatchlist(list);
}

function removeWatch(chatId, symbol) {
    const list = loadWatchlist().filter(w => w.key !== `${chatId}-${symbol.toUpperCase()}`);
    saveWatchlist(list);
}

function listWatches(chatId) {
    return loadWatchlist().filter(w => w.chatId === chatId.toString());
}

async function checkAll() {
    if (!botRef) return;
    const { fetchCandles }        = require('./market_fetcher.cjs');
    const { analyze }             = require('./strategy_engine.cjs');
    const { checkAlertCondition } = require('./risk_manager.cjs');

    const list = loadWatchlist();
    if (!list.length) return;

    for (const watch of list) {
        try {
            const { candles, display } = await fetchCandles(watch.symbol);
            const analysis = analyze(candles);
            const signal   = checkAlertCondition(analysis, watch.targetRR);
            if (signal) {
                const now = Date.now();
                const lastAlerted = watch.alertedAt ? new Date(watch.alertedAt).getTime() : 0;
                if (now - lastAlerted < 4 * 60 * 60 * 1000) continue; // Don't re-alert within 4h

                // v5.1: Check verifier state before using BUY/SELL wording
                let verifierState = 'UNVERIFIED';
                let vetoSummary = 'Not checked';
                try {
                    const snapStore = require('./lib/snapshots/snapshot_store.cjs');
                    const sigSnap = snapStore.get('SIGNAL', watch.symbol);
                    if (sigSnap && !sigSnap.stale) {
                        verifierState = sigSnap.data?.verifier_state || 'UNVERIFIED';
                        vetoSummary = sigSnap.data?.veto_summary || 'No veto data';
                    }
                } catch(e) {}

                // v5.1: Only use BUY/SELL if verifier_state = VERIFIED_ACTIVE
                const directionLabel = verifierState === 'VERIFIED_ACTIVE'
                    ? (signal.direction === 'LONG' ? '🟢 BUY' : '🔴 SELL')
                    : (signal.direction === 'LONG' ? '📊 Long Bias' : '📊 Short Bias');

                const msg =
                    `🔔 *WATCHLIST IMPROVED — ${display}*\n` +
                    `⚠️ _Not a verified trade signal_\n\n` +
                    `Setup improved! R:R now *${signal.rewardRisk}:1* ≥ ${watch.targetRR}:1 target\n\n` +
                    `${directionLabel}\n` +
                    `Entry:  \`${signal.entry}\`\n` +
                    `SL:     \`${signal.stopLoss}\`\n` +
                    `TP:     \`${signal.takeProfit}\`\n` +
                    `Score:  *${signal.score}/100*\n` +
                    `Verifier: _${verifierState}_\n\n` +
                    `⚡ *Requires /signal ${watch.symbol} confirmation*`;

                await botRef.sendMessage(parseInt(watch.chatId), msg, { parse_mode: 'Markdown' });
                watch.alertedAt = new Date().toISOString();
            }
        } catch(e) { /* silent fail per symbol */ }
    }
    saveWatchlist(list);
}

function init(bot) {
    botRef = bot;
    if (interval) clearInterval(interval);
    interval = setInterval(checkAll, CHECK_INTERVAL);
    setTimeout(checkAll, 5000); // initial check after 5s
}

function stop() { if (interval) clearInterval(interval); }

module.exports = { init, stop, addWatch, removeWatch, listWatches, checkAll };
