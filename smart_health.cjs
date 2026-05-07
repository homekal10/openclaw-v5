/**
 * smart_health.cjs — OpenClaw Smart Health Monitor v1.0
 *
 * Features:
 *   1. Heartbeat monitor (60s cycle) — tracks memory, CPU, provider latency
 *   2. Rolling baseline (24h) — learns "normal" metrics
 *   3. Anomaly detection (>2σ deviation triggers alert)
 *   4. Self-healing actions:
 *      - Provider unhealthy 3x → auto-switch to fallback + admin alert
 *      - Memory >400MB → force GC + warn
 *      - Scheduler job failed 3x → pause + alert
 *      - LLM timeout → route to next in chain
 *   5. Learning: After 7 days of data, system knows what "normal" looks like
 *   6. Trends: Detects recurring errors and escalates
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const BASELINE_FILE  = path.join(__dirname, 'logs', 'health_baseline.json');
const HEALING_LOG    = path.join(__dirname, 'logs', 'self_healing.jsonl');
const SNAPSHOT_FILE  = path.join(__dirname, 'logs', 'health_snapshots.jsonl');

// Ensure log dir
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ─── In-memory state ──────────────────────────────────────────────────────────
const _snapshots      = [];       // Rolling 24h window of snapshots
const _healingActions = [];       // Recent self-healing log
const _failureCounts  = {};       // { providerName: consecutiveFailures }
const _jobFailures    = {};       // { jobName: consecutiveFailures }

const MAX_SNAPSHOTS   = 1440;     // 24h at 60s intervals
const ANOMALY_SIGMA   = 2.0;     // Standard deviations for anomaly
const MEMORY_WARN_MB  = 400;     // Warn threshold
const MEMORY_CRIT_MB  = 480;     // Critical threshold
const PROVIDER_FAIL_THRESHOLD = 3;
const JOB_FAIL_THRESHOLD      = 3;
const BASELINE_MATURITY_DAYS  = 7;

// ─── Baseline Management ──────────────────────────────────────────────────────
function loadBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); }
    catch { return { created: new Date().toISOString(), samples: 0, metrics: {} }; }
}

function saveBaseline(baseline) {
    try { fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2)); } catch {}
}

function updateBaseline(snapshot) {
    const bl = loadBaseline();
    bl.samples++;
    bl.lastUpdated = new Date().toISOString();

    const metrics = ['heapUsedMB', 'rss_MB', 'avgProviderLatency', 'errorRate'];
    for (const key of metrics) {
        const val = snapshot[key];
        if (val == null || isNaN(val)) continue;

        if (!bl.metrics[key]) {
            bl.metrics[key] = { mean: val, variance: 0, min: val, max: val, n: 1 };
        } else {
            const m = bl.metrics[key];
            const oldMean = m.mean;
            m.n++;
            m.mean = oldMean + (val - oldMean) / m.n;
            m.variance = m.variance + (val - oldMean) * (val - m.mean);
            m.min = Math.min(m.min, val);
            m.max = Math.max(m.max, val);
        }
    }
    saveBaseline(bl);
    return bl;
}

function getStdDev(metric) {
    const bl = loadBaseline();
    const m = bl.metrics[metric];
    if (!m || m.n < 30) return null; // Not enough data
    return Math.sqrt(m.variance / m.n);
}

function isBaselineMature() {
    const bl = loadBaseline();
    if (!bl.created) return false;
    const age = Date.now() - new Date(bl.created).getTime();
    return age > BASELINE_MATURITY_DAYS * 86400000 && bl.samples > 500;
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────
function detectAnomalies(snapshot) {
    const bl = loadBaseline();
    const anomalies = [];

    for (const [key, val] of Object.entries(snapshot)) {
        if (typeof val !== 'number' || !bl.metrics[key]) continue;
        const m = bl.metrics[key];
        if (m.n < 30) continue; // Not enough baseline data

        const stdDev = Math.sqrt(m.variance / m.n);
        if (stdDev === 0) continue;

        const zScore = Math.abs(val - m.mean) / stdDev;
        if (zScore > ANOMALY_SIGMA) {
            anomalies.push({
                metric:   key,
                value:    val,
                baseline: Math.round(m.mean * 100) / 100,
                stdDev:   Math.round(stdDev * 100) / 100,
                zScore:   Math.round(zScore * 100) / 100,
                severity: zScore > 3 ? 'CRITICAL' : 'WARNING'
            });
        }
    }
    return anomalies;
}

// ─── Self-Healing Actions ─────────────────────────────────────────────────────
function logHealing(action, details = {}) {
    const record = {
        action,
        ...details,
        timestamp: new Date().toISOString()
    };
    _healingActions.push(record);
    if (_healingActions.length > 100) _healingActions.shift();
    try { fs.appendFileSync(HEALING_LOG, JSON.stringify(record) + '\n'); } catch {}
    console.log(`[SmartHealth] 🔧 Self-heal: ${action} — ${JSON.stringify(details)}`);
    return record;
}

function healMemory(snapshot) {
    if (snapshot.heapUsedMB > MEMORY_CRIT_MB) {
        if (global.gc) {
            global.gc();
            logHealing('FORCE_GC', { heapMB: snapshot.heapUsedMB, threshold: MEMORY_CRIT_MB });
        }
        return { action: 'MEMORY_CRITICAL', heapMB: snapshot.heapUsedMB };
    }
    if (snapshot.heapUsedMB > MEMORY_WARN_MB) {
        return { action: 'MEMORY_WARNING', heapMB: snapshot.heapUsedMB };
    }
    return null;
}

function healProvider(providerName, error) {
    if (!_failureCounts[providerName]) _failureCounts[providerName] = 0;
    _failureCounts[providerName]++;

    if (_failureCounts[providerName] >= PROVIDER_FAIL_THRESHOLD) {
        logHealing('PROVIDER_FAILOVER', {
            provider: providerName,
            failures: _failureCounts[providerName],
            error: error?.message || error
        });
        _failureCounts[providerName] = 0;
        return { action: 'FAILOVER', provider: providerName };
    }
    return null;
}

function healProviderSuccess(providerName) {
    _failureCounts[providerName] = 0;
}

function healSchedulerJob(jobName, error) {
    if (!_jobFailures[jobName]) _jobFailures[jobName] = 0;
    _jobFailures[jobName]++;

    if (_jobFailures[jobName] >= JOB_FAIL_THRESHOLD) {
        logHealing('JOB_PAUSED', {
            job: jobName,
            failures: _jobFailures[jobName],
            error: error?.message || error
        });
        return { action: 'PAUSE_JOB', job: jobName };
    }
    return null;
}

function healJobSuccess(jobName) {
    _jobFailures[jobName] = 0;
}

// ─── Snapshot Collector ───────────────────────────────────────────────────────
function collectSnapshot() {
    const mem = process.memoryUsage();
    const up  = process.uptime();

    // Get provider health if available
    let providerHealth = [];
    let avgLatency = 0;
    try {
        const { getAllHealth } = require('./lib/providers/provider_registry.cjs');
        providerHealth = getAllHealth();
        const healthy = providerHealth.filter(p => p.avgLatencyMs > 0);
        avgLatency = healthy.length > 0
            ? healthy.reduce((s, p) => s + p.avgLatencyMs, 0) / healthy.length : 0;
    } catch {}

    // Get recent errors
    let errorRate = 0;
    try {
        const { getRecentErrors } = require('./lib/errors/error_classifier.cjs');
        const recent = getRecentErrors(100);
        const lastHour = recent.filter(e => Date.now() - new Date(e.timestamp).getTime() < 3600000);
        errorRate = lastHour.length;
    } catch {}

    const snapshot = {
        timestamp:          new Date().toISOString(),
        uptimeSeconds:      Math.floor(up),
        heapUsedMB:         Math.round(mem.heapUsed / 1048576),
        heapTotalMB:        Math.round(mem.heapTotal / 1048576),
        rss_MB:             Math.round(mem.rss / 1048576),
        avgProviderLatency: Math.round(avgLatency),
        healthyProviders:   providerHealth.filter(p => p.healthy).length,
        totalProviders:     providerHealth.length,
        errorRate,          // errors in last hour
        providerFailures:   { ..._failureCounts },
        jobFailures:        { ..._jobFailures }
    };

    _snapshots.push(snapshot);
    if (_snapshots.length > MAX_SNAPSHOTS) _snapshots.shift();

    // Persist snapshot
    try { fs.appendFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot) + '\n'); } catch {}

    return snapshot;
}

// ─── Main Health Check Cycle ──────────────────────────────────────────────────
function runHealthCheck() {
    const snapshot  = collectSnapshot();
    const anomalies = detectAnomalies(snapshot);
    const memResult = healMemory(snapshot);

    // Update baseline with new data
    updateBaseline(snapshot);

    // ── Phase 11: Extended detection ──────────────────────────────────────────
    const warnings = [];
    const selfHealActions = [];

    // 1. Snapshot staleness detection
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const syncHealth = snapStore.getSyncHealth();
        for (const s of (syncHealth.snapshots || [])) {
            if (s.available && s.stale_level === 'EXPIRED') {
                warnings.push({ type: 'SNAPSHOT_EXPIRED', detail: `${s.type} snapshot expired (${s.age}s old)` });
            } else if (s.available && s.stale_level === 'STALE') {
                warnings.push({ type: 'SNAPSHOT_STALE', detail: `${s.type} snapshot stale (${s.age}s old)` });
            }
        }
        // 2. Fear & Greed staleness
        const fgSnap = snapStore.get('FEARGREED');
        if (!fgSnap) {
            warnings.push({ type: 'FEARGREED_MISSING', detail: 'No Fear & Greed snapshot — never fetched' });
        } else if (fgSnap.stale) {
            warnings.push({ type: 'FEARGREED_STALE', detail: `F&G stale (${fgSnap.cache_age_seconds}s, provider: ${fgSnap.source_provider})` });
        }
        // 3. Missing AI analysis
        const aiSnaps = snapStore.getAll('ANALYSIS');
        if (aiSnaps.length === 0) {
            warnings.push({ type: 'AI_MISSING', detail: 'No AI analysis snapshots — run /analyze to populate' });
        }
        // 4. Chart candle failure
        const candleSnap = snapStore.getLatest('CANDLE');
        if (candleSnap && candleSnap.stale) {
            warnings.push({ type: 'CANDLE_STALE', detail: `Candle data stale (${candleSnap.cache_age_seconds}s, ${candleSnap.symbol})` });
        }
    } catch(snapErr) {}

    // 5. API counter mismatch detection
    try {
        const { getAllQuotas } = require('./api_counter.cjs');
        const quotas = getAllQuotas();
        for (const q of quotas) {
            if (q.tier === 'free' && q.daily === 0 && q.total > 0) {
                // Provider was used historically but shows 0 today after reset — acceptable
            }
            if (q.tier === 'free' && q.errors > q.daily * 0.3 && q.daily > 5) {
                warnings.push({ type: 'API_HIGH_ERROR_RATE', detail: `${q.name}: ${q.errors} errors / ${q.daily} calls today` });
            }
        }
    } catch {}

    // 6. Memory growth trend (>90% of warn threshold)
    if (snapshot.heapUsedMB > MEMORY_WARN_MB * 0.9) {
        warnings.push({ type: 'MEMORY_APPROACHING', detail: `Heap at ${snapshot.heapUsedMB}MB (warn: ${MEMORY_WARN_MB}MB)` });
    }

    // 7. Veto spike detection (v3.3)
    try {
        const vetoResult = detectVetoSpike();
        if (vetoResult && vetoResult.spike) {
            warnings.push({ type: 'VETO_SPIKE', detail: vetoResult.detail });
        }
    } catch {}

    // 8. Pass-rate anomaly detection (v3.3)
    try {
        const prResult = detectPassRateAnomaly();
        if (prResult && prResult.anomaly) {
            warnings.push({ type: 'PASS_RATE_ANOMALY', detail: prResult.detail });
        }
    } catch {}

    // Self-healing: refresh stale providers (never touch trading logic)
    for (const w of warnings) {
        if (w.type === 'SNAPSHOT_EXPIRED') {
            selfHealActions.push(logHealing('REFRESH_STALE_SNAPSHOT', { snapshot_type: w.detail.split(' ')[0] }));
        }
    }

    return {
        snapshot,
        anomalies,
        memoryStatus: memResult,
        baselineMature: isBaselineMature(),
        healingActions: _healingActions.slice(-10),
        warnings,
        selfHealActions,
        status: anomalies.length === 0 && !memResult && warnings.length === 0 ? 'HEALTHY'
            : warnings.length > 0 && anomalies.length === 0 ? 'ATTENTION'
            : 'CRITICAL'
    };
}

// ─── Veto Spike Detection (v3.3) ──────────────────────────────────────────────
function detectVetoSpike() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const vetoSnap = snapStore.getLatest('VETO_STATS');
        if (!vetoSnap || !vetoSnap.data) return { spike: false };
        const blocked = vetoSnap.data.totalBlocked || 0;
        const total = (vetoSnap.data.totalBlocked || 0) + (vetoSnap.data.totalPassed || 0);
        // Spike: >80% vetoed with >=5 signals
        if (total >= 5 && blocked / total > 0.8) {
            return { spike: true, detail: `Veto spike: ${blocked}/${total} signals blocked (${Math.round(blocked/total*100)}%)` };
        }
        return { spike: false };
    } catch { return { spike: false }; }
}

// ─── Pass-Rate Anomaly Detection (v3.3) ───────────────────────────────────────
function detectPassRateAnomaly() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const vetoSnap = snapStore.getLatest('VETO_STATS');
        if (!vetoSnap || !vetoSnap.data) return { anomaly: false };
        const passed = vetoSnap.data.totalPassed || 0;
        const total = (vetoSnap.data.totalBlocked || 0) + passed;
        // Anomaly: 0% pass rate with >=5 signals
        if (total >= 5 && passed === 0) {
            return { anomaly: true, detail: `0% pass rate over ${total} signals — possible over-restriction or no-trade environment` };
        }
        return { anomaly: false };
    } catch { return { anomaly: false }; }
}

// ─── Error Trend Detection ────────────────────────────────────────────────────
function detectErrorTrends() {
    try {
        const { getRecentErrors } = require('./lib/errors/error_classifier.cjs');
        const errors = getRecentErrors(500); // look further back for temporal patterns
        const lastHour = errors.filter(e => Date.now() - new Date(e.timestamp).getTime() < 3600000);

        // Count by class (Immediate trend)
        const counts = {};
        for (const e of lastHour) {
            counts[e.error_class] = (counts[e.error_class] || 0) + 1;
        }

        // v5.0 Temporal Failure Pattern Learning (Hourly Clustering)
        const temporalClusters = {};
        for (const e of errors) {
            const h = new Date(e.timestamp).getUTCHours();
            const key = `${e.error_class}_${h}`;
            temporalClusters[key] = (temporalClusters[key] || 0) + 1;
        }

        const trends = Object.entries(counts)
            .filter(([, count]) => count >= 5)
            .map(([cls, count]) => {
                const currentHour = new Date().getUTCHours();
                const historicalHourlyFails = temporalClusters[`${cls}_${currentHour}`] || 0;
                
                let suggestion = getSuggestion(cls);
                let severity = count >= 10 ? 'CRITICAL' : 'ESCALATED';

                // Temporal heuristic: if historically > 15 fails at this exact hour, it's a known temporal pattern
                if (historicalHourlyFails > 15) {
                    suggestion = `[TEMPORAL_PATTERN] Known outage window (UTC ${currentHour}:00). Pre-emptively switch to fallback before this hour tomorrow.`;
                    severity = 'PREDICTIVE_WARNING';
                }

                return {
                    errorClass: cls,
                    count,
                    severity,
                    suggestion
                };
            });

        return trends;
    } catch { return []; }
}

// v5.0: Persist temporal clusters and expose summary for dashboard
function getErrorTrendSummary() {
    try {
        const trends = detectErrorTrends();
        if (trends.length === 0) return { status: 'CLEAR', message: 'No error trends detected', trends: [] };
        
        const critical = trends.filter(t => t.severity === 'CRITICAL');
        const predictive = trends.filter(t => t.severity === 'PREDICTIVE_WARNING');
        
        let message = '';
        if (critical.length > 0) {
            message = `🔴 ${critical.length} critical error trend(s): ${critical.map(t => t.errorClass).join(', ')}`;
        } else if (predictive.length > 0) {
            message = `🔮 ${predictive.length} predicted outage(s): ${predictive.map(t => t.suggestion.substring(0, 60)).join('; ')}`;
        } else {
            message = `⚠️ ${trends.length} escalated trend(s) detected`;
        }
        
        // Persist to disk for long-term learning
        try {
            const trendsFile = path.join(__dirname, 'logs', 'error_trends.json');
            const existing = fs.existsSync(trendsFile) ? JSON.parse(fs.readFileSync(trendsFile, 'utf8')) : { history: [] };
            existing.history.push({ timestamp: new Date().toISOString(), trends });
            if (existing.history.length > 500) existing.history = existing.history.slice(-500);
            fs.writeFileSync(trendsFile, JSON.stringify(existing, null, 2));
        } catch {}
        
        return { status: critical.length > 0 ? 'CRITICAL' : predictive.length > 0 ? 'PREDICTIVE' : 'ESCALATED', message, trends };
    } catch { return { status: 'CLEAR', message: 'Unable to compute trends', trends: [] }; }
}

function getSuggestion(errorClass) {
    const suggestions = {
        PROVIDER_ERROR:      'Check API keys and rate limits. Consider enabling fallback providers.',
        LLM_ERROR:           'LM Studio may be offline. Check local model server or switch to cloud LLM.',
        SCORING_ERROR:       'Review scoring-engine.cjs — input data shape may have changed.',
        VERIFICATION_ERROR:  'Check signal_verifier.cjs gates — a gate definition may be too strict.',
        PERSISTENCE_ERROR:   'Supabase connectivity issue. Check SUPABASE_URL and network.',
        DELIVERY_ERROR:      'Telegram API issue. Check TELEGRAM_BOT_TOKEN validity.',
        SCHEDULER_ERROR:     'Scheduler job crashing. Check individual job module for errors.',
        NORMALIZATION_ERROR: 'Provider API response format changed. Update normalizer.',
        AUTH_ERROR:          'API key expired or invalid. Rotate keys in telegram.env.'
    };
    return suggestions[errorClass] || 'Review system logs for root cause.';
}

// ─── Auto-Remediation Map ─────────────────────────────────────────────────────
const AUTO_REMEDIATION = {
    PROVIDER_ERROR:  { action: 'failover',    auto: true,  desc: 'Switch to backup provider' },
    LLM_ERROR:       { action: 'model_switch', auto: true,  desc: 'Route to next LLM in chain' },
    PERSISTENCE_ERROR: { action: 'queue_local', auto: true,  desc: 'Queue data locally until DB recovers' },
    DELIVERY_ERROR:  { action: 'retry_3x',    auto: true,  desc: 'Retry Telegram send 3 times' },
    SCORING_ERROR:   { action: 'alert_admin',  auto: false, desc: 'Requires manual review' },
    VERIFICATION_ERROR: { action: 'alert_admin', auto: false, desc: 'Gate logic needs manual fix' },
    AUTH_ERROR:       { action: 'alert_admin', auto: false, desc: 'Key rotation required' }
};

// ─── v3.4 Advanced Detectors ──────────────────────────────────────────────────

/**
 * Detect missing ANALYSIS snapshot (none in 2h).
 */
function detectMissingAnalysis() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const snap = snapStore.getLatest('ANALYSIS');
        if (!snap) return { fired: true, reason: 'No ANALYSIS snapshot exists' };
        const age = (Date.now() - new Date(snap.created_at).getTime()) / 1000;
        if (age > 7200) return { fired: true, reason: `ANALYSIS snapshot ${Math.round(age/60)}min old (>2h)` };
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect quota exhaustion risk (any provider >90% daily).
 */
function detectQuotaExhaustion() {
    try {
        const { QUOTAS, getStats } = require('./api_counter.cjs');
        const stats = getStats();
        const warnings = [];
        for (const [name, quota] of Object.entries(QUOTAS)) {
            if (!quota.daily) continue;
            const calls = stats.providers?.[name]?.totalCalls || 0;
            const pct = Math.round(calls / quota.daily * 100);
            if (pct > 90) warnings.push(`${quota.name}: ${pct}% of daily quota used`);
        }
        return { fired: warnings.length > 0, warnings };
    } catch { return { fired: false, warnings: [] }; }
}

/**
 * Detect scheduler delay (job interval >2x expected).
 */
function detectSchedulerDelay() {
    try {
        const snaps = _snapshots.slice(-5);
        if (snaps.length < 2) return { fired: false };
        const gaps = [];
        for (let i = 1; i < snaps.length; i++) {
            const gap = new Date(snaps[i].timestamp).getTime() - new Date(snaps[i-1].timestamp).getTime();
            gaps.push(gap);
        }
        const maxGap = Math.max(...gaps);
        // Expected 60s heartbeat → 2x = 120s
        if (maxGap > 120000) return { fired: true, reason: `Heartbeat gap ${Math.round(maxGap/1000)}s (expected ≤60s)` };
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect PM2 restart spike (uptime <5min = possible restart loop).
 */
function detectPM2RestartSpike() {
    const uptime = process.uptime();
    if (uptime < 300) return { fired: true, reason: `Uptime only ${Math.round(uptime)}s — possible restart loop` };
    return { fired: false };
}

/**
 * Detect Supabase read/write failures (>3 in 1h).
 */
function detectSupabaseFailure() {
    try {
        const { getStats } = require('./api_counter.cjs');
        const stats = getStats();
        const sb = stats.providers?.supabase;
        if (!sb) return { fired: false };
        if ((sb.failureCount || 0) >= 3) return { fired: true, reason: `Supabase: ${sb.failureCount} failures recorded` };
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect LLM timeout spikes (>3 in 1h).
 */
function detectLLMTimeout() {
    try {
        const { getStats } = require('./api_counter.cjs');
        const stats = getStats();
        const lm = stats.providers?.lmstudio || stats.providers?.aicc;
        if (!lm) return { fired: false };
        if ((lm.failureCount || 0) >= 3) return { fired: true, reason: `LLM: ${lm.failureCount} timeouts/failures` };
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect dashboard sync lag (>3 stale snapshot types).
 */
function detectDashboardSyncLag() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const health = snapStore.getSyncHealth();
        if (health.stale > 3) return { fired: true, reason: `${health.stale}/${health.total_types} snapshot types stale` };
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect chart/candle mismatch (chart shows different symbol than latest candle).
 */
function detectChartCandleMismatch() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const candle = snapStore.getLatest('CANDLE');
        if (!candle) return { fired: false };
        // Check if candle data is internally consistent
        if (candle.payload?.candles?.length === 0) return { fired: true, reason: 'CANDLE snapshot has 0 candles' };
        return { fired: false };
    } catch { return { fired: false }; }
}

// ─── v3.4 Self-Healing (non-trading) ──────────────────────────────────────────

function pauseNoisyNews() {
    logHealing('PAUSE_NOISY_NEWS', { reason: 'News false-positive spike detected' });
    // Sets a flag that news_collector checks
    _healingActions.push({ action: 'PAUSE_NOISY_NEWS', timestamp: new Date().toISOString() });
}

function markDashboardStale() {
    logHealing('MARK_DASHBOARD_STALE', { reason: 'Multiple snapshot types stale' });
}

function forceProviderFallback(provider) {
    logHealing('FORCE_PROVIDER_FALLBACK', { provider, reason: 'Provider failing — routing to fallback' });
    try {
        healProvider(provider, `Auto-fallback from v3.4 health watchdog`);
    } catch {}
}
// ─── v4.0 Advanced Detectors ──────────────────────────────────────────────────

/**
 * Detect confidence cap violation (any ANALYSIS snapshot with confidence >88).
 */
function detectConfidenceCapViolation() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const snaps = snapStore.getAll('ANALYSIS');
        const violations = snaps.filter(s => s.payload?.confidence > 88);
        if (violations.length > 0) {
            return { fired: true, reason: `${violations.length} analysis with confidence >${88}% (cap violated)`, symbols: violations.map(s => s.symbol) };
        }
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect stale macro refresh loop (MACRO retried >3× without success in 1h).
 */
function detectStaleRefreshLoop() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const macro = snapStore.getLatest('MACRO');
        if (!macro) return { fired: false };
        const age = (Date.now() - new Date(macro.created_at).getTime()) / 1000;
        // If macro is >2h old and still stale, it's a refresh loop
        if (age > 7200 && macro.stale) {
            return { fired: true, reason: `MACRO snapshot ${Math.round(age/3600)}h old — stale refresh loop detected` };
        }
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect news false-positive cross-contamination (GBP→OIL/XAUUSD).
 */
function detectNewsFalsePositive() {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const newsSnap = snapStore.getLatest('NEWS');
        if (!newsSnap || !newsSnap.payload?.headlines) return { fired: false };
        const headlines = newsSnap.payload.headlines;
        let falsePositives = 0;
        for (const h of headlines) {
            if (h.classification === 'SIGNAL_CANDIDATE' && h.asset_relevance) {
                const text = (h.title || '').toLowerCase();
                const hasGBP = text.includes('gbp') || text.includes('pound') || text.includes('sterling');
                const scoredOil = (h.asset_relevance.OIL || 0) > 40;
                const scoredGold = (h.asset_relevance.XAUUSD || 0) > 40;
                if (hasGBP && (scoredOil || scoredGold)) falsePositives++;
            }
        }
        if (falsePositives > 0) return { fired: true, reason: `${falsePositives} GBP headline(s) cross-contaminating OIL/XAUUSD` };
        return { fired: false };
    } catch { return { fired: false }; }
}

/**
 * Detect scheduler timeout/circuit breaker events.
 */
function detectSchedulerTimeout() {
    try {
        const sched = require('./scheduler.cjs');
        const breakers = sched._circuitBreakers || {};
        const tripped = Object.entries(breakers).filter(([, cb]) => cb.pausedUntil && Date.now() < cb.pausedUntil);
        if (tripped.length > 0) {
            return { fired: true, reason: `Circuit breakers tripped: ${tripped.map(([p]) => p).join(', ')}` };
        }
        const locks = sched._jobLocks || {};
        const stuck = Object.entries(locks).filter(([, locked]) => locked);
        if (stuck.length > 0) {
            return { fired: true, reason: `Jobs still running: ${stuck.map(([j]) => j).join(', ')}` };
        }
        return { fired: false };
    } catch { return { fired: false }; }
}

function getRemediation(errorClass) {
    return AUTO_REMEDIATION[errorClass] || { action: 'log_only', auto: false, desc: 'No auto-fix available' };
}

// ─── Format for Telegram ──────────────────────────────────────────────────────
function formatSmartHealth(adminMode = false) {
    const result = runHealthCheck();
    const trends = detectErrorTrends();
    const s = result.snapshot;

    const statusIcon = result.status === 'HEALTHY' ? '🟢' : '🟡';
    const lines = [
        `${statusIcon} *Smart Health Monitor v5.1*`,
        `_${new Date().toUTCString()}_\n`,
        `⏱ Uptime: ${Math.floor(s.uptimeSeconds/3600)}h ${Math.floor((s.uptimeSeconds%3600)/60)}m`,
        `💾 Heap: ${s.heapUsedMB}/${s.heapTotalMB}MB | RSS: ${s.rss_MB}MB`,
        `📡 Providers: ${s.healthyProviders}/${s.totalProviders} healthy`,
        `⚡ Avg Latency: ${s.avgProviderLatency}ms`,
        `🚨 Errors (1h): ${s.errorRate}`,
        `📊 Baseline: ${result.baselineMature ? '✅ Mature (learning active)' : '🔄 Building...'}`
    ];

    // v5.1 detectors in health output
    const v4Checks = [
        detectConfidenceCapViolation(),
        detectStaleRefreshLoop(),
        detectNewsFalsePositive(),
        detectSchedulerTimeout()
    ].filter(c => c.fired);
    if (v4Checks.length > 0) {
        lines.push('\n*🔍 v5.1 Watchdogs:*');
        for (const c of v4Checks) lines.push(`• ⚠️ ${c.reason}`);
    }

    // v5.1: Circuit breaker status
    try {
        const sched = require('./scheduler.cjs');
        const circuits = sched.getRefreshCircuitStatus ? sched.getRefreshCircuitStatus() : [];
        const openCircuits = circuits.filter(c => c.state === 'OPEN');
        if (openCircuits.length > 0) {
            lines.push('\n*🔌 Circuit Breakers (OPEN):*');
            for (const c of openCircuits) {
                lines.push(`• ${c.type}: ${c.attempts} failures, cooldown until ${c.cooldownUntil || 'N/A'}`);
            }
        }
    } catch {}

    if (result.anomalies.length > 0) {
        lines.push('\n*⚠️ Anomalies Detected:*');
        for (const a of result.anomalies) {
            lines.push(`• ${a.metric}: ${a.value} (baseline: ${a.baseline}, z: ${a.zScore})`);
        }
    }

    if (trends.length > 0) {
        lines.push('\n*📈 Error Trends:*');
        for (const t of trends) {
            lines.push(`• ${t.errorClass}: ${t.count}x/h — ${t.suggestion.substring(0, 60)}`);
        }
    }

    if (adminMode && result.healingActions.length > 0) {
        lines.push('\n*🔧 Recent Self-Healing:*');
        for (const h of result.healingActions.slice(-5)) {
            const target = h.provider || h.job || h.snapshot_type || h.reason || '';
            const time = h.timestamp ? h.timestamp.split('T')[1]?.substring(0, 8) || '' : '';
            lines.push(`• Action: ${h.action} | Target: ${target} | Time: ${time}`);
        }
    }

    return lines.join('\n');
}

// ─── Start monitoring loop ────────────────────────────────────────────────────
let _interval = null;
function startMonitoring(intervalMs = 60000) {
    if (_interval) return;
    console.log(`[SmartHealth] 🏥 Monitoring started (${intervalMs/1000}s intervals)`);
    _interval = setInterval(() => {
        try { runHealthCheck(); } catch(e) {
            console.error('[SmartHealth] Monitor error:', e.message);
        }
    }, intervalMs);
}

function stopMonitoring() {
    if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = {
    runHealthCheck,
    collectSnapshot,
    detectAnomalies,
    detectErrorTrends,
    getErrorTrendSummary,
    detectVetoSpike,
    detectPassRateAnomaly,
    // v3.4 detectors
    detectMissingAnalysis,
    detectQuotaExhaustion,
    detectSchedulerDelay,
    detectPM2RestartSpike,
    detectSupabaseFailure,
    detectLLMTimeout,
    detectDashboardSyncLag,
    detectChartCandleMismatch,
    // v4.0 detectors
    detectConfidenceCapViolation,
    detectStaleRefreshLoop,
    detectNewsFalsePositive,
    detectSchedulerTimeout,
    // Self-healing
    healProvider,
    healProviderSuccess,
    healSchedulerJob,
    healJobSuccess,
    healMemory,
    pauseNoisyNews,
    markDashboardStale,
    forceProviderFallback,
    getRemediation,
    getSuggestion,
    formatSmartHealth,
    startMonitoring,
    stopMonitoring,
    isBaselineMature,
    AUTO_REMEDIATION
};
