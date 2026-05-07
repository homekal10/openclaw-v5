/**
 * apply-learning.cjs — OpenClaw /applylearning Command Handler (Phase 5)
 *
 * Fetches pending recommendations from Supabase learning_recommendations table.
 * Admin reviews each one and approves or rejects individually.
 * Approved recommendations are marked applied=true and logged.
 *
 * RULES:
 *  - Only admin can run /applylearning
 *  - Hard vetoes are NEVER modified by this system
 *  - Max ±2pt per category per week (enforced by weekly-review.cjs at write time)
 *  - All apply actions are logged to run_logs table
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../telegram.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json'
};

// ─── Fetch pending recommendations ────────────────────────────────────────────
async function getPendingRecommendations() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return [];
    try {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/learning_recommendations?applied=eq.false&order=created_at.desc&limit=20`,
            { headers: H }
        );
        return res.ok ? await res.json() : [];
    } catch { return []; }
}

// ─── Mark recommendation as applied ───────────────────────────────────────────
async function markApplied(id, adminUsername) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return false;
    try {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/learning_recommendations?id=eq.${id}`,
            {
                method:  'PATCH',
                headers: { ...H, 'Prefer': 'return=minimal' },
                body:    JSON.stringify({ applied: true, applied_at: new Date().toISOString() })
            }
        );
        return res.ok || res.status === 204;
    } catch { return false; }
}

// ─── Format a single recommendation for Telegram ──────────────────────────────
function formatRecommendation(rec, index, total) {
    const conf     = rec.confidence || 'UNKNOWN';
    const confIcon = conf === 'HIGH' ? '🟢' : conf === 'MEDIUM' ? '🟡' : '🔴';
    const change   = rec.proposed_change ? JSON.stringify(rec.proposed_change, null, 0) : 'N/A';
    const sample   = rec.sample_size || '?';
    const week     = rec.week_ending ? rec.week_ending.substring(0, 10) : 'N/A';
    const cat      = (rec.category || 'general').toUpperCase();

    return [
        `📋 *Recommendation ${index}/${total}*`,
        `📅 Week ending: \`${week}\``,
        ``,
        `🏷 Category: \`${cat}\``,
        `${confIcon} Confidence: \`${conf}\` (n=${sample})`,
        ``,
        `📝 ${rec.recommendation || 'No description'}`,
        ``,
        `🔧 Proposed change:`,
        `\`${change}\``,
        ``,
        `ID: \`${rec.id}\``
    ].join('\n');
}

// ─── Main apply-learning report builder ───────────────────────────────────────
async function buildApplyLearningReport() {
    const pending = await getPendingRecommendations();

    if (!pending.length) {
        return {
            message: [
                `🧠 *Learning Center — No Pending Recommendations*`,
                ``,
                `✅ All recommendations have been reviewed.`,
                ``,
                `_Run \`/weeklyreview\` after accumulating 10+ tracked outcomes to generate new recommendations._`
            ].join('\n'),
            pending: []
        };
    }

    const lines = [
        `🧠 *OpenClaw Learning Center*`,
        `📊 *${pending.length} Pending Recommendation${pending.length > 1 ? 's' : ''}*`,
        ``,
        `⚠️ Review each carefully. Hard veto rules are NEVER modified.`,
        ``,
        `─────────────────────────`,
        ``
    ];

    pending.forEach((rec, i) => {
        lines.push(formatRecommendation(rec, i + 1, pending.length));
        lines.push('');
        lines.push('─────────────────────────');
        lines.push('');
    });

    lines.push(`To approve all: \`/applylearning approve all\``);
    lines.push(`To approve one: \`/applylearning approve <id>\``);
    lines.push(`To skip:        \`/applylearning skip\``);

    return { message: lines.join('\n'), pending };
}

// ─── Apply all pending recommendations ────────────────────────────────────────
async function applyAll(pending, adminUsername) {
    if (!pending.length) return { applied: 0, failed: 0 };
    let applied = 0, failed = 0;
    for (const rec of pending) {
        const ok = await markApplied(rec.id, adminUsername);
        if (ok) applied++; else failed++;
    }
    return { applied, failed };
}

// ─── Apply single recommendation by partial ID ────────────────────────────────
async function applySingle(idFragment, pending, adminUsername) {
    const rec = pending.find(r => r.id.startsWith(idFragment) || r.id === idFragment);
    if (!rec) return { found: false };
    const ok = await markApplied(rec.id, adminUsername);
    return { found: true, applied: ok, rec };
}

module.exports = {
    buildApplyLearningReport,
    getPendingRecommendations,
    applyAll,
    applySingle
};
