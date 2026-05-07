/**
 * error_classifier.cjs — Unified Error Classification + Run ID System
 * Every signal, command, scheduler job, provider fetch, agent run,
 * DB write, and Telegram delivery shares a run_id.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const LOG_DIR  = path.join(__dirname, '../../logs');
const ERR_FILE = path.join(LOG_DIR, 'system_errors.jsonl');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const ERROR_CLASSES = {
    PROVIDER_ERROR:      { severity: 'MEDIUM',   retryable: true,  userVisible: false },
    NORMALIZATION_ERROR: { severity: 'MEDIUM',   retryable: true,  userVisible: false },
    SCORING_ERROR:       { severity: 'HIGH',     retryable: false, userVisible: false },
    VERIFICATION_ERROR:  { severity: 'HIGH',     retryable: false, userVisible: false },
    VETO_ERROR:          { severity: 'LOW',      retryable: false, userVisible: false },
    LLM_ERROR:           { severity: 'MEDIUM',   retryable: true,  userVisible: false },
    PERSISTENCE_ERROR:   { severity: 'HIGH',     retryable: true,  userVisible: false },
    DELIVERY_ERROR:      { severity: 'HIGH',     retryable: true,  userVisible: true  },
    SCHEDULER_ERROR:     { severity: 'MEDIUM',   retryable: true,  userVisible: false },
    AUTH_ERROR:          { severity: 'CRITICAL', retryable: false, userVisible: false },
    DASHBOARD_ERROR:     { severity: 'LOW',      retryable: true,  userVisible: false },
    UNKNOWN_ERROR:       { severity: 'MEDIUM',   retryable: false, userVisible: false }
};

const STAGES = {
    INGESTION: 'ingestion', NORMALIZATION: 'normalization',
    SCORING: 'scoring',     VERIFICATION: 'verification',
    VETO: 'veto',           SYNTHESIS: 'synthesis',
    PERSISTENCE: 'persistence', DELIVERY: 'delivery',
    SCHEDULER: 'scheduler', DASHBOARD: 'dashboard',
    LLM: 'llm',             PROVIDER: 'provider'
};

function generateRunId(prefix = 'run') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2,6)}`;
}

const HINTS = {
    PROVIDER_ERROR:      'Check provider API key, rate limits, and network.',
    NORMALIZATION_ERROR: 'Check raw provider response — may indicate API change.',
    SCORING_ERROR:       'Check signal_scorer.cjs for malformed input data.',
    VERIFICATION_ERROR:  'Check signal_verifier.cjs gate logic and signal shape.',
    VETO_ERROR:          'Review veto conditions — signal was properly rejected.',
    LLM_ERROR:           'Check LM Studio or cloud provider API key/balance.',
    PERSISTENCE_ERROR:   'Check Supabase connectivity and schema. Data queued locally.',
    DELIVERY_ERROR:      'Check TELEGRAM_BOT_TOKEN. Message formatting may be invalid.',
    SCHEDULER_ERROR:     'Check scheduler.cjs and job-specific module.',
    AUTH_ERROR:          'Check API keys in telegram.env.',
    DASHBOARD_ERROR:     'Check dashboard.cjs and port 3737.',
    UNKNOWN_ERROR:       'Review stack trace for root cause.'
};

function classifyError(errorClass, options = {}) {
    const meta   = ERROR_CLASSES[errorClass] || ERROR_CLASSES.UNKNOWN_ERROR;
    const record = {
        error_id:         randomUUID(),
        run_id:           options.runId        || 'no-run-id',
        timestamp:        new Date().toISOString(),
        error_class:      errorClass,
        stage:            options.stage        || STAGES.PROVIDER,
        asset:            options.asset        || null,
        command:          options.command      || null,
        provider:         options.provider     || null,
        severity:         options.severity     || meta.severity,
        retryable:        options.retryable    !== undefined ? options.retryable : meta.retryable,
        fallback_used:    options.fallbackUsed || false,
        user_visible:     options.userVisible  !== undefined ? options.userVisible : meta.userVisible,
        human_summary:    options.humanSummary || `${errorClass.replace(/_/g,' ')} — ${options.provider || options.asset || ''}`,
        technical_detail: options.error?.message || options.technicalDetail || '',
        stack_trace:      options.error?.stack    || null,
        resolution_hint:  HINTS[errorClass] || 'Review logs.'
    };
    try { fs.appendFileSync(ERR_FILE, JSON.stringify(record) + '\n'); } catch {}
    return record;
}

function getRecentErrors(limit = 20, severityFilter = null) {
    try {
        const lines = fs.readFileSync(ERR_FILE, 'utf8').split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const filtered = severityFilter ? lines.filter(e => e.severity === severityFilter) : lines;
        return filtered.slice(-limit).reverse();
    } catch { return []; }
}

function formatErrorForUser(record, adminMode = false) {
    const icon = { CRITICAL:'🚨', HIGH:'🔴', MEDIUM:'🟡', LOW:'🟢' }[record.severity] || '⚪';
    let msg = `${icon} ${record.human_summary}`;
    if (record.fallback_used) msg += '\n_Fallback active — reduced accuracy_';
    if (adminMode) {
        msg += `\n\`run_id: ${record.run_id}\` | \`${record.stage}\``;
        if (record.technical_detail) msg += `\n\`${record.technical_detail.substring(0,200)}\``;
        msg += `\n💡 ${record.resolution_hint}`;
    }
    return msg;
}

class RunContext {
    constructor(prefix = 'run', asset = null, command = null) {
        this.runId   = generateRunId(prefix);
        this.asset   = asset;
        this.command = command;
        this.startMs = Date.now();
        this.stages  = [];
        this.errors  = [];
    }
    error(errorClass, options = {}) {
        const record = classifyError(errorClass, { ...options, runId: this.runId, asset: options.asset || this.asset, command: options.command || this.command });
        this.errors.push(record);
        return record;
    }
    stage(stageName) { this.stages.push({ stage: stageName, at: new Date().toISOString() }); }
    duration() { return Date.now() - this.startMs; }
    summary() {
        return { runId: this.runId, asset: this.asset, command: this.command,
                 durationMs: this.duration(), stages: this.stages, errors: this.errors.length,
                 hasCritical: this.errors.some(e => ['CRITICAL','HIGH'].includes(e.severity)) };
    }
}

module.exports = { classifyError, getRecentErrors, formatErrorForUser, generateRunId, RunContext, ERROR_CLASSES, STAGES };
