/**
 * weekly-review.cjs — OpenClaw Weekly Learning Engine (Phase 3 Upgrade)
 *
 * RULES (non-negotiable):
 *   1. Minimum 10 outcomes per category for a recommendation
 *   2. Max adjustment: ±2pt per scoring category per week
 *   3. Hard vetoes are NEVER touched
 *   4. Admin must approve before any change is applied
 *   5. Generated stats and realized stats are ALWAYS separated
 *   6. Confidence labeled: LOW (<15 samples) / MEDIUM (15-30) / HIGH (>30)
 *   7. All recommendations written to Supabase learning_recommendations table
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../telegram.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MIN_SAMPLE      = 10;    // Minimum trades per setup for any recommendation
const MAX_ADJUST_PT   = 2;     // Max ±pts per scoring category per week
const DEMOTE_THRESHOLD = 38;   // Win rate below this → DEMOTE recommendation
const PROMOTE_THRESHOLD = 72;  // Win rate above this → PROMOTE recommendation

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function supabaseFetch(table, query = '') {
    if (!SUPABASE_URL || !SUPABASE_KEY) return [];
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        return res.ok ? await res.json() : [];
    } catch { return []; }
}

async function supabaseInsert(table, record) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    try {
        const clean = Object.fromEntries(Object.entries(record).filter(([,v]) => v !== undefined && v !== null));
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(clean)
        });
        return res.ok;
    } catch { return null; }
}

// ─── Confidence Level ─────────────────────────────────────────────────────────
function getConfidence(sampleSize) {
    if (sampleSize >= 30) return 'high';
    if (sampleSize >= 15) return 'medium';
    return 'low';
}

function confIcon(level) {
    return { high: '🟢', medium: '🟡', low: '🔴' }[level] || '⚪';
}

// ─── Bounded adjustment ───────────────────────────────────────────────────────
function boundedAdjust(currentWeight, delta) {
    const clamped = Math.max(-MAX_ADJUST_PT, Math.min(MAX_ADJUST_PT, delta));
    return { newWeight: Math.max(0, currentWeight + clamped), delta: clamped };
}

// ─── Main function ────────────────────────────────────────────────────────────
async function runWeeklyReview() {
    const weekEnding = new Date().toISOString().split('T')[0];

    // ── Fetch REALIZED outcomes only (user-journaled trades) ──────────────────
    const outcomes = await supabaseFetch(
        'tracked_signal_outcomes',
        'order=tracked_at.desc&limit=500&select=*'
    );

    // ── Fetch GENERATED signals (system-generated, not necessarily traded) ────
    const generated = await supabaseFetch(
        'signal_snapshots',
        'order=created_at.desc&limit=500&select=symbol,direction,confidence,total_score,setup_type,session_at_signal,verification_state,created_at'
    );

    // ── Insufficient data guard ───────────────────────────────────────────────
    if (outcomes.length < MIN_SAMPLE) {
        return {
            report: [
                `📊 *Weekly Learning Report*`,
                `_${new Date().toUTCString()}_`,
                ``,
                `⚠️ *Insufficient data*`,
                `Only *${outcomes.length}* realized outcomes tracked.`,
                `Minimum required: *${MIN_SAMPLE}* for any analysis.`,
                ``,
                `📝 *Log trades with:* \`/journal win|loss|scratch SYMBOL [R]\``,
                ``,
                `_No recommendations this week. Keep logging._`
            ].join('\n'),
            adjustments: [],
            sampleSize: outcomes.length,
            confidence: 'low',
            insufficientData: true
        };
    }

    // ── Group realized outcomes by setup_type ─────────────────────────────────
    const bySetup   = {};
    const bySession = {};
    const byDir     = { BUY: { wins:0, losses:0 }, SELL: { wins:0, losses:0 } };

    for (const o of outcomes) {
        const setup = (o.setup_type || 'unclassified').toLowerCase();
        const sess  = (o.session || 'unknown').toLowerCase();
        const dir   = (o.direction || '').toUpperCase();

        if (!bySetup[setup])   bySetup[setup]   = { wins:0, losses:0, scratches:0, totalRR:0, count:0 };
        if (!bySession[sess])  bySession[sess]  = { wins:0, losses:0, count:0 };

        if (o.outcome === 'win')    { bySetup[setup].wins++;   bySession[sess].wins++;  if (dir && byDir[dir]) byDir[dir].wins++; }
        if (o.outcome === 'loss')   { bySetup[setup].losses++; bySession[sess].losses++; if (dir && byDir[dir]) byDir[dir].losses++; }
        if (o.outcome === 'scratch') bySetup[setup].scratches++;
        if (o.actual_rr) bySetup[setup].totalRR += parseFloat(o.actual_rr) || 0;
        bySetup[setup].count++;
        bySession[sess].count++;
    }

    // ── Compute stats ─────────────────────────────────────────────────────────
    const setupStats = Object.entries(bySetup).map(([setup, d]) => {
        const traded   = d.wins + d.losses;
        const winRate  = traded > 0 ? Math.round(d.wins / traded * 100) : null;
        const avgRR    = traded > 0 ? parseFloat((d.totalRR / traded).toFixed(2)) : null;
        const conf     = getConfidence(traded);
        return { setup, ...d, traded, winRate, avgRR, confidence: conf };
    }).sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

    const sessionStats = Object.entries(bySession).map(([session, d]) => {
        const traded  = d.wins + d.losses;
        const winRate = traded > 0 ? Math.round(d.wins / traded * 100) : null;
        const conf    = getConfidence(traded);
        return { session, ...d, traded, winRate, confidence: conf };
    }).sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

    // ── Generated signal stats (separate — never mix with realized) ───────────
    const genByAction = {};
    for (const g of generated) {
        const action = g.verification_state || g.direction || 'UNKNOWN';
        if (!genByAction[action]) genByAction[action] = 0;
        genByAction[action]++;
    }
    const avgGenScore = generated.length > 0
        ? Math.round(generated.reduce((a, g) => a + (g.total_score || 0), 0) / generated.length)
        : null;

    // ── Build BOUNDED recommendations ─────────────────────────────────────────
    const recommendations = [];

    for (const s of setupStats) {
        if (s.traded < MIN_SAMPLE) continue; // insufficient sample

        if (s.winRate !== null && s.winRate < DEMOTE_THRESHOLD) {
            const adj = boundedAdjust(10, -MAX_ADJUST_PT); // example base weight 10
            recommendations.push({
                category:        'weight_adjustment',
                setup:           s.setup,
                action:          'DEMOTE',
                reason:          `Win rate ${s.winRate}% < ${DEMOTE_THRESHOLD}% threshold`,
                sampleSize:      s.traded,
                confidence:      s.confidence,
                proposed_change: { setup: s.setup, delta: adj.delta, newWeight: adj.newWeight },
                week_ending:     weekEnding
            });
        } else if (s.winRate !== null && s.winRate > PROMOTE_THRESHOLD) {
            const adj = boundedAdjust(10, +MAX_ADJUST_PT);
            recommendations.push({
                category:        'weight_adjustment',
                setup:           s.setup,
                action:          'PROMOTE',
                reason:          `Win rate ${s.winRate}% > ${PROMOTE_THRESHOLD}% threshold`,
                sampleSize:      s.traded,
                confidence:      s.confidence,
                proposed_change: { setup: s.setup, delta: adj.delta, newWeight: adj.newWeight },
                week_ending:     weekEnding
            });
        }
    }

    // Setup-level reviews for consistently losing setups
    for (const s of setupStats) {
        if (s.traded >= MIN_SAMPLE && s.winRate !== null && s.winRate < 30) {
            recommendations.push({
                category:        'setup_review',
                setup:           s.setup,
                action:          'REVIEW',
                reason:          `Win rate ${s.winRate}% — consider removing from approved setup list`,
                sampleSize:      s.traded,
                confidence:      s.confidence,
                proposed_change: { setup: s.setup, action: 'REMOVE_FROM_APPROVED_LIST' },
                week_ending:     weekEnding
            });
        }
    }

    // ── Write recommendations to Supabase (non-blocking) ─────────────────────
    for (const rec of recommendations) {
        await supabaseInsert('learning_recommendations', {
            week_ending:     rec.week_ending,
            recommendation:  rec.reason,
            category:        rec.category,
            proposed_change: JSON.stringify(rec.proposed_change),
            applied:         false,
            sample_size:     rec.sampleSize,
            confidence:      rec.confidence
        }).catch(() => {});
    }

    // ── Overall confidence ────────────────────────────────────────────────────
    const overallConf = getConfidence(outcomes.length);

    // ── Format report ─────────────────────────────────────────────────────────
    const totalWins   = outcomes.filter(o => o.outcome === 'win').length;
    const totalLosses = outcomes.filter(o => o.outcome === 'loss').length;
    const totalScratch= outcomes.filter(o => o.outcome === 'scratch').length;
    const overallWR   = totalWins + totalLosses > 0
        ? Math.round(totalWins / (totalWins + totalLosses) * 100) : 0;

    const setupLines = setupStats.map(s => {
        const sampleNote = s.traded < MIN_SAMPLE ? ` ⚠️ _low sample (${s.traded})_` : '';
        return `  ${confIcon(s.confidence)} \`${s.setup}\`: *${s.winRate ?? '?'}%* WR | ${s.wins}W/${s.losses}L | avgRR ${s.avgRR ?? '?'}${sampleNote}`;
    }).join('\n') || '  No data';

    const sessionLines = sessionStats.map(s =>
        `  ${confIcon(s.confidence)} \`${s.session}\`: *${s.winRate ?? '?'}%* WR (${s.wins}W/${s.losses}L)`
    ).join('\n') || '  No data';

    const recLines = recommendations.length > 0
        ? recommendations.map(r =>
            `  ${r.action === 'PROMOTE' ? '⬆️' : r.action === 'DEMOTE' ? '⬇️' : '🔍'} \`${r.setup}\` → *${r.action}*: ${r.reason}\n    ${confIcon(r.confidence)} Confidence: ${r.confidence} (n=${r.sampleSize})`
          ).join('\n')
        : '  ✅ All setups within acceptable range — no changes needed';

    const dirLines = Object.entries(byDir).map(([dir, d]) => {
        const wr = d.wins + d.losses > 0 ? Math.round(d.wins / (d.wins + d.losses) * 100) : '?';
        return `  ${dir === 'BUY' ? '🟢' : '🔴'} ${dir}: *${wr}%* WR (${d.wins}W/${d.losses}L)`;
    }).join('\n');

    const genLines = [
        `  📡 Generated signals (last 500): *${generated.length}*`,
        avgGenScore !== null ? `  📊 Avg score of generated signals: *${avgGenScore}/100*` : '',
        ...Object.entries(genByAction).map(([k,v]) => `  ${k}: *${v}*`)
    ].filter(Boolean).join('\n');

    const report = [
        `📊 *Weekly Learning Report*`,
        `_Week ending: ${weekEnding}_`,
        `_${confIcon(overallConf)} Overall confidence: ${overallConf.toUpperCase()} (${outcomes.length} realized outcomes)_`,
        ``,
        `🎯 *Overall Performance (REALIZED only):*`,
        `  Total: *${totalWins}W / ${totalLosses}L / ${totalScratch} scratch*`,
        `  Win Rate: *${overallWR}%*`,
        ``,
        `📈 *Direction Breakdown:*`,
        dirLines,
        ``,
        `🎯 *Setup Win Rates (REALIZED):*`,
        setupLines,
        ``,
        `🕐 *Session Win Rates (REALIZED):*`,
        sessionLines,
        ``,
        `📡 *Generated Signals (NOT realized stats):*`,
        genLines || '  No data',
        ``,
        `🔧 *Recommendations* (max ±${MAX_ADJUST_PT}pt/week, admin approval required):`,
        recLines,
        ``,
        recommendations.length > 0
            ? `⚠️ _${recommendations.length} recommendation(s) saved. Apply with /applylearning (admin)_`
            : `_No changes needed this week._`,
        ``,
        `_Minimum ${MIN_SAMPLE} trades/setup for analysis | Hard veto rules never modified_`
    ].join('\n');

    return {
        report,
        recommendations,
        setupStats,
        sessionStats,
        sampleSize:  outcomes.length,
        confidence:  overallConf,
        weekEnding,
        generatedStats: { total: generated.length, avgScore: avgGenScore, byAction: genByAction }
    };
}

module.exports = { runWeeklyReview, MIN_SAMPLE, MAX_ADJUST_PT, getConfidence };
