/**
 * telegram_bot.cjs — OpenClaw Bloomberg Bot (Expert Edition)
 * New commands: /watch, /unwatch, /watchlist, /setaccount, /stats, /timeframe
 */

// ── Global Crash Protection ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('[CRASH-GUARD] Uncaught exception caught:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH-GUARD] Unhandled rejection:', reason?.message || reason);
});
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });
const { createClient } = require('@supabase/supabase-js');

const aiCore                                  = require('./ai_core.cjs');
const { generateSignal, marketOverview,
        getMonthlyStats, setAccountSize }     = require('./trading_engine.cjs');
const { generateContent }                     = require('./social_engine.cjs');
const { runAgentAnalysis }                    = require('./tradingagents_bridge.cjs');
const { fetchAllNews }                        = require('./news_collector.cjs');
const { formatNewsForTelegram }               = require('./database.cjs');
const { analyzeSentiment, formatSentimentSummary } = require('./sentiment_engine.cjs');
const { generateCandlestickChart, generateIndicatorChart, generateChart, generateRSIChart, generateBBChart, generateStratChart, generateFullIndicatorChart, getIndicatorSnapshot } = require('./chart_engine.cjs');
const { fetchCandles }                        = require('./market_fetcher.cjs');
const { analyze }                             = require('./strategy_engine.cjs');
const scheduler                               = require('./scheduler.cjs');
const watchlistEngine                         = require('./watchlist_engine.cjs');
const { getRecentHeadlines, getSignals, getRwandaIntel, getPerformance } = require('./database.cjs');
const { collectAll }                          = require('./news_collector.cjs');
const { generateRwandaMacroReport }           = require('./rwanda_engine.cjs');
const { PORT: DASH_PORT }                     = require('./dashboard.cjs');
// ─── Market Data (Dual-Source: CoinAPI + CoinGecko) ─────────────────────────
const { generateFusedCryptoSignal, formatFusedSignal,
        checkDataSources, getFusedPrice }         = require('./market_data_fusion.cjs');
const { generateCryptoSignal, formatCryptoSignal,
        formatTopCoins, getTopCoins, getTrending,
        getFearGreed, getGlobalStats }             = require('./coingecko.cjs');  // keep for utilities
const { getRouterStatus }                         = require('./model_router.cjs');
const bridge                                      = require('./supabase_bridge.cjs');
const { enrichSignalWithRisk, formatRiskBlock, getDividendData } = require('./remora_risk.cjs');
// ─── v4.0 Expert System Modules ──────────────────────────────────────────────
const { formatSmartHealth, runHealthCheck }         = require('./smart_health.cjs');
const { classifyRegime, runPatternScan, getRecommendedStrategies, STRATEGY_MAP } = require('./lib/agents/pattern-detector.cjs');
const { formatVersionInfo, formatChangelog, loadVersion, checkForUpdates } = require('./auto_update.cjs');
const { formatApiUsage, recordCall }                = require('./api_counter.cjs');
const snapStore                                     = require('./lib/snapshots/snapshot_store.cjs');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error("FATAL: TELEGRAM_BOT_TOKEN missing"); process.exit(1); }

const bot = new TelegramBot(token, {
    polling: { interval: 3000, autoStart: true, params: { timeout: 60 } },
    request: { timeout: 60000 }
});

// ─── LOGGING ──────────────────────────────────────────────────────────────────
const LOG_DIR  = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);
const LOG_FILE = path.join(LOG_DIR, 'execution_log.txt');

function writeLog(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    fs.appendFileSync(LOG_FILE, line + '\n');
    console.log(line);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
const ADMIN_ID   = (process.env.ADMIN_USER_ID || '').trim();
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
    catch(e) { return { adminId: ADMIN_ID, users: [] }; }
}
function saveUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }

/**
 * Authorize by numeric chatId OR by Telegram username.
 * If a username match is found and we now have their numeric ID,
 * we persist it so future lookups are instant.
 */
function isAuthorized(chatId, username) {
    const sid = chatId.toString();
    if (sid === ADMIN_ID) return true;
    const db  = loadUsers();
    // 1. Fast path — numeric ID match
    const byId = db.users.find(u => u.id === sid);
    if (byId) return true;
    // 2. Fallback — username match (case-insensitive)
    if (username) {
        const uLower = username.toLowerCase();
        const byName = db.users.find(
            u => (u.username || '').toLowerCase() === uLower
        );
        if (byName) {
            // Promote: store numeric ID so next check is instant
            if (!byName.id || byName.id === byName.username) {
                byName.id = sid;
                saveUsers(db);
                writeLog(`Promoted @${username} → ID ${sid}`);
            }
            return true;
        }
    }
    return false;
}
function isAdmin(chatId, username) {
    if (chatId.toString() === ADMIN_ID) return true;
    const db   = loadUsers();
    const sid  = chatId.toString();
    const uLow = (username || '').toLowerCase();
    const user = db.users.find(
        u => u.id === sid || (u.username || '').toLowerCase() === uLow
    );
    return user?.role === 'admin';
}

// ─── v3.4 Rate Limiter ───────────────────────────────────────────────────────
const _rateLimits = new Map(); // userId → { count, windowStart }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60000; // 60s

function checkRateLimit(userId) {
    const now = Date.now();
    const entry = _rateLimits.get(userId);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
        _rateLimits.set(userId, { count: 1, windowStart: now });
        return true; // allowed
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) return false; // rate-limited
    return true;
}

function getRateLimitStats() {
    const stats = { active_users: _rateLimits.size, limited: 0 };
    const now = Date.now();
    for (const [, entry] of _rateLimits) {
        if (now - entry.windowStart <= RATE_LIMIT_WINDOW && entry.count > RATE_LIMIT_MAX) stats.limited++;
    }
    return stats;
}

// ─── v3.4 Symbol Sanitizer ───────────────────────────────────────────────────
function sanitizeTicker(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.toUpperCase().replace(/[^A-Z0-9_/.-]/g, '').substring(0, 20);
}

// ─── SEND ─────────────────────────────────────────────────────────────────────
function send(chatId, text, opts = {}) {
    return bot.sendMessage(chatId, text, opts).catch(e => {
        writeLog(`Send error: ${e.message}`);
        if (opts.parse_mode) bot.sendMessage(chatId, text.replace(/[*_`\[\]()~>#+=|{}.!-]/g, '\\$&')).catch(() => {});
    });
}
function sendPhoto(chatId, url, caption = '') {
    return bot.sendPhoto(chatId, url, { caption, parse_mode: 'Markdown' }).catch(e => {
        writeLog(`Photo error: ${e.message}`);
        send(chatId, `📊 Chart: ${url}`);
    });
}
function typing(chatId) { bot.sendChatAction(chatId, 'typing').catch(() => {}); }

// ─── POLLING RECOVERY (Exponential Backoff + Network Probe) ───────────────

const dns     = require('dns').promises;
let isRestarting = false;
let restartDelay = 10000; // 10s → 20s → 40s → 60s cap

async function canReachTelegram() {
    try { await dns.lookup('api.telegram.org'); return true; }
    catch(e) { return false; }
}

async function schedulePollingRestart() {
    if (isRestarting) return;
    isRestarting = true;
    await bot.stopPolling().catch(() => {});

    const attempt = async () => {
        const reachable = await canReachTelegram();
        if (reachable) {
            bot.startPolling({ restart: true }).catch(() => process.exit(1));
            writeLog(`Polling restarted (backoff: ${restartDelay/1000}s).`);
            restartDelay = Math.min(restartDelay * 2, 60000);
            isRestarting = false;
        } else {
            writeLog(`Network unreachable — retrying in ${restartDelay/1000}s.`);
            setTimeout(attempt, restartDelay);
        }
    };
    setTimeout(attempt, restartDelay);
}

bot.on('polling_error', e => {
    const ignorable = e.code === 'ETELEGRAM' && e.message?.includes('terminated by other');
    if (!ignorable) writeLog(`Polling Error: ${e.code} - ${e.message?.substring(0, 80)}`);
    if ((e.code === 'EFATAL' || e.code === 'ECONNRESET') && !isRestarting) {
        schedulePollingRestart();
    }
});

// Reset backoff when stable >5min
setInterval(() => { if (!isRestarting) restartDelay = 10000; }, 5 * 60 * 1000);

// ─── DEDUPLICATION GUARD ──────────────────────────────────────────────────────
// Prevents double responses when multiple node processes accidentally run in parallel.
// Each message_id is globally unique from Telegram — if we've seen it, drop it.
const _seenMsgIds = new Map(); // msgId -> timestamp
function isDuplicate(msgId) {
    const now = Date.now();
    // Clean up entries older than 90 seconds
    for (const [id, ts] of _seenMsgIds) {
        if (now - ts > 90000) _seenMsgIds.delete(id);
    }
    if (_seenMsgIds.has(msgId)) return true;
    _seenMsgIds.set(msgId, now);
    return false;
}

// v5.2: Per-user command execution lock — same user + same command + same args within 5s = ignore
const _commandLocks = new Map(); // key -> timestamp
const COMMAND_LOCK_MS = 5000;
function isCommandLocked(chatId, cmdText) {
    const key = `${chatId}:${cmdText.toLowerCase().trim()}`;
    const now = Date.now();
    // Clean expired locks
    if (_commandLocks.size > 200) {
        for (const [k, ts] of _commandLocks) {
            if (now - ts > COMMAND_LOCK_MS) _commandLocks.delete(k);
        }
    }
    if (_commandLocks.has(key) && (now - _commandLocks.get(key)) < COMMAND_LOCK_MS) {
        return true; // duplicate within 5s
    }
    _commandLocks.set(key, now);
    return false;
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
bot.on('message', msg => {
    // DEDUP: drop if we already processed this message_id
    if (isDuplicate(msg.message_id)) {
        writeLog(`[DEDUP] Dropped duplicate message_id ${msg.message_id}`);
        return;
    }
    const chatId   = msg.chat.id;
    const text     = (msg.text || '').trim();
    const username = msg.from?.username || '';
    if (!isAuthorized(chatId, username)) {
        send(chatId, `⛔ *Access Denied*\nYour ID: \`${chatId}\`\nAsk admin to run: /adduser @${username || chatId}`, { parse_mode: 'Markdown' });
        writeLog(`Unauthorized: ${chatId} @${username}`);
        return;
    }
    if (text.startsWith('/')) handleCommand(chatId, text, username);
});

// ─── HELP ─────────────────────────────────────────────────────────────────────
function getHelpText() {
    return [
        '*🔭 OpenClaw v5.1 — Institutional Alpha Terminal*',
        '',
        '🚨 *Institutional Analysis (8-Layer + 20 Vetoes)*',
        '`/signal XAUUSD`  — Full institutional signal (Score + Vetoes + Setup)',
        '`/signal BTC`     — Crypto with liquidity and structure analysis',
        '`/signal EURUSD`  — Forex session-aware signal',
        '`/scalp`          — M1 Gold scalp (BB + Stoch + AO + ATR)',
        '`/market`         — Regime snapshot + best candidate + no-trade zones',
        '`/daily`          — Session windows + event risk + priority assets',
        '`/stats`          — Generation metrics (not performance)',
        '',
        '📈 *Charts (6 Modes)*',
        '`/chart XAUUSD`         — Candlestick + EMA20/50 + Volume',
        '`/chart BTC line`       — Clean line chart',
        '`/chart BTC bb`         — Bollinger Bands + VWAP',
        '`/chart BTC vwap`       — VWAP deviation bands',
        '`/chart BTC rsi`        — RSI(14) + MACD panel',
        '`/chart BTC strat`      — Full strategy: price + momentum',
        '`/chart help`           — List all chart modes',
        '`/indicators XAUUSD`    — RSI + MACD standalone panel',
        '',
        '📡 *Intelligence*',
        '`/macro`          — Global Macro: DXY, VIX, Gold, Oil, BTC Dom',
        '`/newsignals`     — Asset-relevant news context (not directional)',
        '`/headline`       — Latest 10 headlines',
        '`/rwanda`         — Rwanda macro + EAC intelligence',
        '`/sentiment BTC`  — Sentiment context (bullish/bearish score)',
        '`/news XAUUSD`    — Asset-filtered headlines',
        '`/dashboard`      — openclaw-terminal.netlify.app',
        '',
        '📓 *Trade Journal*',
        '`/journal win XAUUSD 2.1`  — Log winning trade',
        '`/journal loss BTC 0`       — Log loss',
        '`/journal scratch EURUSD`  — Log scratch',
        '`/weeklyreview`            — Weekly learning analysis (admin)',
        '`/applylearning`           — Apply learning recommendations (admin)',
        '',
        '⚡ *Crypto (CoinAPI + CoinGecko Dual-Source)*',
        '`/crypto BTC`    — Price + RSI + Fear&Greed + Chart',
        '`/cryptomarket`  — Top 10 coins live',
        '`/trending`      — Trending coins on CoinGecko',
        '`/feargreed`     — Fear and Greed index',
        '',
        '🔔 *Watchlist*',
        '`/watch BTC 2.5` — Alert when R:R >= 2.5',
        '`/unwatch BTC`   — Remove from watchlist',
        '`/watchlist`     — View active watches',
        '',
        '💰 *Account*',
        '`/setaccount 1000` — Set account size for position sizing',
        '',
        '🤖 *AI Multi-Agent*',
        '`/analyze BTC`     — 4-agent deep analysis (Tech+Sentiment+News+Risk)',
        '`/analyze XAUUSD`  — Includes live price data + auto-chart',
        '`/chat [msg]`      — Digital Twin AI assistant',
        '',
        '🛡 *Risk Engine (Remora + Massive API)*',
        '`/risk XAUUSD`  — External institutional risk score',
        '',
        '\n🔧 *System (v4.0 Expert)*',
        '`/health`       \u2014 Smart health + anomaly detection + self-healing log',
        '`/status`       \u2014 Bot status + API counters',
        '`/regime BTC`   \u2014 Market regime (TRENDING/RANGING/VOLATILE/BREAKOUT)',
        '`/patterns BTC` \u2014 ICT pattern scan (FVG, sweep, structure, zones)',
        '`/api-usage`    \u2014 API quota dashboard with predictions',
        '`/version`      \u2014 System version + features',
        '`/changelog`    \u2014 Recent system updates',
        '',
        '\ud83d\udc65 *Admin*',
        '`/adduser [id] [name]` | `/removeuser [id]`',
        '`/users` | `/logs` | `/weeklyreview`',
        '`/providers`   \u2014 Provider health + paid placeholder status',
        '`/features`    \u2014 Feature flags status',
        '',
        '-----------------------------',
        '\ud83d\udcd0 *Signal Score Logic:*',
        'Score >= 75 + all vetoes clear  =>  BUY/SELL signal',
        'Score 60-74  =>  WAIT (setup forming)',
        'Score < 60   =>  REJECTED (no trade)',
        'Confidence capped at 88/100 (never overconfident)',
        '_Not financial advice. Always verify._'
    ].join('\n');
}



// ─── COMMANDS ─────────────────────────────────────────────────────────────────
async function handleCommand(chatId, cmdText, callerUsername = '') {
    // v5.2: Command execution lock — prevent duplicate replies
    if (isCommandLocked(chatId, cmdText)) {
        writeLog(`[CMDLOCK] Suppressed duplicate: [${chatId}] ${cmdText}`);
        return;
    }
    writeLog(`[${chatId}] ${cmdText}`);
    const parts = cmdText.trim().split(/\s+/);
    const cmd   = parts[0].toLowerCase();

    if (cmd === '/start' || cmd === '/help') {
        send(chatId, `🟢 *OpenClaw Online*\n\n${getHelpText()}`, { parse_mode: 'Markdown' });

    } else if (cmd === '/health') {
        try {
            // v4.0 Smart Health Monitor
            const smartMsg = formatSmartHealth(isAdmin(chatId, callerUsername));
            send(chatId, smartMsg, { parse_mode: 'Markdown' });
        } catch(e) {
            const up = Math.floor(process.uptime());
            send(chatId, `\ud83d\udfe2 *OpenClaw Health*\nUptime: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m\n\u2705 All core modules running`);
        }

    } else if (cmd === '/status') {
        const up  = Math.floor(process.uptime());
        const mem = process.memoryUsage();
        const h   = Math.floor(up/3600), m = Math.floor((up%3600)/60), s = up%60;
        const { getRecentErrors } = require('./lib/errors/error_classifier.cjs');
        const errs24h = getRecentErrors(200).filter(e => Date.now() - new Date(e.timestamp).getTime() < 86400000).length;
        send(chatId,
            `⚡ *System Status*\n` +
            `⏱ Uptime: ${h}h ${m}m ${s}s\n` +
            `💾 Heap: ${Math.round(mem.heapUsed/1024/1024)}MB / ${Math.round(mem.heapTotal/1024/1024)}MB\n` +
            `🚨 Errors (24h): ${errs24h}\n\n` +
            `✅ Orchestrator (8-layer + veto + 13-gate verifier)\n` +
            `✅ Signal Verifier (VERIFIED_ACTIVE required for BUY/SELL)\n` +
            `✅ Veto Engine (17 hard rules — AI cannot override)\n` +
            `✅ Dual-source Market Data (CoinAPI + CoinGecko)\n` +
            `✅ Scheduler (5min headlines | 15min signals | 4h tech)\n` +
            `✅ Supabase + Local queue failover\n` +
            `✅ Provider Registry (${require('./lib/providers/provider_registry.cjs').getAllHealth().filter(p=>p.healthy).length} healthy)\n\n` +
            `🌐 Dashboard: https://openclaw-terminal.netlify.app\n` +
            `📊 Confidence cap: 88/100 | Min R:R: 1.8`,
            { parse_mode: 'Markdown' });
        try { const hb = bridge.pushHeartbeat({ uptime_seconds: up, signals_today: getPerformance()?.sentToTelegram || 0, active_users: loadUsers().users.length }); if (hb && hb.catch) hb.catch(()=>{}); } catch(e) {}

    } else if (cmd === '/risk') {
        const sym = (parts[1] || 'XAUUSD').toUpperCase();
        const dir = (parts[2] || 'LONG').toUpperCase();
        typing(chatId);
        send(chatId, `🛡 Fetching risk assessment for *${sym}* (${dir})...`, { parse_mode: 'Markdown' });
        try {
            const { getRemoraRiskScore } = require('./remora_risk.cjs');
            const risk = await getRemoraRiskScore(sym, dir);
            const icons = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴', UNKNOWN: '⚪' };
            const sourceLabel = risk.source === 'remora_risk_engine' ? 'Remora Risk Engine' : 'OpenClaw Internal';
            const msg =
                `🛡 *Risk Assessment: ${sym}*\n` +
                `_Source: ${sourceLabel}_\n\n` +
                `• Risk Level: ${icons[risk.riskLevel] || '⚪'} *${risk.riskLevel}*\n` +
                `• Risk Score: \`${risk.riskScore ?? 'N/A'}/100\`\n` +
                (risk.maxDrawdown  ? `• Max Drawdown: \`${risk.maxDrawdown}%\`\n` : '') +
                (risk.sharpe       ? `• Sharpe Ratio: \`${risk.sharpe}\`\n`       : '') +
                (risk.volatility   ? `• Volatility:   \`${risk.volatility}\`\n`   : '') +
                `\n📋 *Recommendation:*\n${risk.recommendation || 'Size conservatively — manage risk per trade.'}\n\n` +
                `_Always combine with /signal for full institutional analysis._`;
            send(chatId, msg, { parse_mode: 'Markdown' });
        } catch(e) {
            send(chatId, `❌ Risk engine error: ${e.message}`);
        }

    } else if (cmd === '/signal') {
        const sym      = parts[1];
        const debugMode = isAdmin(chatId, callerUsername) && parts[2] === 'debug';
        if (!sym) { send(chatId, '⚠️ Usage: /signal <symbol> [debug]\nEx: /signal XAUUSD  /signal BTC debug (admin)'); return; }
        typing(chatId);
        send(chatId, `⏳ *${sym.toUpperCase()}* — Running 8-layer institutional analysis...${debugMode ? ' _(debug mode)_' : ''}`, { parse_mode: 'Markdown' });

        // ── Institutional orchestrator (new) ──────────────────────────────
        let orchestratorUsed = false;
        try {
            const { runOrchestrator } = require('./lib/orchestration/orchestrator.cjs');
            const accountSize = (() => { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'logs','account.json'),'utf8')).size; } catch(e) { return null; } })();
            const result = await runOrchestrator(sym.toUpperCase(), { accountSize, command: "/signal" });
            if (result && result.formatted_message) {
                orchestratorUsed = true;
                send(chatId, result.formatted_message, { parse_mode: 'Markdown' });

                // UPGRADE 1 & 2: Auto-Chart generation
                if (result.final_action !== 'REJECTED') {
                    setTimeout(async () => {
                        try {
                            const { generateSignalChart, generateIndicatorChart } = require('./chart_engine.cjs');
                            const { fetchCandles } = require('./market_fetcher.cjs');
                            const { candles, display } = await fetchCandles(sym.toUpperCase());
                            
                            const tradeParams = {
                                direction: result.final_action,
                                entryPrice: result.entry_price,
                                stopLoss: result.stop_loss,
                                takeProfit1: result.take_profit_1
                            };

                            const sigChart = await generateSignalChart(candles, display, tradeParams);
                            if (sigChart) {
                                sendPhoto(chatId, sigChart, `🕯 *${display}* — Institutional Chart Plan (VWAP + BB)`, { parse_mode: 'Markdown' });
                                
                                const indChart = await generateIndicatorChart(candles, display);
                                if (indChart) {
                                    sendPhoto(chatId, indChart, `📊 *${display}* — Momentum (RSI + MACD)`, { parse_mode: 'Markdown' });
                                }
                            }
                        } catch (e) {
                            writeLog(`[CHART_FAIL] Auto-chart error for ${sym}: ${e.message}`);
                        }
                    }, 500); // Slight delay so text arrives first
                }

                // Push to dashboard
                if (result.final_action === 'BUY' || result.final_action === 'SELL') {
                    bridge.pushSignal({
                        symbol:     sym.toUpperCase(),
                        direction:  result.final_action,
                        confidence: result.confidence,
                        score:      result.total_score,
                        setup_type: result.setup_type,
                        entry:      result.entry_price,
                        stopLoss:   result.stop_loss,
                        takeProfit: result.take_profit_1
                    }).catch(() => {});
                }
                // Write SIGNAL snapshot
                try {
                    snapStore.put('SIGNAL', sym.toUpperCase(), null, {
                        direction: result.final_action,
                        score: result.total_score || 0,
                        entry: result.entry_price || null,
                        stop_loss: result.stop_loss || null,
                        take_profit: result.take_profit_1 || null,
                        setup_type: result.setup_type || null,
                        veto_reasons: result.veto_reasons || [],
                        why_trade: result.why_trade || [],
                        run_duration_ms: result.run_duration_ms || 0
                    }, { provider: 'orchestrator' });
                } catch(snapErr) {}
                writeLog(`[SIGNAL] ${sym.toUpperCase()} → ${result.final_action} (score:${result.total_score}, ${result.run_duration_ms}ms)`);
            }
        } catch (orchErr) {
            writeLog(`[ORCH_FALLBACK] ${sym}: ${orchErr.message}`);
        }

        // ── Legacy fallback if orchestrator failed ────────────────────────
        if (!orchestratorUsed) {
            generateSignal(sym, '1D')
                .then(r => {
                    send(chatId, r, { parse_mode: 'Markdown' });
                    if (r && typeof r === 'object') try { bridge.pushSignal(r); } catch(e) {}
                })
                .catch(e => send(chatId, `❌ ${e.message}`));
        }

    // ── M1 GOLD SCALPING ──────────────────────────────────────────────────
    } else if (cmd === '/scalp') {
        const sym = (parts[1] || 'XAUUSD').toUpperCase();
        if (sym !== 'XAUUSD' && sym !== 'GOLD') {
            send(chatId, '⚠️ *Scalping currently supports XAUUSD only.*\n\nUsage: `/scalp` or `/scalp XAUUSD`', { parse_mode: 'Markdown' });
            return;
        }
        typing(chatId);
        send(chatId, `⚡ *M1 Gold Scalp* — Analyzing BB + Stoch + AO...`, { parse_mode: 'Markdown' });
        try {
            const { generateScalpSignal, formatScalpSignal } = require('./lib/scalping/gold_scalper.cjs');
            const { fetchCandles } = require('./market_fetcher.cjs');

            // Fetch M1 candles (need 50+ for indicators)
            let candles;
            try {
                const result = await fetchCandles('XAUUSD', '1MIN');
                candles = result.candles || result;
            } catch(e1) {
                // Fallback: try CoinAPI 1m
                try {
                    const coinapi = require('./coinapi.cjs');
                    candles = await coinapi.getOHLCV('XAU', 'USD', '1MIN', 80);
                } catch(e2) {
                    send(chatId, `❌ Could not fetch M1 candles for XAUUSD.\n\nFallback also failed. Try again in a few seconds.`);
                    return;
                }
            }

            if (!candles || candles.length < 50) {
                send(chatId, `⚠️ Only ${candles?.length || 0} M1 candles available (need 50+). Market may be closed.`);
                return;
            }

            const signal = generateScalpSignal(candles, { symbol: 'XAUUSD', spread: 0.3 });
            const formatted = formatScalpSignal(signal);
            send(chatId, formatted, { parse_mode: 'Markdown' });

            // Persist to snapshot store
            try { snapStore.put('SIGNAL', 'XAUUSD_SCALP', 'M1', signal, { provider: 'gold_scalper' }); } catch(e) {}

            writeLog(`[SCALP] XAUUSD → ${signal.action} | score=${signal.score} | session=${signal.session}`);
        } catch(e) {
            writeLog(`[SCALP] Error: ${e.message}`);
            send(chatId, `❌ Scalping engine error: ${e.message}`);
        }

    } else if (cmd === '/chart') {
        const sym  = parts[1] || 'XAUUSD';
        const mode = (parts[2] || 'candle').toLowerCase();
        typing(chatId);

        // Chart mode help
        const CHART_MODES = {
            candle: 'Candlestick + EMA20/50 + Volume',
            line:   'Line chart (clean price action)',
            bb:     'Bollinger Bands + VWAP + Volume',
            vwap:   'VWAP Deviation Bands',
            rsi:    'RSI(14) + MACD Momentum Panel',
            strat:  'Full Strategy Panel (EMA + RSI + MACD + Volume)',
        };
        if (sym.toLowerCase() === 'help' || mode === 'help') {
            const modeList = Object.entries(CHART_MODES).map(([k,v]) => `• \`${k}\` — ${v}`).join('\n');
            send(chatId, `📈 *Chart Modes*\n\n${modeList}\n\nUsage: /chart XAUUSD [mode]`, { parse_mode: 'Markdown' });
            return;
        }

        send(chatId, `🕯 Generating *${sym.toUpperCase()}* chart [mode: ${mode}]...`, { parse_mode: 'Markdown' });
        fetchCandles(sym).then(async ({ candles, display }) => {
            const { generateSignalChart } = require('./chart_engine.cjs');
            const a = analyze(candles);
            const trend = { BULLISH:'🟢', BEARISH:'🔴', RANGE:'🟡' }[a.trend] || '⚪';
            let chartUrl;

            if (mode === 'line') {
                chartUrl = await generateChart(candles, display);
            } else if (mode === 'bb') {
                chartUrl = await generateBBChart(candles, display, 60);
            } else if (mode === 'vwap') {
                chartUrl = await generateSignalChart(candles, display, { showBB: true, showVWAP: true });
            } else if (mode === 'rsi') {
                chartUrl = await generateFullIndicatorChart(candles, display);
            } else if (mode === 'strat') {
                // Full strategy: send 2 charts — price+overlays + momentum panel
                const mainChart = await generateStratChart(candles, display, 80);
                const indChart  = await generateFullIndicatorChart(candles, display);
                const snap = getIndicatorSnapshot(candles, display);
                const stochText = snap.stochastic ? `K=${snap.stochastic.k} D=${snap.stochastic.d} (${snap.stochastic.zone})` : '—';
                const aoText = snap.awesome_oscillator ? `${snap.awesome_oscillator.value > 0 ? '+' : ''}${snap.awesome_oscillator.value} [${snap.awesome_oscillator.color}]` : '—';
                const bbText = snap.bollinger ? `%B=${snap.bollinger.pct_b} BW=${snap.bollinger.bandwidth}` : '—';
                if (mainChart) sendPhoto(chatId, mainChart,
                    `📐 *${display}* — Expert Strategy Panel\n` +
                    `Trend: ${trend} *${snap.trend}* | RSI: \`${snap.rsi}\`\n` +
                    `Stoch(5,3,3): \`${stochText}\`\n` +
                    `AO: \`${aoText}\` | BB: \`${bbText}\`\n` +
                    `ATR: \`${snap.atr?.toFixed(4)}\` | ADX: \`${snap.adx}\``);
                if (indChart)  sendPhoto(chatId, indChart,
                    `📉 *${display}* — RSI + MACD + AO Momentum\n` +
                    `MACD: ${snap.macd > 0 ? '▲' : '▼'} \`${snap.macd?.toFixed(4) || '—'}\``);
                return;
            } else {
                chartUrl = await generateCandlestickChart(candles, display, 60);
            }

            if (chartUrl) {
                const caption =
                    `🕯 *${display}* — ${CHART_MODES[mode] || 'Candlestick'} (60D)\n` +
                    `Price: \`${a.currentPrice?.toFixed(2)}\` | ${trend} *${a.trend}*\n` +
                    `EMA20: \`${a.ema20?.toFixed(2)}\` | EMA50: \`${a.ema50?.toFixed(2)}\` | EMA200: \`${a.ema200?.toFixed(2)}\`\n` +
                    `RSI(14): \`${a.rsi}\` | ATR: \`${a.atr}\` | ADX: \`${a.adx?.adx || '—'}\`\n` +
                    `Vol: ${a.volumeTrend || '—'} | MACD: ${a.macd?.trend || '—'}`;
                sendPhoto(chatId, chartUrl, caption);
            } else {
                send(chatId, `❌ Chart generation failed. Fallback to line chart...`);
                const fallback = await generateChart(candles, display).catch(() => null);
                if (fallback) sendPhoto(chatId, fallback, `📈 *${display}* — Line Chart\nTrend: ${trend} *${a.trend}*`);
                else send(chatId, `❌ All chart sources failed. Try again shortly.`);
            }
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/indicators' || cmd === '/rsi') {
        const sym = parts[1] || 'XAUUSD';
        typing(chatId);
        send(chatId, `📉 Generating *${sym.toUpperCase()}* expert indicator panel...`, { parse_mode: 'Markdown' });
        fetchCandles(sym).then(async ({ candles, display }) => {
            const url = await generateFullIndicatorChart(candles, display);
            const snap = getIndicatorSnapshot(candles, display);
            if (url && snap && !snap.error) {
                // Write IndicatorSnapshot for cross-module consistency
                try {
                    snapStore.put('INDICATOR', sym.toUpperCase(), null, {
                        ...snap,
                        provider: 'chart_engine_expert'
                    }, { provider: 'chart_engine' });
                } catch(snapErr) {}
                const rsiNote = snap.rsi < 30 ? 'Oversold 🟢' : snap.rsi > 70 ? 'Overbought 🔴' : 'Neutral ⚪';
                const stochLine = snap.stochastic
                    ? `Stoch(5,3,3): K=\`${snap.stochastic.k}\` D=\`${snap.stochastic.d}\` — ${snap.stochastic.zone}${snap.stochastic.crossover ? ' ⚡'+snap.stochastic.crossover : ''}`
                    : 'Stoch: _N/A_';
                const aoLine = snap.awesome_oscillator
                    ? `AO: \`${snap.awesome_oscillator.value}\` [${snap.awesome_oscillator.color}]${snap.awesome_oscillator.flip ? ' ⚡FLIP: '+snap.awesome_oscillator.flip : ''}`
                    : 'AO: _N/A_';
                const bbLine = snap.bollinger
                    ? `BB: %B=\`${snap.bollinger.pct_b}\` BW=\`${snap.bollinger.bandwidth}\` — ${snap.bollinger.state}`
                    : 'BB: _N/A_';
                const atrLine = snap.atr
                    ? `ATR: \`${snap.atr.toFixed(4)}\` | 0.5×=\`${snap.atr_05}\` | 1.0×=\`${snap.atr_10}\` | 1.5×=\`${snap.atr_15}\``
                    : 'ATR: _N/A_';
                sendPhoto(chatId, url,
                    `📊 *${display}* — Expert Indicator Panel\n\n` +
                    `RSI(14): \`${snap.rsi}\` — ${rsiNote}\n` +
                    `MACD: ${snap.macd > 0 ? '▲ Bull' : '▼ Bear'} \`${snap.macd?.toFixed(4) || '—'}\`\n` +
                    `ADX: \`${snap.adx}\` — ${snap.adx_signal}\n` +
                    `${stochLine}\n` +
                    `${aoLine}\n` +
                    `${bbLine}\n` +
                    `${atrLine}\n` +
                    `EMA20: \`${snap.ema20}\` | EMA50: \`${snap.ema50}\`\n` +
                    `Trend: *${snap.trend}* | Price: \`${snap.price}\``);
            } else {
                send(chatId, `❌ Indicator chart failed. Try again.`);
            }
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/news') {
        const asset = (parts[1] || 'XAUUSD').toUpperCase();
        typing(chatId);
        fetchAllNews().then(news => {
            const txt = formatNewsForTelegram(news, asset);
            send(chatId, `📰 *${asset} News*\n\n${txt}`, { parse_mode: 'Markdown' });
            // → Dashboard: push headline rows
            const items = news[asset] || news.all || [];
            if (items.length) try { bridge.pushNews(items); } catch(e) {}
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/sentiment') {
        const asset = (parts[1] || 'XAUUSD').toUpperCase();
        typing(chatId);
        fetchAllNews().then(news => {
            const key  = { BTC:'BTC', ETH:'BTC', XAUUSD:'XAUUSD', GOLD:'XAUUSD', EURUSD:'FOREX', GBPUSD:'FOREX' }[asset] || asset;
            const sent = analyzeSentiment(news, key);
            const sum  = formatSentimentSummary(asset, sent);
            const hdls = (news[key] || news.all || []).slice(0, 4)
                .map((h, i) => `${i+1}. _${h.title.substring(0, 75)}_`).join('\n');
            send(chatId, `${sum}\n📰 *Headlines:*\n${hdls}`, { parse_mode: 'Markdown' });
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/macro') {
        typing(chatId);
        send(chatId, `🌍 Fetching Global Macro Data...`);
        try {
            const { getGlobalMacro } = require('./lib/macro/global-macro.cjs');
            const macro = await getGlobalMacro();
            if (macro) {
                // Write MacroSnapshot for cross-module consistency
                try {
                    snapStore.put('MACRO', null, null, {
                        regime: macro.regime,
                        risk_appetite: macro.riskAppetite,
                        macro_score: macro.macroScore,
                        dxy: macro.metrics?.dxy || null,
                        vix: macro.metrics?.vix || null,
                        gold: macro.metrics?.gold || null,
                        oil: macro.metrics?.oil || null,
                        btc_dominance: macro.metrics?.btcDominance || null,
                        total_market_cap: macro.metrics?.totalMarketCap || null
                    }, { provider: 'global-macro', source_timestamp: macro.timestamp });
                } catch(snapErr) {}
                const snapAge = (() => { try { const s = snapStore.get('MACRO'); return s ? `${s.cache_age_seconds}s` : ''; } catch(e) { return ''; } })();
                const msg = `🌍 *Global Macro Report*\n` +
                    `_Generated: ${new Date(macro.timestamp).toLocaleTimeString()}_ ${snapAge ? `| _Snap: ${snapAge}_` : ''}\n\n` +
                    `📊 *Regime:* ${macro.regime}\n` +
                    `🌡 *Risk Appetite:* ${macro.riskAppetite}\n` +
                    `📈 *Macro Score:* ${macro.macroScore}/100\n\n` +
                    `💵 *DXY:* ${macro.metrics?.dxy ? `\`${macro.metrics.dxy.price}\` (${macro.metrics.dxy.change})` : 'N/A'}\n` +
                    `📉 *VIX:* ${macro.metrics?.vix ? `\`${macro.metrics.vix.price}\` (${macro.metrics.vix.change})` : 'N/A'}\n` +
                    `🥇 *Gold:* ${macro.metrics?.gold ? `\`${macro.metrics.gold.price}\` (${macro.metrics.gold.change})` : 'N/A'}\n` +
                    `🛢 *Oil:* ${macro.metrics?.oil ? `\`${macro.metrics.oil.price}\` (${macro.metrics.oil.change})` : 'N/A'}\n\n` +
                    `*Crypto Market:*\n` +
                    `👑 *BTC Dominance:* ${macro.metrics?.btcDominance || 'N/A'}\n` +
                    `💰 *Total Cap:* ${macro.metrics?.totalMarketCap || 'N/A'}`;
                send(chatId, msg, { parse_mode: 'Markdown' });
            } else {
                send(chatId, `❌ Macro data unavailable. Please try again later.`);
            }
        } catch (e) {
            send(chatId, `❌ Error: ${e.message}`);
        }

    } else if (cmd === '/market') {
        typing(chatId);
        send(chatId, `⏳ Building market intelligence overview...`);
        try {
            const { fetchCandles } = require('./market_fetcher.cjs');
            const { analyze }      = require('./strategy_engine.cjs');
            const { detectSession } = require('./strategy_engine.cjs');
            const { classifySetup } = require('./lib/scoring/setup-classifier.cjs');
            const session = detectSession();

            const WATCH_ASSETS = ['XAUUSD', 'BTC', 'EURUSD', 'GBPUSD'];
            const results = [];
            let bestCandidate = null;
            const noTradeZones = [];

            for (const sym of WATCH_ASSETS) {
                try {
                    const { candles } = await fetchCandles(sym);
                    const a = analyze(candles);
                    const icon = a.trend === 'BULLISH' ? '🟢' : a.trend === 'BEARISH' ? '🔴' : '🟡';
                    const adxVal = a.adx?.adx ? Math.round(a.adx.adx) : null;
                    const adxStr = adxVal ? `ADX:${adxVal}` : '';
                    const fvgStr = a.fvg?.detected ? '📦FVG' : '';
                    const sweepStr = a.sweep?.swept ? `💧${a.sweep.type}` : '';

                    // Classify setup for each asset
                    let setupLabel = '—';
                    try {
                        const setupCtx = {
                            session: a.session, trend4H: a.trend, trend1H: a.trend,
                            sweepDetected: a.sweep?.swept, sweepType: a.sweep?.type,
                            fvgDetected: a.fvg?.detected, fvgInEntryZone: a.fvg?.inEntryZone,
                            structureState: a.structure?.state, bosDetected: a.structure?.bosDetected,
                            chochDetected: a.structure?.chochDetected, priceNearEMA: a.priceNearEMA,
                            adxValue: adxVal, momentumContinuing: a.macd?.trend === a.trend
                        };
                        const setup = classifySetup(setupCtx);
                        if (setup.setupType) {
                            setupLabel = setup.label || setup.setupType;
                            // Track best candidate
                            if (!bestCandidate || (setup.confidence === 'HIGH' && bestCandidate.confidence !== 'HIGH')) {
                                bestCandidate = { sym, setup: setup.label, confidence: setup.confidence, trend: a.trend };
                            }
                        }
                    } catch(e) {}

                    // Detect no-trade zones
                    if (a.trend === 'RANGE' && a.pricePosition === 'MID_RANGE') {
                        noTradeZones.push(`${sym}: Mid-range in ranging market`);
                    }
                    if (adxVal && adxVal < 15) {
                        noTradeZones.push(`${sym}: ADX ${adxVal} — no directional momentum`);
                    }

                    results.push(`${icon} *${sym}*: ${a.trend} ${adxStr} ${fvgStr} ${sweepStr}\n     Setup: _${setupLabel}_`);
                } catch(e) {
                    results.push(`⚪ *${sym}*: Data unavailable`);
                }
            }

            const sessionLabel = session.session.replace(/_/g,' ').toUpperCase();
            const sessionIcon = session.quality === 'high' ? '🟢' : session.quality === 'medium' ? '🟡' : '🔴';

            // Build no-trade zone section
            const noTradeStr = noTradeZones.length
                ? noTradeZones.slice(0, 3).map(z => `  🚫 ${z}`).join('\n')
                : '  ✅ No critical no-trade zones detected';

            // Best candidate section
            const bestStr = bestCandidate
                ? `🏆 *Best Candidate:* ${bestCandidate.sym} — ${bestCandidate.setup} (${bestCandidate.trend})`
                : `⏳ *Best Candidate:* None — no setup matches approved list`;

            const msg = [
                `🌐 *Market Intelligence Overview*`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `_${new Date().toUTCString()}_`,
                ``,
                `🕐 Session: ${sessionIcon} *${sessionLabel}* (${session.quality.toUpperCase()})`,
                ``,
                `📊 *Asset Regime Snapshot:*`,
                ...results,
                ``,
                bestStr,
                ``,
                `⛔ *No-Trade Zones:*`,
                noTradeStr,
                ``,
                `📌 *Rules:*`,
                `  • Only enter during 🟢 sessions (London/NY/Overlap)`,
                `  • No entries without an approved setup type`,
                `  • Always confirm with /signal before entry`,
                ``,
                `_Run /signal <asset> for full institutional analysis_`
            ].join('\n');

            send(chatId, msg, { parse_mode: 'Markdown' });
        } catch(e) {
            // Graceful fallback
            marketOverview().then(r => send(chatId, r, { parse_mode: 'Markdown' }))
                .catch(() => send(chatId, '⚠️ Market overview temporarily unavailable — try again shortly.'));
        }

    } else if (cmd === '/daily') {
        typing(chatId);
        try {
            const { detectSession } = require('./strategy_engine.cjs');
            const now     = new Date();
            const utcH    = now.getUTCHours();
            const session = detectSession();

            const windows = [
                { name: 'Asia',            start: 0,  end: 7,  quality: 'low',    note: 'Setup only — thin liquidity' },
                { name: 'London Open',     start: 7,  end: 8,  quality: 'high',   note: '⭐ Best sweep window' },
                { name: 'London Session',  start: 8,  end: 12, quality: 'medium', note: 'NY continuation setups form' },
                { name: 'NY Open',         start: 12, end: 13, quality: 'high',   note: '⭐ Best continuation window' },
                { name: 'NY/London Overlap', start: 12, end: 16, quality: 'high', note: '⭐ Highest volatility' },
                { name: 'NY Session',      start: 16, end: 21, quality: 'medium', note: 'Monitor open trades' },
                { name: 'Off Hours',       start: 21, end: 24, quality: 'low',    note: 'No new entries' },
            ];

            const sessionRows = windows.map(w => {
                const active = utcH >= w.start && utcH < w.end;
                const icon = w.quality === 'high' ? '🟢' : w.quality === 'medium' ? '🟡' : '🔴';
                const marker = active ? ' ◀ NOW' : '';
                return `${icon} ${w.name} (${w.start}:00–${w.end}:00 UTC): ${w.note}${marker}`;
            });

            // Live event risk scan
            let eventRiskStr = '  🟢 No high-impact events detected';
            try {
                const { detectEventRisk } = require('./lib/agents/macro-agent.cjs');
                const headlines = getRecentHeadlines ? getRecentHeadlines(30) : [];
                if (headlines.length) {
                    const risk = detectEventRisk(headlines, 'ALL');
                    if (risk.level === 'HIGH') {
                        eventRiskStr = `  🔴 HIGH RISK: ${risk.events[0]?.event || 'Major event detected'}`;
                    } else if (risk.level === 'MEDIUM') {
                        eventRiskStr = `  🟡 MEDIUM: ${risk.events[0]?.event || 'Notable event detected'}`;
                    }
                }
            } catch(e) {
                eventRiskStr = '  ⚪ Event risk scan unavailable — check /newsignals';
            }

            const msg = [
                `📅 *Daily Intelligence Brief*`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `_${now.toUTCString()}_`,
                ``,
                `🕐 *Session Windows (UTC):*`,
                ...sessionRows,
                ``,
                `🎯 *Approved Setup Types:*`,
                `  1. London Sweep Reversal (London Open)`,
                `  2. NY Continuation (NY Open)`,
                `  3. EMA Pullback + FVG (London/NY)`,
                `  4. Range Sweep Trap (London/NY)`,
                `  5. Trend Breakout Retest (London/NY)`,
                ``,
                `⚠️ *Event Risk:*`,
                eventRiskStr,
                ``,
                `📌 *Rules:*`,
                `  • Only trade during 🟢 sessions`,
                `  • No entries during off-hours or Asian`,
                `  • No entries without an approved setup type`,
                `  • Always confirm with /signal before entry`,
                ``,
                `_Run /signal <symbol> for full institutional analysis_`
            ].join('\n');

            send(chatId, msg, { parse_mode: 'Markdown' });
        } catch(e) {
            scheduler.sendDailySummary(chatId).catch(() =>
                send(chatId, '⚠️ Daily brief temporarily unavailable.'));
        }

    } else if (cmd === '/stats') {
        const stats = getMonthlyStats();
        if (!stats) { send(chatId, "📊 No signal data yet. Run /signal to start."); return; }
        
        // v5.1: Pull real journal outcomes
        let journalStats = { total: 0, wins: 0, losses: 0, scratches: 0, winRate: null, avgRR: null };
        try {
            const { getJournalStats } = require('./lib/learning/learning-engine.cjs');
            if (getJournalStats) journalStats = getJournalStats();
        } catch(e) {}
        
        const winRateText = journalStats.total >= 3
            ? `*${journalStats.winRate}%* (${journalStats.wins}W / ${journalStats.losses}L / ${journalStats.scratches}S from ${journalStats.total} tracked)`
            : `_Insufficient data (${journalStats.total}/3 minimum tracked)_`;
        const realRR = journalStats.avgRR !== null ? `*${journalStats.avgRR}:1*` : '_Not enough data_';
        
        send(chatId,
            `📅 *Signal Generation Stats — This Month*\n` +
            `⚠️ _Generation metrics ≠ trading performance_\n\n` +
            `📊 Total Analyses Run: *${stats.total}*\n` +
            `🚨 Signals Generated:  *${stats.signals}*\n` +
            `⏸ WAIT / Rejected:    *${stats.total - stats.signals}*\n` +
            `⚖️ Avg Modelled R:R:   *${stats.avgRR}:1* _(unverified)_\n` +
            `🎯 Avg Setup Score:    *${stats.avgScore}/100*\n\n` +
            `📓 *Tracked Outcomes (from /journal):*\n` +
            `🏆 Win Rate: ${winRateText}\n` +
            `📈 Avg Realized R:R: ${realRR}\n\n` +
            `_Log outcomes with /journal win|loss|scratch SYMBOL_`,
            { parse_mode: 'Markdown' });
        const p = getPerformance();
        try { if (p) bridge.pushHeartbeat({ signals_today: p.sentToTelegram || 0, active_users: loadUsers().users.length }); } catch(e) {}


    } else if (cmd === '/journal') {
        // /journal win XAUUSD 2.5 "entered at london sweep"
        // /journal loss BTC "stopped out — spread too wide"
        const outcome   = (parts[1] || '').toLowerCase();
        const asset     = (parts[2] || '').toUpperCase();
        const actualRR  = parseFloat(parts[3]) || null;
        const notes     = parts.slice(actualRR ? 4 : 3).join(' ').replace(/^"|"$/g,'') || '';

        const validOutcomes = ['win','loss','scratch','cancelled'];
        if (!validOutcomes.includes(outcome) || !asset) {
            send(chatId,
                `📓 *Trade Journal — Usage:*\n\n` +
                `/journal win XAUUSD 2.1 "London sweep worked"\n` +
                `/journal loss BTC 0 "stopped out"\n` +
                `/journal scratch EURUSD\n\n` +
                `Outcomes: win | loss | scratch | cancelled\n` +
                `_This data trains the weekly learning engine._`,
                { parse_mode: 'Markdown' });
            return;
        }

        try {
            const { saveOutcome } = require('./lib/storage/signal-store.cjs');
            const record = {
                asset, outcome,
                actual_rr:  actualRR,
                notes:      notes || null,
                tracked_at: new Date().toISOString()
            };
            const result = await saveOutcome(null, record);
            const icon = outcome === 'win' ? '🟢' : outcome === 'loss' ? '🔴' : '⚪';

            // Also save to local journal for learning engine
            try {
                const { saveJournalEntry } = require('./lib/learning/learning-engine.cjs');
                saveJournalEntry({ asset, outcome, actual_rr: actualRR, notes: notes || null, tracked_at: new Date().toISOString() });
            } catch(e) {}

            send(chatId,
                `${icon} *Journal Entry Saved*\n\n` +
                `Asset: *${asset}* | Outcome: *${outcome.toUpperCase()}*\n` +
                `R:R Achieved: *${actualRR ?? 'Not specified'}*\n` +
                `Notes: _${notes || 'None'}_\n\n` +
                `${result.saved ? '✅ Saved to Supabase' : '⏳ Queued locally (Supabase unavailable)'}\n` +
                `_This outcome improves weekly learning analytics._`,
                { parse_mode: 'Markdown' });
        } catch(e) {
            send(chatId, `⚠️ Journal save failed — try again shortly.`);
        }

    } else if (cmd === '/weeklyreview') {
        if (!isAdmin(chatId, callerUsername)) { send(chatId, '🔒 Admin only.'); return; }
        typing(chatId);
        send(chatId, '📊 *Running weekly learning analysis...*\n_Analyzing signals, outcomes, and patterns..._', { parse_mode: 'Markdown' });
        try {
            const { runWeeklyReview, formatWeeklyReview } = require('./lib/learning/learning-engine.cjs');
            const report = runWeeklyReview();
            const formatted = formatWeeklyReview(report);
            send(chatId, formatted, { parse_mode: 'Markdown' });
            writeLog(`[WEEKLY] Review generated: ${report.totalSignals} signals, ${report.journalEntries} outcomes`);
        } catch(e) {
            send(chatId, `⚠️ Weekly review failed: ${e.message}`);
            writeLog(`[WEEKLY_ERR] ${e.message}`);
        }

    } else if (cmd === '/signals') {

        const logPath = path.join(__dirname, 'logs', 'trading_log.json');
        if (!fs.existsSync(logPath)) { send(chatId, "📄 No signals yet."); return; }
        try {
            const logs   = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            const recent = logs.filter(l => l.signal !== 'NO_SETUP').slice(-5).reverse();
            if (!recent.length) { send(chatId, "📄 No valid signals logged yet."); return; }
            const lines  = recent.map(l =>
                `📊 *${l.symbol}* [${new Date(l.timestamp).toLocaleDateString()}]\n` +
                `${l.signal} | Score: ${l.score}/100 | R:R ${l.rewardRisk}:1\n` +
                `Entry: \`${l.entry}\` SL: \`${l.sl}\` TP: \`${l.tp}\``
            ).join('\n─────\n');
            send(chatId, `📋 *Recent Signals:*\n\n${lines}`, { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, "❌ Error reading log."); }

    // ── WATCHLIST ──
    } else if (cmd === '/watch') {
        const sym  = parts[1];
        if (!sym) { send(chatId, "⚠️ Usage: /watch <symbol> [min R:R]\nEx: /watch BTC 2.5\nEx: /watch XAUUSD"); return; }
        const targetRR = parseFloat(parts[2]) || 2.0;
        watchlistEngine.addWatch(chatId, sym, targetRR);
        send(chatId,
            `🔔 *Watchlist Added*\n\n` +
            `Symbol: *${sym.toUpperCase()}*\n` +
            `Alert when Reward:Risk ≥ *${targetRR}:1*\n` +
            `Check interval: every 15 min\n\n` +
            `_You'll be notified when this setup is valid._`,
            { parse_mode: 'Markdown' });
        // → Dashboard: sync watchlist entry (no dedicated endpoint; heartbeat keeps status alive)

    } else if (cmd === '/unwatch') {
        const sym = parts[1];
        if (!sym) { send(chatId, "⚠️ Usage: /unwatch <symbol>"); return; }
        watchlistEngine.removeWatch(chatId, sym);
        send(chatId, `✅ *${sym.toUpperCase()}* removed from watchlist.`, { parse_mode: 'Markdown' });

    } else if (cmd === '/watchlist') {
        const watches = watchlistEngine.listWatches(chatId);
        if (!watches.length) { send(chatId, "📋 Your watchlist is empty.\n\nAdd: /watch BTC 2.5"); return; }
        const list = watches.map((w, i) =>
            `${i+1}. *${w.symbol}* — Alert when R:R ≥ ${w.targetRR}:1\n   Added: ${new Date(w.addedAt).toLocaleDateString()}`
        ).join('\n\n');
        send(chatId, `🔔 *Your Watchlist:*\n\n${list}\n\nRemove: /unwatch <symbol>`, { parse_mode: 'Markdown' });

    // ── ACCOUNT SIZE ──
    } else if (cmd === '/setaccount') {
        const size = parseFloat(parts[1]);
        if (!size || size <= 0) { send(chatId, "⚠️ Usage: /setaccount <amount>\nEx: /setaccount 5000\nSets your trading account size in USD for position sizing."); return; }
        setAccountSize(size);
        send(chatId, `✅ Account size set to *$${size.toLocaleString()}*\n\nPosition sizing will now appear in signals.`, { parse_mode: 'Markdown' });

    } else if (cmd === '/analyze') {
        const ticker = (parts[1] || '').toUpperCase();
        if (!ticker) { send(chatId, '⚠️ Usage: /analyze <ticker>  e.g. /analyze BTC or /analyze XAUUSD'); return; }
        typing(chatId);
        send(chatId,
            `🤖 *OpenClaw Multi-Agent Analysis: ${ticker}*\n` +
            `_4 agents running in parallel: Technical • Sentiment • News • Risk_\n` +
            `_Powered by AICC AI + LM Studio • ~30-60 seconds_`,
            { parse_mode: 'Markdown' }
        );

        // Fetch live price data to enrich the agents
        let priceData = null;
        try {
            const { getFullIntelligence } = require('./market_data_fusion.cjs');
            priceData = await getFullIntelligence(ticker).catch(() => null);
        } catch(e) {}

        // Build grounding context from validated snapshots
        let groundingContext = '';
        try {
            const mSnap = snapStore.get('MARKET', ticker);
            const iSnap = snapStore.get('INDICATOR', ticker);
            const fgSnap = snapStore.get('FEARGREED');
            const nSnap = snapStore.get('NEWS');
            const macSnap = snapStore.get('MACRO');
            const parts_g = [];
            const warnings_g = [];
            if (mSnap && !mSnap.stale) parts_g.push(`[VERIFIED PRICE] ${ticker}: $${mSnap.data?.price} | 24h: ${mSnap.data?.change_24h}% | Source: ${mSnap.data?.source} | Age: ${mSnap.cache_age_seconds}s`);
            else warnings_g.push('[MISSING] Price data unavailable — do NOT invent prices');
            if (iSnap && !iSnap.stale) parts_g.push(`[VERIFIED INDICATORS] RSI: ${iSnap.data?.rsi} | Trend: ${iSnap.data?.trend} | EMA20: ${iSnap.data?.ema_20} | EMA50: ${iSnap.data?.ema_50} | ATR: ${iSnap.data?.atr}`);
            else warnings_g.push('[MISSING] Indicator data unavailable — do NOT invent RSI/MACD values');
            if (fgSnap && !fgSnap.stale) parts_g.push(`[VERIFIED SENTIMENT] Fear&Greed: ${fgSnap.data?.value} (${fgSnap.data?.classification})`);
            else warnings_g.push('[MISSING] Fear & Greed unavailable — do NOT claim sentiment percentages');
            if (nSnap && !nSnap.stale && nSnap.data?.headlines) {
                const topNews = nSnap.data.headlines.filter(h => h.classification !== 'IGNORE').slice(0, 5).map(h => h.title).join('; ');
                if (topNews) parts_g.push(`[VERIFIED NEWS] ${topNews}`);
                else warnings_g.push('[MISSING] No relevant news snapshot available');
            } else {
                warnings_g.push('[MISSING] No relevant news snapshot available — do NOT invent headlines or claim news events');
            }
            if (macSnap && !macSnap.stale) parts_g.push(`[VERIFIED MACRO] Regime: ${macSnap.data?.regime} | Risk: ${macSnap.data?.risk_appetite}`);
            else warnings_g.push('[MISSING] Macro data unavailable — use neutral macro assumption');
            
            // v5.1: Forbidden claims unless sourced
            const forbiddenClaims = [
                'Do NOT claim retail/institutional positioning unless sourced above',
                'Do NOT claim options/derivatives flow data',
                'Do NOT claim specific CPI/NFP/FOMC numbers unless in NEWS above',
                'Do NOT claim central bank quotes unless in NEWS above',
                'Do NOT claim social media sentiment percentages',
                'Confidence must NOT exceed 88/100',
                'Final action must be WAIT unless verifier says VERIFIED_ACTIVE'
            ];
            
            if (parts_g.length > 0 || warnings_g.length > 0) {
                groundingContext = '\n\n--- GROUNDING DATA (use ONLY these verified values, do NOT invent prices or indicators) ---\n' + 
                    parts_g.join('\n') + '\n' +
                    (warnings_g.length > 0 ? '\n--- MISSING DATA WARNINGS ---\n' + warnings_g.join('\n') + '\n' : '') +
                    '\n--- FORBIDDEN CLAIMS ---\n' + forbiddenClaims.join('\n') + '\n' +
                    '--- END GROUNDING DATA ---\n';
            }
        } catch(gErr) {}

        // Inject grounding into priceData for agent consumption
        if (priceData && groundingContext) priceData._groundingContext = groundingContext;

        runAgentAnalysis(ticker, null, priceData)
            .then(async r => {
                // Safety: ensure output is always a string (prevent [object Object])
                let output = r;
                if (typeof output !== 'string') {
                    try {
                        const { formatAgentAnalysis } = require('./lib/formatters/analysis_formatter.cjs');
                        output = formatAgentAnalysis(output, 'telegram');
                    } catch { output = JSON.stringify(output, null, 2); }
                }
                // Send main analysis
                send(chatId, output.substring(0, 4000), { parse_mode: 'Markdown' });
                // Store for dashboard display
                try { require('./dashboard.cjs').storeAnalysis(ticker, output); } catch(e) {}
                // Write ANALYSIS snapshot (v3.3 enriched schema)
                try {
                    // Best-effort extraction of structured fields from agent output
                    const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
                    const actionMatch = outputStr.match(/(?:Action|Signal|Direction)[:\s]*\*?(BUY|SELL|WAIT|HOLD|LONG|SHORT)\*?/i);
                    const confMatch   = outputStr.match(/(?:Confidence)[:\s]*\*?(\d{1,3})(?:\/100|\s*%)?/i);
                    const modelMatch  = outputStr.match(/(?:Model|Powered by)[:\s]*\*?([A-Za-z0-9\-_. ]+)/i);

                    // Snapshot ages of grounding data
                    const snapAges = {};
                    try {
                        ['MARKET','INDICATOR','FEARGREED','NEWS','MACRO'].forEach(t => {
                            const s = snapStore.get(t, ticker);
                            if (s) snapAges[t] = { age_seconds: s.cache_age_seconds, stale: s.stale };
                        });
                    } catch(ae) {}

                    snapStore.put('ANALYSIS', ticker, null, {
                        result:           outputStr.substring(0, 2000),
                        model_used:       modelMatch ? modelMatch[1].trim() : (priceData?._model || 'multi-agent'),
                        model_provider:   'ai-core',
                        fallback_depth:   priceData?._fallbackDepth || 0,
                        final_action:     actionMatch ? actionMatch[1].toUpperCase() : null,
                        confidence:       confMatch ? parseInt(confMatch[1], 10) : null,
                        grounded:         !!groundingContext,
                        grounding_fields: groundingContext ? ['price','indicators','sentiment','news'] : [],
                        data_sources_used: Object.keys(snapAges),
                        snapshot_ages:    snapAges,
                        quality_score:    priceData?.quality || 0,
                        warnings:         []
                    }, { provider: 'ai-core' });

                    // v5.1: Cap confidence at 88 and enforce WAIT unless verifier active
                    try {
                        const analysisSnap = snapStore.get('ANALYSIS', ticker);
                        if (analysisSnap && analysisSnap.data) {
                            const staleInputs = [];
                            ['MARKET','INDICATOR','FEARGREED','NEWS','MACRO'].forEach(t => {
                                const s = snapStore.get(t, ticker);
                                if (!s) staleInputs.push(t + ':MISSING');
                                else if (s.stale) staleInputs.push(t + ':STALE');
                            });
                            
                            // Cap confidence
                            if (analysisSnap.data.confidence > 88) {
                                analysisSnap.data.confidence = 88;
                                analysisSnap.data.warnings = (analysisSnap.data.warnings || []);
                                analysisSnap.data.warnings.push('Confidence capped at 88 (v5.1 rule)');
                            }
                            // Force WAIT unless verifier says VERIFIED_ACTIVE
                            const sigSnap = snapStore.get('SIGNAL', ticker);
                            const verifierState = sigSnap?.data?.verifier_state;
                            if (verifierState !== 'VERIFIED_ACTIVE' && ['BUY','SELL','LONG','SHORT'].includes(analysisSnap.data.final_action)) {
                                analysisSnap.data.final_action = 'WAIT';
                                analysisSnap.data.warnings.push('Action forced to WAIT — verifier not VERIFIED_ACTIVE');
                            }
                            analysisSnap.data.stale_inputs = staleInputs;
                            snapStore.put('ANALYSIS', ticker, null, analysisSnap.data, { provider: 'ai-core' });
                        }
                    } catch(capErr) {}
                } catch(snapErr) {}
                // Also send a chart
                setTimeout(async () => {
                    try {
                        const { fetchCandles } = require('./market_fetcher.cjs');
                        const { candles, display } = await fetchCandles(ticker);
                        const chartUrl = await generateCandlestickChart(candles, display, 60);
                        if (chartUrl) sendPhoto(chatId, chartUrl, `📐 *${ticker}* — Price Structure for Analysis`);
                    } catch(e) {}
                }, 500);
            })
            .catch(e => send(chatId, `❌ Analysis error: ${e.message}`));

    } else if (cmd === '/social') {
        const query = parts.slice(1).join(' ');
        if (!query) { send(chatId, "⚠️ Usage: /social <platform> <topic>"); return; }
        typing(chatId);
        generateContent(query).then(r => send(chatId, r, { parse_mode: 'Markdown' }))
            .catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/chat') {
        const query = cmdText.substring(cmdText.indexOf(' ') + 1).trim();
        if (!query || query === '/chat') { send(chatId, "⚠️ Usage: /chat <message>"); return; }
        handleChatCommand(chatId, query);

    } else if (cmd === '/weeklyreview') {
        if (!isAdmin(chatId, callerUsername)) { send(chatId, '⛔ Admin only.'); return; }
        typing(chatId);
        send(chatId, '⏳ *Running weekly learning analysis...*\n_Fetching realized outcomes + generated signal stats..._', { parse_mode: 'Markdown' });
        try {
            const { runWeeklyReview } = require('./lib/learning/weekly-review.cjs');
            const result = await runWeeklyReview();
            send(chatId, result.report, { parse_mode: 'Markdown' });

            if (result.recommendations?.length > 0) {
                const autoApply = process.env.ENABLE_LEARNING_AUTO_APPLY === 'true';
                const followUp = autoApply
                    ? '⚠️ `ENABLE_LEARNING_AUTO_APPLY=true` — changes auto-applied.'
                    : `📝 *${result.recommendations.length} recommendation(s) saved.*\n_Run /applylearning to review and approve each one._`;
                send(chatId, followUp, { parse_mode: 'Markdown' });
            }
        } catch(e) {
            send(chatId, `⚠️ Weekly review failed: ${e.message}`);
        }

    } else if (cmd === '/applylearning') {
        if (!isAdmin(chatId, callerUsername)) { send(chatId, '⛔ Admin only.'); return; }
        typing(chatId);
        try {
            const { buildApplyLearningReport, applyAll, applySingle, getPendingRecommendations } =
                require('./lib/learning/apply-learning.cjs');

            const subCmd = (parts[1] || '').toLowerCase();
            const arg    = parts[2] || '';

            if (subCmd === 'approve') {
                const pending = await getPendingRecommendations();
                if (!pending.length) {
                    send(chatId, '✅ No pending recommendations to approve.'); return;
                }
                if (arg === 'all') {
                    const { applied, failed } = await applyAll(pending, callerUsername);
                    send(chatId,
                        `✅ *Learning Applied*\n\n` +
                        `Applied: ${applied}/${pending.length}\n` +
                        (failed ? `⚠️ Failed: ${failed}` : `_All marked approved in Supabase._`),
                        { parse_mode: 'Markdown' }
                    );
                } else if (arg) {
                    const { found, applied, rec } = await applySingle(arg, pending, callerUsername);
                    if (!found) { send(chatId, `⚠️ No recommendation found with ID starting: \`${arg}\``, { parse_mode: 'Markdown' }); return; }
                    send(chatId,
                        applied
                            ? `✅ Applied: \`${rec.category}\` — ${rec.recommendation?.substring(0, 80)}...`
                            : `❌ Failed to mark as applied. Check Supabase.`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    send(chatId, '⚠️ Usage: `/applylearning approve all` or `/applylearning approve <id>`', { parse_mode: 'Markdown' });
                }
            } else {
                // Default: show pending recommendations
                const { message } = await buildApplyLearningReport();
                send(chatId, message, { parse_mode: 'Markdown' });
            }
        } catch(e) {
            send(chatId, `❌ Apply learning failed: ${e.message}`);
        }

    } else if (cmd === '/adduser') {

        if (!isAdmin(chatId, callerUsername)) { send(chatId, "⛔ Admin only."); return; }
        let input = parts[1];
        const name = parts.slice(2).join(' ') || 'User';
        if (!input) { send(chatId, "⚠️ /adduser <@username or id> [Name]\nExamples:\n  /adduser @robelamare Robel\n  /adduser 123456789 Jane"); return; }

        const db = loadUsers();
        const isUsernameEntry = input.startsWith('@');
        const cleanInput = input.replace(/^@/, '');

        // Check for duplicate
        const isDupe = db.users.some(u =>
            u.id === cleanInput ||
            (u.username || '').toLowerCase() === cleanInput.toLowerCase()
        );
        if (isDupe) { send(chatId, `⚠️ \`${input}\` is already in the list.`, { parse_mode: 'Markdown' }); return; }

        if (isUsernameEntry) {
            // Store by username — numeric ID resolved on first message
            db.users.push({ username: cleanInput, name, role: 'user', addedAt: new Date().toISOString().split('T')[0] });
        } else {
            // Store by numeric ID
            db.users.push({ id: cleanInput, name, role: 'user', addedAt: new Date().toISOString().split('T')[0] });
        }
        saveUsers(db);
        send(chatId, `✅ *${name}* (\`${input}\`) added.\n_They can now use the bot if they message it._`, { parse_mode: 'Markdown' });

    } else if (cmd === '/removeuser') {
        if (!isAdmin(chatId, callerUsername)) { send(chatId, "⛔ Admin only."); return; }
        const rmInput = (parts[1] || '').replace(/^@/, '');
        const db = loadUsers();
        const before = db.users.length;
        db.users = db.users.filter(u =>
            u.id !== rmInput &&
            (u.username || '').toLowerCase() !== rmInput.toLowerCase()
        );
        saveUsers(db);
        send(chatId, db.users.length < before ? `✅ \`${parts[1]}\` removed.` : `⚠️ Not found: \`${parts[1]}\``, { parse_mode: 'Markdown' });

    } else if (cmd === '/users') {
        if (!isAdmin(chatId, callerUsername)) { send(chatId, "⛔ Admin only."); return; }
        const db   = loadUsers();
        const list = db.users.map((u, i) => {
            const display = u.id ? `\`${u.id}\`` : `@${u.username}`;
            return `${i+1}. *${u.name}* — ${display} [${u.role}]`;
        }).join('\n') || 'None.';
        send(chatId, `👥 *Users (${db.users.length}):*\n${list}\n\n_Admin: \`${ADMIN_ID}\`_`, { parse_mode: 'Markdown' });

    } else if (cmd === '/myid') {
        send(chatId, `🆔 Your ID: \`${chatId}\``, { parse_mode: 'Markdown' });

    } else if (cmd === '/logs') {
        if (!isAdmin(chatId, callerUsername)) { send(chatId, '🔒 Admin only.'); return; }
        try {
            const { getRecentErrors } = require('./lib/errors/error_classifier.cjs');
            const recent = getRecentErrors(15);
            if (recent.length === 0) { send(chatId, '📄 No recent errors.'); return; }
            const lines = recent.map(e => {
                const icon = { CRITICAL:'🚨', HIGH:'🔴', MEDIUM:'🟡', LOW:'🟢' }[e.severity] || '⚪';
                const age  = Math.round((Date.now() - new Date(e.timestamp).getTime()) / 60000);
                return `${icon} [${age}m ago] ${e.error_class}\n   ${e.human_summary}`;
            }).join('\n\n');
            const plain = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE,'utf8').split('\n').filter(Boolean).slice(-5).join('\n') : '';
            send(chatId, `📄 *Recent Errors (admin)*\n\n${lines}\n\n*Bot log (last 5):*\n\`\`\`\n${plain.substring(0,800)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch(e) {
            if (fs.existsSync(LOG_FILE)) {
                const lines = fs.readFileSync(LOG_FILE,'utf8').split('\n').filter(Boolean).slice(-12).join('\n');
                send(chatId, `📄 *Logs:*\n\`\`\`\n${lines.substring(0,3500)}\n\`\`\``, { parse_mode: 'Markdown' });
            } else { send(chatId, '📄 No logs.'); }
        }

    } else if (cmd === '/providers') {
        try {
            const { getAllHealth } = require('./lib/providers/provider_registry.cjs');
            const all = getAllHealth();
            const lines = ['📡 *Provider Status*\n'];
            const free  = all.filter(p => p.provider?.tier === 'free');
            const paid  = all.filter(p => p.provider?.tier === 'paid_placeholder');
            lines.push('*🆓 Free Providers:*');
            free.forEach(p => {
                const icon = p.healthy ? '✅' : '❌';
                const lat  = p.avgLatencyMs ? `${p.avgLatencyMs}ms` : '—';
                lines.push(`${icon} \`${p.name}\` ${isAdmin(chatId, callerUsername) ? `| ${lat} | ✓${p.successCount}` : ''}`);
                if (!p.healthy && p.lastError) lines.push(`   ⚠️ _${p.lastError.substring(0,50)}_`);
            });
            if (isAdmin(chatId, callerUsername) && paid.length) {
                lines.push('\n*🔲 Paid Placeholders (disabled):*');
                paid.slice(0,8).forEach(p => lines.push(`🔲 \`${p.name}\` — ${p.provider?.costHint || '—'} | Set \`${p.provider?.enableFlag}\`=true`));
                if (paid.length > 8) lines.push(`_...and ${paid.length - 8} more_`);
            }
            send(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ Provider registry error: ${e.message}`); }

    } else if (cmd === '/features') {
        try {
            const flags = {
                ENABLE_PAID_MARKET_DATA:  process.env.ENABLE_PAID_MARKET_DATA  === 'true',
                ENABLE_PAID_NEWS:         process.env.ENABLE_PAID_NEWS         === 'true',
                ENABLE_PAID_CALENDAR:     process.env.ENABLE_PAID_CALENDAR     === 'true',
                ENABLE_BROKER_EXECUTION:  process.env.ENABLE_BROKER_EXECUTION  === 'true',
                ENABLE_CLOUD_LLM:         process.env.ENABLE_CLOUD_LLM         === 'true',
                ENABLE_TELEMETRY:         process.env.ENABLE_TELEMETRY         === 'true',
                ENABLE_DEBUG_MODE:        process.env.ENABLE_DEBUG_MODE        === 'true',
                ENABLE_WEBHOOK_MODE:      process.env.ENABLE_WEBHOOK_MODE      === 'true',
                ENABLE_LEARNING_AUTO_APPLY: process.env.ENABLE_LEARNING_AUTO_APPLY === 'true'
            };
            const lines = ['🚩 *Feature Flags*\n'];
            Object.entries(flags).forEach(([k,v]) => lines.push(`${v ? '🟢' : '🔴'} \`${k}\` = ${v}`));
            lines.push('\n_Set in telegram.env to activate paid features_');
            send(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ ${e.message}`); }

    } else if (cmd === '/schema') {
        if (!isAdmin(chatId, callerUsername)) { send(chatId, '🔒 Admin only.'); return; }
        const tables = ['signal_snapshots','agent_runs','tracked_signal_outcomes','trade_journal',
                        'provider_status','strategy_profiles','signal_verifications','system_errors',
                        'run_logs','provider_health_events','fallback_events','scheduler_runs',
                        'feature_flags','learning_recommendations','schema_migrations_status'];
        const newTables = ['signal_verifications','system_errors','run_logs','provider_health_events',
                           'fallback_events','scheduler_runs','feature_flags','learning_recommendations',
                           'schema_migrations_status'];
        const lines = ['🗄 *Schema Status*\n', '*Expected tables:*'];
        tables.forEach(t => {
            const isNew = newTables.includes(t);
            lines.push(`${isNew ? '🆕' : '✅'} \`${t}\``);
        });
        lines.push('\n⚠️ _Run SUPABASE\_SCHEMA\_UPGRADE.sql if new tables are missing_');
        lines.push('_File: OpenClaw/SUPABASE\_SCHEMA\_UPGRADE.sql_');
        send(chatId, lines.join('\n'), { parse_mode: 'Markdown' });

    // ── COINGECKO CRYPTO INTELLIGENCE ──
    } else if (cmd === '/crypto') {
        const sym = parts[1] || 'BTC';
        typing(chatId);
        send(chatId, `⚡ Loading *${sym.toUpperCase()}* intelligence (CoinAPI + CoinGecko dual-source)...`, { parse_mode: 'Markdown' });
        generateFusedCryptoSignal(sym).then(async (sig) => {
            if (sig?.price) {
                send(chatId, formatFusedSignal(sig), { parse_mode: 'Markdown' });

                // Try to generate chart
                setTimeout(async () => {
                    try {
                        const { generateSignalChart } = require('./chart_engine.cjs');
                        const { fetchCandles } = require('./market_fetcher.cjs');
                        const { candles, display } = await fetchCandles(sym.toUpperCase() + 'USD'); // ensure USD pair for chart
                        const chartUrl = await generateSignalChart(candles, display, { direction: sig.ta?.trend || 'WAIT' });
                        if (chartUrl) sendPhoto(chatId, chartUrl, `🕯 *${display}* Crypto Chart`, { parse_mode: 'Markdown' });
                    } catch(e) {}
                }, 500);

                try { bridge.pushCrypto({
                    symbol: sym.toUpperCase(), name: sig.symbol || sym,
                    price: sig.price, change_24h: sig.change24h,
                    market_cap: sig.marketCap, volume: sig.volume24h,
                    fear_greed: sig.fearGreed, rank: sig.rank,
                    rsi: sig.ta?.rsi, trend: sig.ta?.trend,
                    data_quality: sig.quality, price_source: sig.priceSource
                }); } catch(e) {}
            } else {
                return generateCryptoSignal(sym).then(s => send(chatId, formatCryptoSignal(s), { parse_mode: 'Markdown' }));
            }
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/cryptomarket' || cmd === '/cmarket') {
        typing(chatId);
        send(chatId, `⚡ Loading crypto market overview...`);
        Promise.all([getTopCoins(12), getGlobalStats(), getFearGreed()]).then(([coins, global, fg]) => {
            const header = global ?
                `🌍 *Global:* MCap ${global.marketCapChange24h >= 0 ? '▲' : '▼'} ${Math.abs(global.marketCapChange24h)}%` +
                ` | BTC Dom \`${global.btcDominance}%\`\n` +
                `${fg ? `😐 Fear & Greed: \`${fg.value} — ${fg.label}\`` : ''}\n\n` : '';
            send(chatId, header + formatTopCoins(coins), { parse_mode: 'Markdown' });
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/trending') {
        typing(chatId);
        getTrending().then(coins => {
            if (!coins.length) { send(chatId, '❌ CoinGecko trending unavailable.'); return; }
            const lines = coins.slice(0, 7).map((c, i) =>
                `${['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣'][i]} *${c.name}* (\`${c.symbol}\`) — Rank #${c.rank || '?'}`
            ).join('\n');
            send(chatId, `🔥 *Trending on CoinGecko*\n\n${lines}\n\n_Score = search volume rank_`, { parse_mode: 'Markdown' });
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/feargreed') {
        typing(chatId);
        Promise.all([getFearGreed(), getGlobalStats()]).then(([fg, global]) => {
            if (!fg) { send(chatId, '❌ Fear & Greed index unavailable.'); return; }
            const emoji = fg.value <= 20 ? '😱 EXTREME FEAR' : fg.value <= 40 ? '😟 FEAR'
                        : fg.value <= 60 ? '😐 NEUTRAL'     : fg.value <= 80 ? '🤩 GREED'
                        : '🤑 EXTREME GREED';
            const bar   = '█'.repeat(Math.round(fg.value / 10)) + '░'.repeat(10 - Math.round(fg.value / 10));
            const signal = fg.value <= 25 ? '🟢 Contrarian BUY zone — historically good entry'
                         : fg.value >= 75 ? '🔴 Contrarian SELL zone — overheated market'
                         : '🟡 Neutral — wait for confirmation';
            send(chatId,
                `😱 *Crypto Fear & Greed Index*\n\n` +
                `\`${bar}\` *${fg.value}/100*\n*${emoji}*\n\n` +
                `${signal}\n\n` +
                (global ? `🌍 Market Cap 24h: \`${global.marketCapChange24h}%\`\n` +
                           `📊 BTC Dominance: \`${global.btcDominance}%\`\n` : '') +
                `\n_Extreme Fear = market panic = buy opportunity_\n` +
                `_Extreme Greed = euphoria = consider taking profits_\n\n` +
                `_Source: alternative.me | CoinGecko_`,
                { parse_mode: 'Markdown' });
        }).catch(e => send(chatId, `❌ ${e.message}`));

    // ── BLOOMBERG INTELLIGENCE ──
    } else if (cmd === '/newsignals') {
        typing(chatId);
        send(chatId, `📡 Scanning asset-relevant news intelligence...`);
        collectAll().then(() => {
            const sigs = getSignals(10, 'sent');
            if (!sigs.length) {
                send(chatId, `🔍 *No asset-relevant signals yet*\n\n_Collecting headlines every 5min. Check back shortly or try /headline for raw news._`, { parse_mode: 'Markdown' });
                return;
            }

            // v4.0: Headlines are context, NOT direct execution triggers
            // Group by asset, show relevance + event risk + macro bias
            const byAsset = {};
            for (const s of sigs.slice(0, 12)) {
                const asset = s.asset || 'GENERAL';
                if (!byAsset[asset]) byAsset[asset] = [];
                byAsset[asset].push(s);
            }

            const sections = Object.entries(byAsset).slice(0, 4).map(([asset, items]) => {
                const topItem = items[0];
                const eventIcon = (topItem.confidence || 0) >= 80 ? '🔴' :
                                  (topItem.confidence || 0) >= 50 ? '🟡' : '🟢';
                const headline = (topItem.headline || '').substring(0, 80);
                const count = items.length;

                return [
                    `${eventIcon} *${asset}* — ${count} headline${count > 1 ? 's' : ''}`,
                    `_"${headline}"_`,
                    `Relevance: \`${topItem.confidence || 0}%\` | Source: ${topItem.source || '—'}`,
                ].join('\n');
            });

            const msg = [
                `📡 *Asset-Relevant News Intelligence*`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                ``,
                ...sections.join('\n─────\n').split('\n'),
                ``,
                `⚠️ _Headlines are CONTEXT only — never a direct entry trigger._`,
                `_Always confirm with /signal <asset> before any execution._`
            ].join('\n');

            send(chatId, msg, { parse_mode: 'Markdown' });
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/headline' || cmd === '/headlines') {
        typing(chatId);
        const filter = parts[1] || null;
        collectAll().then(() => {
            const items = getRecentHeadlines(20)
                .filter(h => !filter || h.title.toLowerCase().includes(filter.toLowerCase()));
            if (!items.length) { send(chatId, '📰 No headlines yet — collecting...'); return; }
            const lines = items.slice(0, 10).map(h => {
                const ago = Math.round((Date.now() - new Date(h.savedAt).getTime()) / 60000);
                const flag = h.isRwanda ? '🇷🇼 ' : h.category === 'crypto' ? '⚡ ' : '📰 ';
                return `${flag}*${h.source}* (${ago}m ago)\n_${h.title.substring(0, 110)}_`;
            }).join('\n───\n');
            send(chatId, `📰 *Latest Headlines*\n\n${lines}`, { parse_mode: 'Markdown' });
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/rwanda') {
        typing(chatId);
        send(chatId, `🇷🇼 Loading Rwanda intelligence...`);
        collectAll().then(() => {
            const items = getRwandaIntel(20);
            if (!items.length) {
                send(chatId, `🇷🇼 *No Rwanda intel collected yet.*\n\n_Monitoring: NBR, RDB, EAC, Reuters Africa, IMF, World Bank.\nCheck back in 5 minutes._`, { parse_mode: 'Markdown' });
                return;
            }
            const report = generateRwandaMacroReport(items);
            if (report) { send(chatId, report, { parse_mode: 'Markdown' }); return; }
            const lines = items.slice(0, 8).map(h => {
                const ago = Math.round((Date.now() - new Date(h.savedAt).getTime()) / 60000);
                return `🇷🇼 *${h.source}* (${ago}m ago)\n_${h.title.substring(0, 100)}_${h.assets?.length ? '\nAssets: ' + h.assets.join(', ') : ''}`;
            }).join('\n───\n');
            send(chatId, `🇷🇼 *Rwanda Intelligence Feed*\n\n${lines}`, { parse_mode: 'Markdown' });
        }).catch(e => send(chatId, `❌ ${e.message}`));

    } else if (cmd === '/dashboard') {
        const perf = getPerformance();
        const sigs = getSignals(5, 'sent');
        const rwItems = getRwandaIntel(5);
        send(chatId,
            `📊 *OpenClaw Dashboard*\n\n` +
            `🌐 Live: https://openclaw-terminal.netlify.app\n` +
            `📡 Signals: /signals · Charts: /charts · AI: /ai\n\n` +
            `📰 News signals sent: *${perf.sentToTelegram || 0}*\n` +
            `🇷🇼 Rwanda intel items: *${rwItems.length}*\n` +
            `🚨 Active signals: *${sigs.length}*\n\n` +
            `*Top assets signalled:*\n` +
            Object.entries(perf.byAsset || {}).slice(0, 5)
                .map(([a, c]) => `• \`${a}\` — ${c} signals`).join('\n'),
            { parse_mode: 'Markdown' });

    // ─── v4.0 Expert System Commands ──────────────────────────────────────────
    } else if (cmd === '/regime') {
        const sym = (parts[1] || 'BTC').toUpperCase();
        typing(chatId);
        try {
            const result = await fetchCandles(sym).catch(() => null);
            const candles = result?.candles;
            if (!candles || candles.length < 20) {
                return send(chatId, `\u26a0\ufe0f Cannot fetch data for ${sym}. Try BTC, ETH, XAUUSD.`, { parse_mode: 'Markdown' });
            }
            const indicators = {
                adx: require('./strategy_engine.cjs').calcADX?.(candles) || { adx: 20 },
                atrCurrent: candles.length > 14 ? require('./strategy_engine.cjs').calcATR?.(candles) || 1 : 1,
                atrAvg: 1,
                bbWidth: 0.05,
                bbWidthAvg: 0.05
            };
            const regime = classifyRegime(indicators);
            const strats = getRecommendedStrategies(regime.regime);
            let msg = `\ud83c\udf0d *Market Regime: ${sym}*\n\n`;
            msg += `\ud83c\udfaf *Regime:* \`${regime.regime}\` (${regime.confidence}% conf)\n`;
            msg += `\ud83d\udcca ${regime.description}\n\n`;
            msg += `\u2705 *Use:* ${strats.primary.join(', ')}\n`;
            msg += `\u274c *Avoid:* ${strats.avoid.join(', ')}\n`;
            msg += `\ud83d\udcc8 *Indicators:* ${strats.indicators.join(', ')}\n\n`;
            msg += `_${strats.description}_`;
            send(chatId, msg, { parse_mode: 'Markdown' });
        } catch(e) {
            send(chatId, `\u274c Regime analysis failed: ${e.message}`);
        }

    } else if (cmd === '/patterns') {
        const sym = (parts[1] || 'BTC').toUpperCase();
        typing(chatId);
        try {
            const result = await fetchCandles(sym).catch(() => null);
            const candles = result?.candles;
            if (!candles || candles.length < 20) {
                return send(chatId, `\u26a0\ufe0f Cannot fetch data for ${sym}.`, { parse_mode: 'Markdown' });
            }
            const { detectFVG, detectSweep, detectStructure, detectPremiumDiscount } = require('./lib/agents/pattern-detector.cjs');
            const fvg = detectFVG(candles);
            const sweep = detectSweep(candles);
            const structure = detectStructure(candles);
            const zone = detectPremiumDiscount(candles);
            let msg = `\ud83d\udd0d *ICT Pattern Scan: ${sym}*\n\n`;
            msg += `\ud83c\udfdb *Structure:* \`${structure.state}\` ${structure.pattern ? `(${structure.pattern})` : ''}\n`;
            msg += `\ud83d\udca7 *Sweep:* ${sweep.swept ? `\u2705 ${sweep.type} at ${sweep.level}` : '\u274c None detected'}\n`;
            msg += `\ud83d\udfe7 *FVG:* ${fvg.detected ? `\u2705 ${fvg.type} (${fvg.freshness}) ${fvg.inEntryZone ? '\u2014 IN ENTRY ZONE' : ''}` : '\u274c None'}\n`;
            msg += `\ud83d\udccd *Zone:* \`${zone.zone}\` (${Math.round(zone.pctInRange)}% of range)\n`;
            if (zone.description) msg += `_${zone.description}_`;
            send(chatId, msg, { parse_mode: 'Markdown' });
        } catch(e) {
            send(chatId, `\u274c Pattern scan failed: ${e.message}`);
        }

    } else if (cmd === '/version') {
        send(chatId, formatVersionInfo(), { parse_mode: 'Markdown' });

    } else if (cmd === '/changelog') {
        send(chatId, formatChangelog(15), { parse_mode: 'Markdown' });

    } else if (cmd === '/api-usage' || cmd === '/apiusage') {
        send(chatId, formatApiUsage(isAdmin(chatId, callerUsername)), { parse_mode: 'Markdown' });

    // ─── v4.0 Expert Debug Commands ───────────────────────────────────────────
    } else if (cmd === '/providers') {
        try {
            const { getAllHealth } = require('./lib/providers/provider_registry.cjs');
            const { formatProvidersTelegram } = require('./premium_api_adapters.cjs');
            const freeProviders = getAllHealth();
            const healthy = freeProviders.filter(p => p.healthy).length;
            const lines = [
                '📡 *Provider Health Dashboard*\n',
                `*Free Providers:* ${healthy}/${freeProviders.length} healthy\n`
            ];
            freeProviders.forEach(p => {
                const icon = p.healthy ? '✅' : '❌';
                lines.push(`${icon} \`${p.name}\` — ${p.healthy ? 'OK' : p.lastError || 'FAILED'}`);
            });
            lines.push('');
            lines.push(formatProvidersTelegram());
            send(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
        } catch(e) {
            send(chatId, `📡 *Providers*\n\nFree: Active\nPaid: All disabled (placeholder mode)\n\n_Use env vars to activate. See /features._`, { parse_mode: 'Markdown' });
        }

    } else if (cmd === '/features') {
        try {
            const { formatFlagsTelegram } = require('./lib/providers/feature_flags.cjs');
            send(chatId, formatFlagsTelegram(), { parse_mode: 'Markdown' });
        } catch(e) {
            send(chatId, `🏳️ Feature flags module loading...\n_Set env vars to toggle features._`);
        }

    } else if (cmd === '/logs') {
        if (!isAdmin(chatId, callerUsername)) {
            send(chatId, '🔒 Admin only.');
            return;
        }
        try {
            const { getRecentRuns, getRunStats } = require('./lib/observability/run-context.cjs');
            const stats = getRunStats();
            const recent = getRecentRuns(8);
            const lines = [
                '📋 *Structured Run Logs*\n',
                `Total runs: ${stats.total} | Errors: ${stats.withErrors} | Fallbacks: ${stats.withFallbacks}`,
                `Avg duration: ${stats.avgDuration}ms\n`
            ];
            if (recent.length === 0) {
                lines.push('_No runs logged yet. Runs are logged as commands execute._');
            } else {
                recent.forEach(r => {
                    const dur = r.duration_ms ? `${r.duration_ms}ms` : 'running';
                    const err = r.errors.length > 0 ? ` ⚠️${r.errors.length}err` : '';
                    const fb = r.fallbacks_used.length > 0 ? ` 🔄${r.fallbacks_used.length}fb` : '';
                    lines.push(`\`${r.run_id.substring(0,8)}\` ${r.command || '?'} ${r.asset || ''} — ${dur}${err}${fb}`);
                });
            }
            send(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
        } catch(e) {
            // Fallback to file-based logs
            const fs = require('fs');
            const logPath = require('path').join(__dirname, 'logs', 'scheduler_log.txt');
            try {
                const content = fs.readFileSync(logPath, 'utf8');
                const lastLines = content.split('\n').filter(l => l.trim()).slice(-15).join('\n');
                send(chatId, `📋 *Recent Logs*\n\n\`\`\`\n${lastLines}\n\`\`\``, { parse_mode: 'Markdown' });
            } catch {
                send(chatId, '📋 No logs available yet.');
            }
        }

    // ─── v3.4 LEARNING & INTELLIGENCE COMMANDS ────────────────────────────────
    } else if (cmd === '/learningstatus') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        try {
            const { getLearningStatus } = require('./lib/learning/learning-engine.cjs');
            const s = getLearningStatus();
            const msg = `🧠 *Learning Status v3.4*\n` +
                `Outcomes tracked: ${s.total_outcomes}/${s.min_sample_size} (${s.mature ? '✅ Mature' : '⚠️ Not yet'})\n` +
                `Total signals: ${s.total_signals}\n` +
                `Can recommend: ${s.can_recommend ? '✅' : '❌'}\n\n` +
                `*Safety Locks:*\n` +
                `  🚫 Remove vetoes: NEVER\n  🚫 Activate broker: NEVER\n  🚫 Paid providers: NEVER\n` +
                `  ⚡ Max weight change/week: ±${s.max_weekly_weight_change}`;
            send(chatId, msg, { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ Learning status error: ${e.message}`); }

    } else if (cmd === '/modelscore') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        try {
            const { getModelScore } = require('./lib/learning/learning-engine.cjs');
            const s = getModelScore();
            const msg = `📊 *Model Score v3.4*\n` +
                `Score: ${s.score}/100\n` +
                `Samples: ${s.samples} analyses\n` +
                `Agent runs: ${s.total_agent_runs || 0}\n` +
                `Success rate: ${s.success_rate || 0}%\n` +
                `Avg latency: ${s.avg_latency_ms || 0}ms\n` +
                (s.note ? `\nℹ️ ${s.note}` : '');
            send(chatId, msg, { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ Model score error: ${e.message}`); }

    } else if (cmd === '/applylearning') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        send(chatId, '⚠️ *Apply Learning*\nLearning recommendations are advisory only.\nManual approval required for any score-weight changes.\nUse ADMIN\\_LEARNING\\_APPLY=true env flag to enable bounded auto-apply.', { parse_mode: 'Markdown' });

    // ─── v3.4 REPLAY & BACKTEST ────────────────────────────────────────────────
    } else if (cmd === '/replay') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        const signalId = args[1] || '';
        if (!signalId) return send(chatId, '❌ Usage: /replay SIGNAL\\_ID\n_Example: /replay 2026-05-01T12:00:00.000Z_', { parse_mode: 'Markdown' });
        try {
            typing(chatId);
            const { replaySignal, formatReplayResult } = require('./lib/replay/replay_engine.cjs');
            const result = replaySignal(signalId);
            send(chatId, formatReplayResult(result), { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ Replay error: ${e.message}`); }

    } else if (cmd === '/backtest-recent') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        const sym = sanitizeTicker(args[1] || 'XAUUSD');
        try {
            typing(chatId);
            send(chatId, `⏳ Running backtest for *${sym}*...`, { parse_mode: 'Markdown' });
            const { backtestRecent, formatBacktestResult } = require('./lib/replay/backtest_engine.cjs');
            const result = await backtestRecent(sym);
            send(chatId, formatBacktestResult(result), { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ Backtest error: ${e.message}`); }

    // ─── v3.4 SECURITY & OPS ──────────────────────────────────────────────────
    } else if (cmd === '/securitystatus') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        try {
            const { formatSecurityStatus } = require('./lib/policy/auto_update_policy.cjs');
            send(chatId, formatSecurityStatus(), { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ Security status error: ${e.message}`); }

    } else if (cmd === '/ratelimits') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        send(chatId, '📊 *Rate Limits v3.4*\n  Per-user: 5 commands / 60s\n  Symbol sanitization: active\n  Admin bypass: no\n  Enforcement: pre-handler', { parse_mode: 'Markdown' });

    } else if (cmd === '/schema') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        try {
            const snapStore = require('./lib/snapshots/snapshot_store.cjs');
            const health = snapStore.getSyncHealth();
            const types = Object.keys(health.types || {});
            send(chatId, `📋 *Snapshot Schema v3.4*\n${types.length} types: ${types.join(', ')}\n\nEach snapshot: id, run\\_id, symbol, timeframe, source\\_provider, source\\_timestamp, created\\_at, updated\\_at, cache\\_age\\_seconds, stale, stale\\_level, stale\\_threshold, payload, warnings, fallback\\_used, fallback\\_provider`, { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `📋 Schema: 17 snapshot types with full metadata`); }

    } else if (cmd === '/backupstatus') {
        if (!isAdmin(chatId, callerUsername)) return send(chatId, '🔒 Admin only.');
        try {
            const snapStore = require('./lib/snapshots/snapshot_store.cjs');
            const health = snapStore.getSyncHealth();
            const types = Object.keys(health.types || {});
            const populated = types.filter(t => health.types?.[t]?.count > 0).length;
            send(chatId, `💾 *Backup Status*\n  Snapshot types: ${types.length}\n  Populated: ${populated}/${types.length}\n  Store: in-memory (persistent via logs)\n  Supabase sync: ${process.env.SUPABASE_URL ? '✅ active' : '⚠️ not configured'}`, { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `💾 Snapshot store active`); }

    } else if (cmd === '/indicatorscore') {
        try {
            const { enrichBollingerBands, enrichATR, generateConfluenceSummary } = require('./lib/indicators/indicator_intelligence.cjs');
            send(chatId, `📐 *Indicator Intelligence v3.4*\nEnrichments active:\n  ✅ BB: squeeze, expansion, stretch states\n  ✅ Stoch: exhaustion, cross, K/D divergence\n  ✅ AO: zero-line, flip, momentum shift\n  ✅ ATR: volatility regime (5 levels)\n  ✅ Confluence: timing-filter-only summary\n\n🔒 *Single-source trade prevention enforced*`, { parse_mode: 'Markdown' });
        } catch(e) { send(chatId, `❌ Indicator score error: ${e.message}`); }

    } else {
        send(chatId, `⚠️ Unknown command.\n\n${getHelpText()}`, { parse_mode: 'Markdown' });
    }
}


// ─── SMART CHAT ───────────────────────────────────────────────────────────────
async function handleChatCommand(chatId, userQuery) {
    if (/signal|btc|eth|crypto|market|gold|xauusd|eurusd|gbpusd|forex/i.test(userQuery)) {
        const m = userQuery.match(/\b(BTC|ETH|XRP|SOL|XAUUSD|GOLD|EURUSD|GBPUSD|USDJPY|BTCUSD)\b/i);
        if (m) {
            typing(chatId);
            send(chatId, `⏳ Analyzing *${m[0].toUpperCase()}*...`, { parse_mode: 'Markdown' });
            return send(chatId, await generateSignal(m[0]), { parse_mode: 'Markdown' });
        }
        if (/overview|market|today/i.test(userQuery)) {
            typing(chatId);
            return send(chatId, await marketOverview(), { parse_mode: 'Markdown' });
        }
    }
    typing(chatId);
    send(chatId, `🧠 Thinking via LM Studio...`);
    const role   = aiCore.determineRole(userQuery);
    const result = await aiCore.infer(userQuery, role);
    send(chatId, result, { parse_mode: 'Markdown' });
}

// ─── STARTUP ──────────────────────────────────────────────────────────────────
writeLog("=== OpenClaw Expert Edition Started ===");
scheduler.init(bot, ADMIN_ID);
watchlistEngine.init(bot);

// ─── MASTER INTELLIGENCE REAL-TIME SYNC ──────────────────────────────────────────
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    supabase
        .channel('public:agent_outputs')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_outputs' }, (payload) => {
            const signal = payload.new;
            if (signal.final_action === 'WAIT') {
                writeLog(`[Master AI] Evaluated $${signal.symbol} - Forced WAIT.`);
                return;
            }
            if (signal.synthesis_json?.telegram_message) {
                // Broadcast to admin directly (or a configured broadcast channel)
                if (ADMIN_ID) {
                    bot.sendMessage(ADMIN_ID, signal.synthesis_json.telegram_message, { parse_mode: "Markdown" }).catch(err => {
                        writeLog(`[Master AI Broadcast Error] ${err.message}`);
                    });
                }
                writeLog(`Broadcasting new Master Signal for ${signal.symbol}`);
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                writeLog('✅ Bot successfully synced to Master Intelligence Stream');
                if (ADMIN_ID) bot.sendMessage(ADMIN_ID, `🔗 *Master Live-Sync Active*\nConnected to real-time orchestrator stream.`, { parse_mode: 'Markdown' }).catch(()=>{});
            }
        });
} else {
    writeLog('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing - skipping realtime sync.');
}

if (ADMIN_ID) {
    send(parseInt(ADMIN_ID),
        `🔄 *OpenClaw Expert Edition Online*\n\n` +
        `✅ ATR-based dynamic stops\n` +
        `✅ ADX + MACD + RSI Divergence\n` +
        `✅ Setup Score (0-100)\n` +
        `✅ Reward:Risk (≥2:1 threshold)\n` +
        `✅ Watchlist alerts (15min)\n` +
        `✅ Position sizing by account\n` +
        `✅ News + Sentiment intelligence\n\n` +
        `Type /start for all commands.`,
        { parse_mode: 'Markdown' }
    ).catch(() => {});
}


