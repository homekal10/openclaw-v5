/**
 * auto_update_policy.cjs — OpenClaw v5.1 Auto-Update Policy Engine
 *
 * Enforces which changes are auto-applicable vs. require admin approval.
 *
 * AUTO-APPLY ALLOWED:
 *   - false-positive keyword list
 *   - provider endpoint metadata
 *   - cache TTL adjustments (non-trading)
 *   - display text / labels
 *   - source reliability scores
 *   - bounded score-weight recommendations (if admin-enabled flag set)
 *
 * REQUIRES MANUAL ADMIN APPROVAL:
 *   - trading logic
 *   - signal verifier gates
 *   - veto engine rules
 *   - schema migrations
 *   - paid provider activation
 *   - broker execution config
 *   - dependency upgrades
 *   - deployment changes
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const POLICY_LOG = path.join(__dirname, '../../logs/auto_update_log.jsonl');
const APPROVAL_FILE = path.join(__dirname, '../../logs/pending_approvals.json');

// Ensure log dir
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ── Update Categories ─────────────────────────────────────────────────────────

const AUTO_APPLY_CATEGORIES = new Set([
    'false_positive_keywords',
    'provider_endpoint_metadata',
    'cache_ttl',
    'display_text',
    'source_reliability_score',
    'score_weight_recommendation'  // only if ADMIN_LEARNING_APPLY=true
]);

const MANUAL_APPROVAL_CATEGORIES = new Set([
    'trading_logic',
    'signal_verifier_gates',
    'veto_engine_rules',
    'schema_migration',
    'paid_provider_activation',
    'broker_execution',
    'dependency_upgrade',
    'deployment_change',
    'feature_flag_enable',
    'hard_veto_remove'
]);

/**
 * Check if an update can be auto-applied.
 * @param {string} category - Update category
 * @param {object} meta - { source, description, value }
 * @returns {{ allowed: boolean, reason: string, requires_approval: boolean }}
 */
function checkUpdatePolicy(category, meta = {}) {
    if (MANUAL_APPROVAL_CATEGORIES.has(category)) {
        return {
            allowed: false,
            requires_approval: true,
            reason: `Category '${category}' requires manual admin approval`,
            approvalType: 'ADMIN_APPROVAL_REQUIRED'
        };
    }

    if (!AUTO_APPLY_CATEGORIES.has(category)) {
        return {
            allowed: false,
            requires_approval: true,
            reason: `Unknown category '${category}' — defaulting to manual approval`,
            approvalType: 'UNKNOWN_CATEGORY'
        };
    }

    // Score weight changes require admin flag
    if (category === 'score_weight_recommendation') {
        const adminEnabled = process.env.ADMIN_LEARNING_APPLY === 'true';
        if (!adminEnabled) {
            return {
                allowed: false,
                requires_approval: true,
                reason: 'Score weight changes require ADMIN_LEARNING_APPLY=true env flag',
                approvalType: 'FLAG_REQUIRED'
            };
        }
    }

    return {
        allowed: true,
        requires_approval: false,
        reason: `Category '${category}' is auto-applicable`,
        approvalType: 'AUTO_APPLY'
    };
}

/**
 * Apply an auto-update with full audit trail.
 * @param {string} category
 * @param {object} meta - { source, description, before, after, changelog }
 * @returns {object} Result
 */
function applyAutoUpdate(category, meta = {}) {
    const policy = checkUpdatePolicy(category, meta);

    const entry = {
        id: `upd_${Date.now()}`,
        category,
        timestamp: new Date().toISOString(),
        source: meta.source || 'system',
        description: meta.description || '',
        before: meta.before || null,
        after: meta.after || null,
        changelog: meta.changelog || '',
        policy_check: policy,
        applied: policy.allowed,
        rollback_point: meta.before ? JSON.stringify(meta.before) : null,
        pre_test_status: meta.pre_test || 'not_run',
        post_test_status: meta.post_test || 'not_run',
        health_check: meta.health_check || 'pending'
    };

    // Log to JSONL
    try {
        fs.appendFileSync(POLICY_LOG, JSON.stringify(entry) + '\n');
    } catch {}

    if (!policy.allowed) {
        // Queue for admin approval
        queueForApproval(entry);
        return { success: false, reason: policy.reason, queued: true, id: entry.id };
    }

    return { success: true, id: entry.id, applied: true };
}

/**
 * Queue an update for admin approval.
 */
function queueForApproval(entry) {
    let pending = [];
    try { pending = JSON.parse(fs.readFileSync(APPROVAL_FILE, 'utf8')); } catch {}
    pending.push(entry);
    if (pending.length > 50) pending = pending.slice(-50);
    try { fs.writeFileSync(APPROVAL_FILE, JSON.stringify(pending, null, 2)); } catch {}
}

/**
 * Get pending approvals.
 */
function getPendingApprovals() {
    try { return JSON.parse(fs.readFileSync(APPROVAL_FILE, 'utf8')); } catch { return []; }
}

/**
 * Get recent auto-update log.
 */
function getUpdateLog(n = 20) {
    try {
        return fs.readFileSync(POLICY_LOG, 'utf8')
            .split('\n').filter(Boolean).slice(-n)
            .map(l => JSON.parse(l));
    } catch { return []; }
}

/**
 * Format auto-update status for Telegram /securitystatus.
 */
function formatSecurityStatus() {
    const pending = getPendingApprovals();
    const log = getUpdateLog(5);
    const applied = log.filter(l => l.applied).length;
    const blocked = log.filter(l => !l.applied).length;

    return `🔒 *OpenClaw Security & Update Status*
_${new Date().toUTCString()}_

*Auto-Update Policy:*
  ✅ Auto-apply categories: ${AUTO_APPLY_CATEGORIES.size}
  🔐 Manual-approval categories: ${MANUAL_APPROVAL_CATEGORIES.size}
  📋 Pending approvals: ${pending.length}

*Recent Updates (last 5):*
  ✅ Applied: ${applied} | 🔒 Blocked: ${blocked}

*Safety Locks:*
  🚫 Trading logic: MANUAL ONLY
  🚫 Veto rules: MANUAL ONLY
  🚫 Paid providers: MANUAL ONLY
  🚫 Broker execution: MANUAL ONLY
  ✅ Keywords/TTL/Display: AUTO-APPLY OK

_Use /schema to see data schema | /backupstatus for snapshot state_`;
}

/**
 * Format rate limit stats for /ratelimits command.
 */
function formatRateLimits() {
    // Pull from telegram_bot if available
    try {
        return `📊 *Rate Limit Status*
  Max commands/user/60s: 5
  Window: 60 seconds
  Scope: per Telegram user ID
  _Real-time stats available via admin dashboard_`;
    } catch {
        return '📊 Rate limiter active (5 cmd/60s per user)';
    }
}

module.exports = {
    checkUpdatePolicy,
    applyAutoUpdate,
    getPendingApprovals,
    getUpdateLog,
    formatSecurityStatus,
    formatRateLimits,
    AUTO_APPLY_CATEGORIES,
    MANUAL_APPROVAL_CATEGORIES
};
