/**
 * run-context.cjs — Run ID Correlation System
 * 
 * Every signal, command, scheduler job, provider fetch, agent run,
 * DB write, and Telegram delivery shares a run_id for end-to-end tracing.
 */
'use strict';
const crypto = require('crypto');

/** Generate a new run_id */
function createRunId() {
    return crypto.randomUUID ? crypto.randomUUID() : 
           crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

/** In-memory run log (last 200 entries) */
const _runLog = [];
const MAX_LOG = 200;

/**
 * Create a run context that flows through the pipeline.
 * @param {string} command - e.g. '/signal', '/analyze', 'scheduler:scan'
 * @param {string} asset - e.g. 'BTCUSD'
 * @param {object} meta - additional context
 */
function startRun(command, asset = null, meta = {}) {
    const ctx = {
        run_id: createRunId(),
        command,
        asset,
        started_at: new Date().toISOString(),
        stages: [],
        errors: [],
        providers_used: [],
        fallbacks_used: [],
        model_used: null,
        duration_ms: null,
        result: null,
        ...meta
    };
    return ctx;
}

/** Log a stage within a run */
function logStage(ctx, stage, detail = {}) {
    if (!ctx) return;
    ctx.stages.push({
        stage,
        timestamp: new Date().toISOString(),
        ...detail
    });
}

/** Log an error within a run */
function logError(ctx, stage, error, severity = 'WARN') {
    if (!ctx) return;
    ctx.errors.push({
        stage,
        severity,
        message: typeof error === 'string' ? error : (error?.message || String(error)),
        timestamp: new Date().toISOString()
    });
}

/** Log provider usage */
function logProvider(ctx, provider, success = true) {
    if (!ctx) return;
    ctx.providers_used.push({ provider, success, timestamp: new Date().toISOString() });
}

/** Log fallback */
function logFallback(ctx, from, to, reason) {
    if (!ctx) return;
    ctx.fallbacks_used.push({ from, to, reason, timestamp: new Date().toISOString() });
}

/** Complete a run and store in memory */
function completeRun(ctx, result = null) {
    if (!ctx) return;
    ctx.completed_at = new Date().toISOString();
    ctx.duration_ms = Date.now() - new Date(ctx.started_at).getTime();
    ctx.result = result;

    _runLog.unshift(ctx);
    if (_runLog.length > MAX_LOG) _runLog.length = MAX_LOG;
    return ctx;
}

/** Get recent run logs */
function getRecentRuns(n = 20) { return _runLog.slice(0, n); }

/** Get runs for a specific asset */
function getRunsForAsset(asset, n = 10) {
    return _runLog.filter(r => r.asset === asset).slice(0, n);
}

/** Get runs with errors */
function getErrorRuns(n = 20) {
    return _runLog.filter(r => r.errors.length > 0).slice(0, n);
}

/** Summary stats */
function getRunStats() {
    const total = _runLog.length;
    const withErrors = _runLog.filter(r => r.errors.length > 0).length;
    const withFallbacks = _runLog.filter(r => r.fallbacks_used.length > 0).length;
    const avgDuration = total > 0 
        ? Math.round(_runLog.reduce((a, r) => a + (r.duration_ms || 0), 0) / total)
        : 0;
    return { total, withErrors, withFallbacks, avgDuration, oldest: _runLog[total - 1]?.started_at };
}

module.exports = {
    createRunId,
    startRun,
    logStage,
    logError,
    logProvider,
    logFallback,
    completeRun,
    getRecentRuns,
    getRunsForAsset,
    getErrorRuns,
    getRunStats
};
