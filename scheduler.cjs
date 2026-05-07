/**
 * scheduler.cjs — OpenClaw Automation Engine (Phase 2 Upgrade)
 * Every job carries a run_id via RunContext.
 * Cycles:
 *   Every 5 min  → Headline collector scan
 *   Every 15 min → Signal scoring + Telegram alerts
 *   Every 4 hours → Technical signal scan (XAUUSD/BTC/EURUSD)
 *   Daily         → Rwanda macro report + intelligence summary
 */
'use strict';

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const { generateSignal, marketOverview } = require('./trading_engine.cjs');
const { collectAll, fetchAllNews }       = require('./news_collector.cjs');
const { processHeadlines }               = require('./signal_scorer.cjs');
const { getHeadlines, getSignals, getRwandaIntel } = require('./database.cjs');
const { generateRwandaMacroReport }      = require('./rwanda_engine.cjs');
const { startDashboard }                 = require('./dashboard.cjs');
const bridge                             = require('./supabase_bridge.cjs');
const { RunContext, STAGES }             = require('./lib/errors/error_classifier.cjs');
const { startMonitoring, healSchedulerJob, healJobSuccess } = require('./smart_health.cjs');
const { checkForUpdates, autoApplySafeUpdates } = require('./auto_update.cjs');
const runCtx = require('./lib/observability/run-context.cjs');
const snapStore = require('./lib/snapshots/snapshot_store.cjs');

const LOG = path.join(__dirname, 'logs', 'scheduler_log.txt');
if (!fs.existsSync(path.dirname(LOG))) fs.mkdirSync(path.dirname(LOG), { recursive: true });

function log(msg, runId = '') {
    const line = `[${new Date().toISOString()}] [SCHEDULER] ${runId ? `[${runId}] ` : ''}${msg}`;
    fs.appendFileSync(LOG, line + '\n');
    console.log(line);
}

// ─── Persist scheduler run to Supabase (non-blocking) ────────────────────────
async function persistSchedulerRun(jobName, ctx, extra = {}) {
    try {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_KEY) return;
        const record = {
            job_name:    jobName,
            run_id:      ctx.runId,
            status:      ctx.errors.length === 0 ? 'success' : 'partial_error',
            duration_ms: ctx.duration(),
            records_out: extra.recordsOut || 0,
            error_msg:   ctx.errors.length > 0 ? ctx.errors[0]?.human_summary : null
        };
        await fetch(`${SUPABASE_URL}/rest/v1/scheduler_runs`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify(record)
        });
    } catch { /* non-blocking — never crash scheduler */ }
}

let botRef    = null;
let adminId   = null;
let intervals = [];

const HEADLINE_INTERVAL = 5  * 60 * 1000;
const SIGNAL_INTERVAL   = 15 * 60 * 1000;
const SCANNER_INTERVAL  = 15 * 60 * 1000; // 15 mins
const DAILY_INTERVAL    = 24 * 60 * 60 * 1000;
const UPDATE_INTERVAL   = 6  * 60 * 60 * 1000; // 6h update check
const WATCH_SYMBOLS     = ['XAUUSD', 'BTC', 'EURUSD', 'ETH'];

// v4.0: Job timeout (60s max), overlap guard, circuit breaker
const JOB_TIMEOUT_MS    = 60000;
const SLOW_JOB_WARN_MS  = 30000;
const _jobLocks = {};
// v5.1: Per-snapshot-type refresh circuit breaker
const _refreshAttempts = {};  // { snapshotType: { count, windowStart, circuitState, cooldownUntil } }
const REFRESH_MAX_ATTEMPTS = 3;
const REFRESH_WINDOW_MS = 60 * 60 * 1000;   // 1 hour
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;  // 30 min cooldown after circuit opens

function getRefreshCircuit(snapshotType) {
    if (!_refreshAttempts[snapshotType]) {
        _refreshAttempts[snapshotType] = { count: 0, windowStart: Date.now(), circuitState: 'CLOSED', cooldownUntil: null };
    }
    const circuit = _refreshAttempts[snapshotType];
    // Reset window if expired
    if (Date.now() - circuit.windowStart > REFRESH_WINDOW_MS) {
        circuit.count = 0;
        circuit.windowStart = Date.now();
        if (circuit.circuitState === 'OPEN' && (!circuit.cooldownUntil || Date.now() >= circuit.cooldownUntil)) {
            circuit.circuitState = 'HALF_OPEN';
        }
    }
    return circuit;
}

function canRefreshSnapshot(snapshotType) {
    const circuit = getRefreshCircuit(snapshotType);
    if (circuit.circuitState === 'OPEN') {
        if (circuit.cooldownUntil && Date.now() < circuit.cooldownUntil) {
            log(`[CIRCUIT] ${snapshotType} refresh blocked — cooldown until ${new Date(circuit.cooldownUntil).toISOString()}`);
            return false;
        }
        // Cooldown expired → try once (HALF_OPEN)
        circuit.circuitState = 'HALF_OPEN';
    }
    return true;
}

function recordRefreshAttempt(snapshotType, success) {
    const circuit = getRefreshCircuit(snapshotType);
    circuit.count++;
    if (success) {
        circuit.circuitState = 'CLOSED';
        circuit.count = 0;
        return;
    }
    if (circuit.count >= REFRESH_MAX_ATTEMPTS) {
        circuit.circuitState = 'OPEN';
        circuit.cooldownUntil = Date.now() + REFRESH_COOLDOWN_MS;
        log(`[CIRCUIT] ${snapshotType} refresh circuit OPEN — ${REFRESH_MAX_ATTEMPTS} failures in window, cooldown ${REFRESH_COOLDOWN_MS/60000}min`);
        // Write degraded snapshot
        try {
            snapStore.put(snapshotType, null, null, {
                degraded: true,
                reason: `Refresh failed ${REFRESH_MAX_ATTEMPTS}x — using neutral assumption`,
                circuit_state: 'OPEN',
                cooldown_until: new Date(circuit.cooldownUntil).toISOString()
            }, { provider: 'circuit-breaker', stale: true, stale_level: 'DEGRADED' });
        } catch(e) {}
        // Alert admin
        sendToAdmin(`⚠️ *Circuit Breaker: ${snapshotType}*\n\nRefresh failed ${REFRESH_MAX_ATTEMPTS}x in 1 hour.\nUsing neutral assumption.\nCooldown: 30 minutes.\n\n_Auto-retry at ${new Date(circuit.cooldownUntil).toLocaleTimeString()}_`).catch(() => {});
    }
}

function getRefreshCircuitStatus() {
    return Object.entries(_refreshAttempts).map(([type, c]) => ({
        type,
        state: c.circuitState,
        attempts: c.count,
        cooldownUntil: c.cooldownUntil ? new Date(c.cooldownUntil).toISOString() : null
    }));
}


const _circuitBreakers = {};  // { provider: { failures: N, pausedUntil: timestamp } }

function withTimeout(fn, jobName) {
    return async function() {
        // Overlap guard
        if (_jobLocks[jobName]) {
            log(`[SKIP] ${jobName} still running — overlap prevented`);
            return;
        }
        _jobLocks[jobName] = true;
        const startMs = Date.now();

        try {
            const result = await Promise.race([
                fn.apply(this, arguments),
                new Promise((_, reject) => setTimeout(() => reject(new Error('JOB_TIMEOUT')), JOB_TIMEOUT_MS))
            ]);
            const elapsed = Date.now() - startMs;
            if (elapsed > SLOW_JOB_WARN_MS) {
                log(`[SLOW] ${jobName} took ${elapsed}ms (threshold: ${SLOW_JOB_WARN_MS}ms)`);
            }
            return result;
        } catch(e) {
            if (e.message === 'JOB_TIMEOUT') {
                log(`[TIMEOUT] ${jobName} exceeded ${JOB_TIMEOUT_MS}ms — aborted safely`);
            } else {
                throw e;
            }
        } finally {
            _jobLocks[jobName] = false;
        }
    };
}

function checkCircuitBreaker(provider) {
    const cb = _circuitBreakers[provider];
    if (!cb) return true; // No breaker = allow
    if (cb.pausedUntil && Date.now() < cb.pausedUntil) {
        log(`[CIRCUIT] ${provider} paused until ${new Date(cb.pausedUntil).toISOString()}`);
        return false;
    }
    if (cb.pausedUntil && Date.now() >= cb.pausedUntil) {
        cb.failures = 0; cb.pausedUntil = null; // Reset
    }
    return true;
}

function recordProviderFailure(provider) {
    if (!_circuitBreakers[provider]) _circuitBreakers[provider] = { failures: 0, pausedUntil: null, firstFailure: Date.now() };
    const cb = _circuitBreakers[provider];
    cb.failures++;
    if (cb.failures >= 3 && (Date.now() - (cb.firstFailure || 0)) < 15 * 60 * 1000) {
        cb.pausedUntil = Date.now() + 5 * 60 * 1000; // 5min pause
        log(`[CIRCUIT] ${provider} tripped — 3 failures in 15min, paused 5min`);
    }
}


async function sendToAdmin(msg) {
    if (!botRef || !adminId) return;
    try { await botRef.sendMessage(adminId, msg, { parse_mode: 'Markdown' }); }
    catch(e) { log(`Send failed: ${e.message}`); }
}

// ─── 5min: Collect headlines ──────────────────────────────────────────────────
async function runHeadlineCollector() {
    const ctx = new RunContext('sched_head', null, 'headline_collector');
    ctx.stage(STAGES.INGESTION);
    try {
        log('Headline collector running...', ctx.runId);
        const result   = await collectAll();
        const newCount = result?.new || 0;
        if (newCount > 0) log(`Collected ${newCount} new headlines | Rwanda: ${result.rwanda || 0}`, ctx.runId);

        // Write NewsSnapshot with classification
        try {
            const { getRecentHeadlines } = require('./database.cjs');
            const { classifyHeadline } = require('./lib/filters/expert_news_filter.cjs');
            const recent = getRecentHeadlines ? getRecentHeadlines(50) : [];
            const classified = [];
            let sigCandidates = 0;
            for (let i = 0; i < recent.length; i++) {
                const c = classifyHeadline(recent[i], recent.slice(0, i));
                classified.push(c);
                if (c.classification === 'SIGNAL_CANDIDATE') sigCandidates++;
            }
            snapStore.put('NEWS', null, null, {
                headlines: classified,
                total_raw: newCount + (recent.length || 0),
                total_filtered: classified.filter(h => h.classification !== 'IGNORE').length,
                signal_candidates: sigCandidates
            }, { provider: 'multi-source' });
            if (sigCandidates > 0) log(`NewsSnapshot: ${sigCandidates} signal candidates found`, ctx.runId);
        } catch(snapErr) { log('Snapshot write err: ' + snapErr.message, ctx.runId); }

        await persistSchedulerRun('headline_collector', ctx, { recordsOut: newCount });
    } catch(e) {
        ctx.error('SCHEDULER_ERROR', { stage: STAGES.INGESTION, humanSummary: `Headline collector failed: ${e.message}`, error: e });
        log(`Collector error: ${e.message}`, ctx.runId);
        await persistSchedulerRun('headline_collector', ctx);
    }
}

// ─── 15min: Score headlines → Signal alerts ───────────────────────────────────
let lastNewsRefresh = 0;
async function runSignalEngine() {
    const ctx = new RunContext('sched_sig', null, 'signal_engine');
    const run = runCtx.startRun('scheduler:signal_engine', null, { job: 'signal_engine' });
    ctx.stage(STAGES.SCORING);
    runCtx.logStage(run, 'SCORING_START');
    try {
        log('Signal engine running...', ctx.runId);
        const recent = getHeadlines(0.5);
        if (!recent.length) {
            log('No new headlines to score', ctx.runId);
            runCtx.logStage(run, 'NO_HEADLINES');
            runCtx.completeRun(run, 'no_headlines');
            await persistSchedulerRun('signal_engine', ctx);
            return;
        }

        log(`Scoring ${recent.length} headlines...`, ctx.runId);
        runCtx.logStage(run, 'SCORING', { headlineCount: recent.length });
        const sent = await processHeadlines(recent, async (msg) => {
            await sendToAdmin(msg);
            await new Promise(r => setTimeout(r, 1200));
        });
        if (sent?.length) log(`Sent ${sent.length} signals to Telegram`, ctx.runId);
        runCtx.logStage(run, 'COMPLETE', { signalsSent: sent?.length || 0 });
        runCtx.completeRun(run, { signalsSent: sent?.length || 0 });

        const now = Date.now();
        if (now - lastNewsRefresh > 30 * 60 * 1000) {
            await fetchAllNews(true).catch(() => {});
            lastNewsRefresh = now;
        }
        await persistSchedulerRun('signal_engine', ctx, { recordsOut: sent?.length || 0 });
    } catch(e) {
        ctx.error('SCHEDULER_ERROR', { stage: STAGES.SCORING, humanSummary: `Signal engine failed: ${e.message}`, error: e });
        runCtx.logError(run, 'SCORING', e, 'CRITICAL');
        runCtx.completeRun(run, 'error');
        log(`Signal engine error: ${e.message}`, ctx.runId);
        await persistSchedulerRun('signal_engine', ctx);
    }
}

// ─── 15m: Real-Time Institutional Scanner ───────────────────────────────────
async function runRealtimeScannerJob() {
    if (!botRef || !adminId) return;
    const ctx = new RunContext('sched_rt_scan', null, 'realtime_scanner');
    ctx.stage(STAGES.INGESTION);
    log('Realtime signal scanner starting...', ctx.runId);
    
    try {
        const { runRealtimeScanner } = require('./lib/signals/realtime-scanner.cjs');
        
        ctx.stage(STAGES.SCORING);
        const sent = await runRealtimeScanner(botRef, (chatId, photo, caption, opts) => {
            return botRef.sendPhoto(chatId, photo, { caption, ...opts });
        }, bridge);
        
        log(`Realtime scan complete. Actionable: ${sent}`, ctx.runId);
        await persistSchedulerRun('realtime_scanner', ctx, { recordsOut: sent });
    } catch(e) {
        ctx.error('SCHEDULER_ERROR', { stage: STAGES.SCORING, humanSummary: `Realtime scan failed`, error: e });
        log(`Realtime scan error: ${e.message}`, ctx.runId);
        await persistSchedulerRun('realtime_scanner', ctx);
    }
}

// ─── Daily: Rwanda macro report ───────────────────────────────────────────────
async function runDailyReport() {
    if (!botRef || !adminId) return;
    const ctx = new RunContext('sched_daily', null, 'daily_report');
    ctx.stage(STAGES.SYNTHESIS);
    log('Generating daily report...', ctx.runId);
    try {
        const rwandaItems = getRwandaIntel(50);
        const report      = generateRwandaMacroReport(rwandaItems);
        if (report) await sendToAdmin(report);
        else await sendToAdmin('🇷🇼 *Rwanda Daily Report*\n\n_No significant Rwanda intelligence collected today._');

        const signals      = getSignals(10, 'sent');
        const headlines24h = getHeadlines(24);
        await sendToAdmin(
            `📊 *Daily Intelligence Summary*\n_${new Date().toUTCString()}_\n\n` +
            `📰 Headlines: *${headlines24h.length}* | 🚨 Signals: *${signals.length}* | 🇷🇼 Rwanda: *${rwandaItems.length}*\n\n` +
            (signals.slice(0, 5).map(s =>
                `${s.direction==='BUY'?'🟢':'🔴'} \`${s.asset}\` — ${s.direction} | ${s.confidence}%`
            ).join('\n') || '_No signals today_')
        );
        await persistSchedulerRun('daily_report', ctx, { recordsOut: signals.length });
    } catch(e) {
        ctx.error('SCHEDULER_ERROR', { stage: STAGES.SYNTHESIS, humanSummary: `Daily report failed: ${e.message}`, error: e });
        log(`Daily report error: ${e.message}`, ctx.runId);
        await persistSchedulerRun('daily_report', ctx);
    }
}

// ─── Full daily summary (for /daily command) ──────────────────────────────────
async function sendDailySummary(chatId) {
    if (!botRef) return;
    try {
        const { analyzeSentiment } = require('./sentiment_engine.cjs');
        const news      = await fetchAllNews().catch(() => ({}));
        const goldSent  = analyzeSentiment(news, 'XAUUSD');
        const btcSent   = analyzeSentiment(news, 'BTC');
        const forexSent = analyzeSentiment(news, 'FOREX');
        const overview  = await marketOverview().catch(() => 'Unavailable');
        const signals   = getSignals(5, 'sent');
        const rwandaItems = getRwandaIntel(10);
        const sentIcon  = s => ({ BULLISH:'🟢', BEARISH:'🔴', NEUTRAL:'🟡' })[s] || '⚪';
        await botRef.sendMessage(chatId,
            `📊 *Daily Intelligence Report*\n_${new Date().toUTCString()}_\n\n` +
            `*Sentiment:* ${sentIcon(goldSent.label)} Gold | ${sentIcon(btcSent.label)} BTC | ${sentIcon(forexSent.label)} Forex\n\n` +
            `*Prices:*\n${overview}\n\n*Signals (24h):* ${signals.length} | 🇷🇼 *Rwanda:* ${rwandaItems.length}\n\n` +
            `_Next signal scan: 15 min | Tech scan: 4h_`,
            { parse_mode: 'Markdown' }
        );
    } catch(e) { log(`Daily summary failed: ${e.message}`); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init(bot, adminUserId) {
    botRef  = bot;
    adminId = adminUserId;
    log('Scheduler initialized');

    try { startDashboard(); } catch(e) { log(`Dashboard error: ${e.message}`); }

    // ── Core cycles (v4.0: all wrapped with timeout + overlap guard) ────────
    const safeHeadline = withTimeout(runHeadlineCollector, 'headline_collector');
    const safeSignal   = withTimeout(runSignalEngine, 'signal_engine');
    const safeScanner  = withTimeout(runRealtimeScannerJob, 'realtime_scanner');
    const safeDaily    = withTimeout(runDailyReport, 'daily_report');

    intervals.push(setInterval(safeHeadline, HEADLINE_INTERVAL));
    intervals.push(setInterval(safeSignal,   SIGNAL_INTERVAL));
    intervals.push(setInterval(safeScanner,  SCANNER_INTERVAL));
    intervals.push(setInterval(safeDaily,    DAILY_INTERVAL));

    setTimeout(safeHeadline, 30000);
    setTimeout(safeSignal,   90000);
    setTimeout(safeScanner,  3 * 60 * 1000);
    setTimeout(safeDaily,    10 * 60 * 1000);

    // ── Smart Health Monitor (Phase 1) ────────────────────────────────────────
    try {
        startMonitoring(60000); // 60s heartbeat
        log('Smart Health Monitor: active (60s heartbeat)');
    } catch(e) { log(`SmartHealth start error: ${e.message}`); }

    // ── Auto-Update Agent (Phase 4) ───────────────────────────────────────────
    intervals.push(setInterval(async () => {
        try {
            const updates = checkForUpdates();
            if (updates.recommendations.length > 0) {
                log(`Auto-Update: ${updates.recommendations.length} recommendations found`);
                const applied = autoApplySafeUpdates();
                if (applied.applied > 0) {
                    log(`Auto-Update: ${applied.applied} safe updates auto-applied`);
                    await sendToAdmin(`🔄 *Auto-Update*\n${applied.applied} update(s) auto-applied. ${applied.pending} pending admin approval.`);
                }
            }
        } catch(e) { log(`Auto-Update error: ${e.message}`); }
    }, UPDATE_INTERVAL));

    // ── Heartbeat ──────────────────────────────────────────────────────────────
    intervals.push(setInterval(() => bridge.pushHeartbeat({
        signals_today: getSignals(1000, 'sent').length || 0,
        active_users:  1
    }), 60 * 1000));

    // ── v5.0: Continuous Expert Reasoning Engine ──────────────────────────────
    try {
        const { startContinuousReasoningLoop } = require('./tradingagents_bridge.cjs');
        startContinuousReasoningLoop();
        log('v5.0 Continuous Reasoning Engine: active (10min cycle)');
    } catch(e) { log(`ReasoningEngine start error: ${e.message}`); }

    log(`Cycles: Headlines 5min | Signals 15min | Scanner 15m | Daily report | Updates 6h | Health 60s | Reasoning 10m`);
    log(`Dashboard: http://localhost:3737`);
}

function stop() {
    intervals.forEach(clearInterval);
    intervals = [];
    log('Scheduler stopped');
}

module.exports = { init, stop, runSignalEngine, runHeadlineCollector, withTimeout, checkCircuitBreaker, recordProviderFailure, canRefreshSnapshot, recordRefreshAttempt, getRefreshCircuitStatus, _jobLocks, _circuitBreakers, _refreshAttempts };
