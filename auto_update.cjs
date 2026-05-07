/**
 * auto_update.cjs — OpenClaw Self-Updating Agent v1.0
 *
 * Features:
 *   1. Version tracking with semantic versioning
 *   2. Update channels: strategy, model, pattern, system
 *   3. Safe auto-apply: weight changes ≤2pts auto-apply (matches weekly-review guard)
 *   4. Manual approval for structural changes (new setups, vetoes)
 *   5. Rollback: every update creates backup; /rollback restores last-known-good
 *   6. Changelog generation for /changelog command
 *   7. Scheduler integration: checks every 6h
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const VERSION_FILE    = path.join(__dirname, 'version.json');
const UPDATES_DIR     = path.join(__dirname, 'updates');
const BACKUP_DIR      = path.join(__dirname, 'updates', 'backups');
const CHANGELOG_FILE  = path.join(__dirname, 'updates', 'changelog.jsonl');

// Ensure directories
[UPDATES_DIR, BACKUP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Version Management ───────────────────────────────────────────────────────

function loadVersion() {
    try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')); }
    catch { return getDefaultVersion(); }
}

function saveVersion(version) {
    fs.writeFileSync(VERSION_FILE, JSON.stringify(version, null, 2));
}

function getDefaultVersion() {
    return {
        version: '5.1.0',
        codename: 'Institutional Alpha',
        buildDate: new Date().toISOString(),
        lastUpdate: null,
        updateCount: 0,
        pendingUpdates: [],
        appliedUpdates: [],
        rollbackAvailable: false
    };
}

// ─── Update Types ─────────────────────────────────────────────────────────────

const UPDATE_TYPES = {
    // Auto-apply allowed
    STRATEGY_WEIGHT:    { autoApply: true,  maxDelta: 2,   requiresApproval: false, desc: 'Scoring weight adjustment (≤2pts)' },
    MODEL_PROMPT:       { autoApply: true,  maxDelta: null, requiresApproval: false, desc: 'LLM prompt template update' },
    INDICATOR_PARAMS:   { autoApply: true,  maxDelta: null, requiresApproval: false, desc: 'Indicator parameter tweak' },
    SOURCE_RELIABILITY: { autoApply: true,  maxDelta: null, requiresApproval: false, desc: 'Source reliability list update' },
    FP_KEYWORD_LIST:    { autoApply: true,  maxDelta: null, requiresApproval: false, desc: 'False-positive keyword list update' },
    ENDPOINT_METADATA:  { autoApply: true,  maxDelta: null, requiresApproval: false, desc: 'Provider endpoint metadata update' },
    CACHE_TTL:          { autoApply: true,  maxDelta: null, requiresApproval: false, desc: 'Cache TTL configuration update' },
    DISPLAY_TEXT:       { autoApply: true,  maxDelta: null, requiresApproval: false, desc: 'Display text / label fix' },
    // Manual approval required
    PATTERN_LIBRARY:    { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'New ICT pattern definition' },
    SETUP_DEFINITION:   { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'New setup type or veto rule' },
    TRADING_LOGIC:      { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'Trading logic change (BUY/SELL rules)' },
    VERIFIER_LOGIC:     { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'Signal verifier / veto gate change' },
    SCHEMA_MIGRATION:   { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'Database schema migration' },
    PROVIDER_ACTIVATION:{ autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'Enable/disable data provider' },
    BROKER_EXECUTION:   { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'Broker execution configuration' },
    DEPENDENCY_UPGRADE: { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'npm dependency upgrade' },
    DEPLOYMENT_MODE:    { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'Deployment mode change' },
    SYSTEM_CONFIG:      { autoApply: false, maxDelta: null, requiresApproval: true,  desc: 'System configuration change' }
};

// ─── Create Update ────────────────────────────────────────────────────────────

function createUpdate(type, payload) {
    if (!UPDATE_TYPES[type]) throw new Error(`Unknown update type: ${type}`);

    const update = {
        id: `upd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        type,
        typeInfo: UPDATE_TYPES[type],
        payload,
        createdAt: new Date().toISOString(),
        status: 'pending',  // pending | applied | rejected | rolled_back
        autoApplyable: UPDATE_TYPES[type].autoApply,
        appliedAt: null,
        appliedBy: null
    };

    const ver = loadVersion();
    
    // v5.1: Version integrity check
    if (!ver.version || !ver.codename) {
        console.error('[AutoUpdate] Version file corrupted — rebuilding from defaults');
        const fresh = getDefaultVersion();
        fresh.pendingUpdates = ver.pendingUpdates || [];
        fresh.appliedUpdates = ver.appliedUpdates || [];
        Object.assign(ver, fresh);
    }
    
    ver.pendingUpdates.push(update);
    saveVersion(ver);

    return update;
}

// ─── Apply Update ─────────────────────────────────────────────────────────────

function applyUpdate(updateId, approvedBy = 'system') {
    const ver = loadVersion();
    const idx = ver.pendingUpdates.findIndex(u => u.id === updateId);
    if (idx === -1) return { success: false, error: 'Update not found' };

    const update = ver.pendingUpdates[idx];

    // Safety check for strategy weights
    if (update.type === 'STRATEGY_WEIGHT' && update.payload.delta) {
        if (Math.abs(update.payload.delta) > 2) {
            return { success: false, error: `Weight delta ${update.payload.delta} exceeds max ±2` };
        }
    }

    // Create backup before applying
    try {
        const backupName = `backup_${Date.now()}.json`;
        const backupPath = path.join(BACKUP_DIR, backupName);
        fs.writeFileSync(backupPath, JSON.stringify({
            version: ver,
            update,
            timestamp: new Date().toISOString()
        }, null, 2));
        ver.rollbackAvailable = true;
        ver.lastBackup = backupPath;
    } catch {}

    // Mark as applied
    update.status = 'applied';
    update.appliedAt = new Date().toISOString();
    update.appliedBy = approvedBy;

    // Move from pending to applied
    ver.pendingUpdates.splice(idx, 1);
    ver.appliedUpdates.push(update);
    ver.updateCount++;
    ver.lastUpdate = new Date().toISOString();

    // Log to changelog
    logChangelog(update);
    saveVersion(ver);

    return { success: true, update };
}

// ─── Auto-Apply Safe Updates ──────────────────────────────────────────────────

function autoApplySafeUpdates() {
    const ver = loadVersion();
    const results = [];

    // v5.1: Rate limit — max 5 auto-applies per 6h window
    const MAX_AUTO_PER_WINDOW = 5;
    const WINDOW_MS = 6 * 60 * 60 * 1000;
    const recentAutoApplied = (ver.appliedUpdates || []).filter(u => 
        u.appliedBy === 'auto_update' && u.appliedAt && 
        (Date.now() - new Date(u.appliedAt).getTime()) < WINDOW_MS
    ).length;
    
    if (recentAutoApplied >= MAX_AUTO_PER_WINDOW) {
        console.log(`[AutoUpdate] Rate limit: ${recentAutoApplied}/${MAX_AUTO_PER_WINDOW} auto-applies in 6h window — skipping`);
        return { applied: 0, pending: ver.pendingUpdates.length, rate_limited: true };
    }

    const remaining = MAX_AUTO_PER_WINDOW - recentAutoApplied;
    let applied = 0;

    for (const update of [...ver.pendingUpdates]) {
        if (applied >= remaining) break;
        if (update.autoApplyable) {
            const result = applyUpdate(update.id, 'auto_update');
            results.push(result);
            if (result.success) applied++;
        }
    }

    return {
        applied: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        pending: loadVersion().pendingUpdates.length,
        results
    };
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

function rollback() {
    const ver = loadVersion();
    if (!ver.rollbackAvailable || !ver.lastBackup) {
        return { success: false, error: 'No backup available for rollback' };
    }

    try {
        const backup = JSON.parse(fs.readFileSync(ver.lastBackup, 'utf8'));
        const restoredVer = backup.version;
        
        // Mark the rolled-back update
        if (backup.update) {
            backup.update.status = 'rolled_back';
            restoredVer.appliedUpdates.push(backup.update);
        }

        restoredVer.rollbackAvailable = false;
        saveVersion(restoredVer);

        logChangelog({ type: 'ROLLBACK', id: 'rollback', payload: { restoredFrom: ver.lastBackup } });

        return { success: true, restoredTo: backup.timestamp };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ─── Changelog ────────────────────────────────────────────────────────────────

function logChangelog(update) {
    const entry = {
        id: update.id,
        type: update.type,
        summary: update.payload?.summary || update.type,
        timestamp: new Date().toISOString()
    };
    try { fs.appendFileSync(CHANGELOG_FILE, JSON.stringify(entry) + '\n'); } catch {}
}

function getChangelog(limit = 20) {
    try {
        const lines = fs.readFileSync(CHANGELOG_FILE, 'utf8').split('\n').filter(Boolean);
        return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    } catch { return []; }
}

// ─── Check for Recommended Updates ────────────────────────────────────────────

function checkForUpdates() {
    const recommendations = [];

    // Check if scoring weights need adjustment based on learning data
    try {
        const perfLog = path.join(__dirname, 'logs', 'model_performance.json');
        if (fs.existsSync(perfLog)) {
            const perf = JSON.parse(fs.readFileSync(perfLog, 'utf8'));
            for (const [model, stats] of Object.entries(perf)) {
                if (stats.rate < 0.5 && stats.calls > 10) {
                    recommendations.push({
                        type: 'MODEL_PROMPT',
                        reason: `${model} success rate ${(stats.rate * 100).toFixed(0)}% — consider prompt update`,
                        priority: 'MEDIUM'
                    });
                }
            }
        }
    } catch {}

    // Check if health baseline suggests system changes
    try {
        const { isBaselineMature, detectErrorTrends } = require('./smart_health.cjs');
        if (isBaselineMature()) {
            const trends = detectErrorTrends();
            for (const t of trends) {
                recommendations.push({
                    type: 'SYSTEM_CONFIG',
                    reason: `${t.errorClass} occurring ${t.count}x/h — ${t.suggestion}`,
                    priority: t.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM'
                });
            }
        }
    } catch {}

    return { recommendations, checkedAt: new Date().toISOString() };
}

// ─── Format for Telegram ──────────────────────────────────────────────────────

function formatVersionInfo() {
    const ver = loadVersion();
    const lines = [
        `🔄 *OpenClaw ${ver.version} — ${ver.codename}*`,
        `_Built: ${ver.buildDate?.split('T')[0] || 'unknown'}_\n`,
        `📦 Updates applied: ${ver.updateCount}`,
        `⏰ Last update: ${ver.lastUpdate?.split('T')[0] || 'never'}`,
        `📋 Pending: ${ver.pendingUpdates.length}`,
        `↩️ Rollback: ${ver.rollbackAvailable ? '✅ Available' : '❌ None'}`
    ];
    return lines.join('\n');
}

function formatChangelog(limit = 10) {
    const entries = getChangelog(limit);
    if (entries.length === 0) return '📝 No changelog entries yet.';

    const lines = ['📝 *Changelog*\n'];
    for (const e of entries) {
        lines.push(`• \`${e.timestamp.split('T')[0]}\` — ${e.type}: ${e.summary}`);
    }
    return lines.join('\n');
}

// ─── v5.0 Autonomous Algorithm Proposal ─────────────────────────────────────────

async function proposeAlgorithmUpdate(promptDescription) {
    try {
        const { callLLM } = require('./lib/llm_router.cjs');
        const vm = require('vm');
        
        const prompt = `Write a stateless JavaScript function that takes a 'snapshot' object and returns a boolean (true if signal, false otherwise). Based on this logic: ${promptDescription}. ONLY output the raw JS code for the function, named 'evaluateSignal'.`;
        const res = await callLLM([{ role: 'user', content: prompt }], 'REASONING_LOOP');
        
        if (!res || !res.text) return { success: false, error: 'LLM failed to generate code' };
        
        const code = res.text.replace(/```javascript/g, '').replace(/```js/g, '').replace(/```/g, '').trim();
        
        // 1. Syntax Check & Sandbox Evaluation
        try {
            const script = new vm.Script(code);
            const context = vm.createContext({});
            script.runInContext(context);
            if (typeof context.evaluateSignal !== 'function') {
                return { success: false, error: 'Generated code did not export evaluateSignal function' };
            }
            
            // 2. Dummy Backtest
            const dummySnapshot = { price: 100, rsi: 30, macd: 0.5 };
            const testResult = context.evaluateSignal(dummySnapshot);
            if (typeof testResult !== 'boolean') {
                return { success: false, error: 'evaluateSignal did not return a boolean' };
            }
            
        } catch (e) {
            return { success: false, error: `Syntax/Runtime Error in proposed code: ${e.message}`, code };
        }
        
        // 3. Submit as Pending Update (Requires Admin Approval)
        const update = createUpdate('TRADING_LOGIC', {
            summary: `Autonomous Logic Proposal: ${promptDescription.substring(0, 50)}...`,
            code: code
        });
        
        return { success: true, updateId: update.id, code };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ─── v5.0 Repository Watch for Auto-Updates ─────────────────────────────────────

let _repoWatchInterval = null;

function watchRepoForUpdates(intervalMs = 5 * 60 * 1000) {
    if (_repoWatchInterval) return;
    const { execSync } = require('child_process');
    console.log('[AutoUpdate] 🔭 Repository watcher started');
    
    _repoWatchInterval = setInterval(() => {
        try {
            execSync('git fetch --tags', { cwd: __dirname, stdio: 'ignore', timeout: 15000 });
            const tags = execSync('git tag --sort=-creatordate', { cwd: __dirname, timeout: 10000 }).toString().trim().split('\n').filter(Boolean);
            if (tags.length === 0) return;
            const latestTag = tags[0];
            const ver = loadVersion();
            if (ver.latestKnownTag !== latestTag) {
                const update = createUpdate('PROMPT_TWEAK', {
                    summary: `New repo tag detected: ${latestTag} (was: ${ver.latestKnownTag || 'none'})`,
                    fromTag: ver.latestKnownTag || 'none',
                    toTag: latestTag
                });
                ver.latestKnownTag = latestTag;
                saveVersion(ver);
                console.log(`[AutoUpdate] 📦 New tag ${latestTag} → pending update ${update.id}`);
            }
        } catch (e) {
            // Silently ignore git errors (no repo, no network, etc.)
        }
    }, intervalMs);
}

// ─── v5.1: Forbidden API Scanner for Code Proposals ─────────────────────────
const FORBIDDEN_APIS = ['require(', 'eval(', 'new Function', 'child_process', 'process.exit', 'process.env', 'fs.', 'fs '];
const FORBIDDEN_PATTERNS = [
    /\brequire\s*\(/g,
    /\beval\s*\(/g,
    /new\s+Function\s*\(/g,
    /child_process/g,
    /process\.exit/g,
    /process\.env/g,
    /\bfs\s*\.\s*(read|write|unlink|rmdir|mkdir|appendFile|createWrite)/g,
    /\bfetch\s*\(/g,
    /XMLHttpRequest/g,
    /http\.request/g,
    /https\.request/g
];

function scanForForbiddenAPIs(code) {
    if (!code || typeof code !== 'string') return { safe: false, violations: ['No code provided'] };
    const violations = [];
    FORBIDDEN_PATTERNS.forEach((pattern, i) => {
        const label = FORBIDDEN_APIS[i] || `pattern_${i}`;
        if (pattern.test(code)) violations.push(`Forbidden API: ${label}`);
        pattern.lastIndex = 0; // reset stateful regex
    });
    return { safe: violations.length === 0, violations };
}

module.exports = {
    loadVersion,
    saveVersion,
    createUpdate,
    applyUpdate,
    autoApplySafeUpdates,
    rollback,
    getChangelog,
    checkForUpdates,
    formatVersionInfo,
    formatChangelog,
    proposeAlgorithmUpdate,
    watchRepoForUpdates,
    scanForForbiddenAPIs,
    UPDATE_TYPES
};
