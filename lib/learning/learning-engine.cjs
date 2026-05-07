/**
 * learning-engine.cjs — OpenClaw v5.1 Learning Engine
 *
 * Analyzes signal generation history + journal outcomes to produce:
 *   1. Setup type win/fail rates
 *   2. Session performance breakdown
 *   3. Asset performance breakdown
 *   4. Veto effectiveness analysis
 *   5. Actionable recommendations
 *
 * Data sources:
 *   - Local trading_log.json (signal generation history)
 *   - Local journal entries via signal-store.cjs
 *   - Snapshot store (recent snapshots)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_FILE     = path.join(__dirname, '../../logs/trading_log.json');
const JOURNAL_FILE = path.join(__dirname, '../../logs/journal.json');

/**
 * runWeeklyReview() → WeeklyReport
 * Aggregates the last 7 days of signal data + journal outcomes.
 */
function runWeeklyReview() {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = now - weekMs;

    // ── Load signal generation history ─────────────────────────────
    let signals = [];
    try {
        if (fs.existsSync(LOG_FILE)) {
            signals = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'))
                .filter(s => new Date(s.timestamp).getTime() > cutoff);
        }
    } catch(e) {}

    // ── Load journal entries ───────────────────────────────────────
    let journal = [];
    try {
        if (fs.existsSync(JOURNAL_FILE)) {
            journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'))
                .filter(j => new Date(j.tracked_at).getTime() > cutoff);
        }
    } catch(e) {}

    // ── Setup Type Analysis ────────────────────────────────────────
    const setupStats = {};
    signals.forEach(s => {
        const setup = s.setup_type || s.setupType || 'unclassified';
        if (!setupStats[setup]) setupStats[setup] = { generated: 0, passed: 0, rejected: 0, avgScore: [] };
        setupStats[setup].generated++;
        if (s.signal === 'BUY' || s.signal === 'SELL') setupStats[setup].passed++;
        else setupStats[setup].rejected++;
        if (s.score) setupStats[setup].avgScore.push(s.score);
    });

    // Merge journal outcomes into setup stats
    journal.forEach(j => {
        // Try to find the matching setup type from signals
        const match = signals.find(s => s.symbol === j.asset && 
            Math.abs(new Date(s.timestamp).getTime() - new Date(j.tracked_at).getTime()) < 24 * 60 * 60 * 1000);
        const setup = match?.setup_type || match?.setupType || 'unclassified';
        if (!setupStats[setup]) setupStats[setup] = { generated: 0, passed: 0, rejected: 0, avgScore: [], wins: 0, losses: 0 };
        if (!setupStats[setup].wins) setupStats[setup].wins = 0;
        if (!setupStats[setup].losses) setupStats[setup].losses = 0;
        if (j.outcome === 'win') setupStats[setup].wins++;
        else if (j.outcome === 'loss') setupStats[setup].losses++;
    });

    // Finalize setup stats
    const setupReport = Object.entries(setupStats).map(([name, s]) => {
        const avg = s.avgScore.length ? Math.round(s.avgScore.reduce((a, b) => a + b, 0) / s.avgScore.length) : 0;
        const totalOutcomes = (s.wins || 0) + (s.losses || 0);
        const winRate = totalOutcomes > 0 ? Math.round((s.wins || 0) / totalOutcomes * 100) : null;
        return { name, generated: s.generated, passed: s.passed, rejected: s.rejected, avgScore: avg, wins: s.wins || 0, losses: s.losses || 0, winRate };
    }).sort((a, b) => b.generated - a.generated);

    // ── Session Analysis ───────────────────────────────────────────
    const sessionStats = {};
    signals.forEach(s => {
        const sess = s.session || 'unknown';
        if (!sessionStats[sess]) sessionStats[sess] = { total: 0, passed: 0, avgScore: [] };
        sessionStats[sess].total++;
        if (s.signal === 'BUY' || s.signal === 'SELL') sessionStats[sess].passed++;
        if (s.score) sessionStats[sess].avgScore.push(s.score);
    });
    const sessionReport = Object.entries(sessionStats).map(([name, s]) => ({
        name,
        total: s.total,
        passed: s.passed,
        passRate: s.total ? Math.round(s.passed / s.total * 100) : 0,
        avgScore: s.avgScore.length ? Math.round(s.avgScore.reduce((a, b) => a + b, 0) / s.avgScore.length) : 0
    })).sort((a, b) => b.passRate - a.passRate);

    // ── Asset Analysis ─────────────────────────────────────────────
    const assetStats = {};
    signals.forEach(s => {
        const sym = s.symbol || 'UNKNOWN';
        if (!assetStats[sym]) assetStats[sym] = { total: 0, passed: 0, avgScore: [], avgRR: [] };
        assetStats[sym].total++;
        if (s.signal === 'BUY' || s.signal === 'SELL') assetStats[sym].passed++;
        if (s.score) assetStats[sym].avgScore.push(s.score);
        if (s.rewardRisk) assetStats[sym].avgRR.push(parseFloat(s.rewardRisk) || 0);
    });

    // Merge journal wins/losses per asset
    journal.forEach(j => {
        const sym = j.asset || 'UNKNOWN';
        if (!assetStats[sym]) assetStats[sym] = { total: 0, passed: 0, avgScore: [], avgRR: [], wins: 0, losses: 0 };
        if (!assetStats[sym].wins) assetStats[sym].wins = 0;
        if (!assetStats[sym].losses) assetStats[sym].losses = 0;
        if (j.outcome === 'win') assetStats[sym].wins++;
        else if (j.outcome === 'loss') assetStats[sym].losses++;
    });

    const assetReport = Object.entries(assetStats).map(([name, s]) => {
        const totalOutcomes = (s.wins || 0) + (s.losses || 0);
        return {
            name,
            total: s.total,
            passed: s.passed,
            passRate: s.total ? Math.round(s.passed / s.total * 100) : 0,
            avgScore: s.avgScore.length ? Math.round(s.avgScore.reduce((a, b) => a + b, 0) / s.avgScore.length) : 0,
            avgRR: s.avgRR.length ? parseFloat((s.avgRR.reduce((a, b) => a + b, 0) / s.avgRR.length).toFixed(1)) : 0,
            wins: s.wins || 0, losses: s.losses || 0,
            winRate: totalOutcomes > 0 ? Math.round((s.wins || 0) / totalOutcomes * 100) : null
        };
    }).sort((a, b) => b.total - a.total);

    // ── Veto Effectiveness ─────────────────────────────────────────
    const totalSignals = signals.length;
    const totalPassed = signals.filter(s => s.signal === 'BUY' || s.signal === 'SELL').length;
    const totalRejected = totalSignals - totalPassed;
    const filterRate = totalSignals > 0 ? Math.round(totalRejected / totalSignals * 100) : 0;

    // ── Recommendations ────────────────────────────────────────────
    const recommendations = [];

    // Best setup type
    const bestSetup = setupReport.find(s => s.winRate !== null && s.winRate > 0);
    if (bestSetup) {
        recommendations.push(`🏆 Best setup: ${bestSetup.name} — ${bestSetup.winRate}% win rate (${bestSetup.wins}W/${bestSetup.losses}L)`);
    }

    // Worst setup
    const worstSetup = setupReport.find(s => s.winRate !== null && s.winRate < 50 && (s.wins + s.losses) >= 3);
    if (worstSetup) {
        recommendations.push(`⚠️ Review setup: ${worstSetup.name} — only ${worstSetup.winRate}% win rate`);
    }

    // Session recommendation
    const bestSession = sessionReport[0];
    if (bestSession && bestSession.passRate > 0) {
        recommendations.push(`🕐 Best session: ${bestSession.name} — ${bestSession.passRate}% pass rate, avg score ${bestSession.avgScore}`);
    }

    // Filter rate check
    if (filterRate > 80) {
        recommendations.push(`🛡️ Filter rate: ${filterRate}% — system is very selective. This is disciplined.`);
    } else if (filterRate < 40) {
        recommendations.push(`⚠️ Filter rate: ${filterRate}% — too many signals passing. Tighten vetoes or raise score threshold.`);
    }

    // Journal participation
    if (journal.length === 0) {
        recommendations.push(`📓 No journal entries this week — use /journal to track outcomes for better learning.`);
    }

    if (!recommendations.length) {
        recommendations.push(`📊 Insufficient data for recommendations — keep generating signals and logging outcomes.`);
    }

    return {
        period: '7 days',
        totalSignals,
        totalPassed,
        totalRejected,
        filterRate,
        journalEntries: journal.length,
        journalWins: journal.filter(j => j.outcome === 'win').length,
        journalLosses: journal.filter(j => j.outcome === 'loss').length,
        setupReport,
        sessionReport,
        assetReport,
        recommendations,
        generatedAt: new Date().toISOString()
    };
}

/**
 * formatWeeklyReview(report) → Telegram message string
 */
function formatWeeklyReview(report) {
    const lines = [
        `📊 *Weekly Learning Review*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `_Period: Last ${report.period}_`,
        ``,
        `📈 *Generation Summary:*`,
        `  Signals Analyzed: *${report.totalSignals}*`,
        `  Passed (BUY/SELL): *${report.totalPassed}*`,
        `  Filtered (WAIT/REJECTED): *${report.totalRejected}*`,
        `  Filter Rate: *${report.filterRate}%*`,
        ``
    ];

    // Journal outcomes
    if (report.journalEntries > 0) {
        const jWinRate = (report.journalWins + report.journalLosses) > 0
            ? Math.round(report.journalWins / (report.journalWins + report.journalLosses) * 100) : 0;
        lines.push(`📓 *Tracked Outcomes:*`);
        lines.push(`  Wins: *${report.journalWins}* | Losses: *${report.journalLosses}*`);
        lines.push(`  Win Rate: *${jWinRate}%*`);
        lines.push(``);
    }

    // Setup performance
    if (report.setupReport.length > 0) {
        lines.push(`🎯 *Setup Type Performance:*`);
        report.setupReport.slice(0, 5).forEach(s => {
            const wrStr = s.winRate !== null ? ` | WR: ${s.winRate}%` : '';
            lines.push(`  • ${s.name.replace(/_/g, ' ')}: ${s.generated} gen, ${s.passed} pass, avg ${s.avgScore}/100${wrStr}`);
        });
        lines.push(``);
    }

    // Session performance
    if (report.sessionReport.length > 0) {
        lines.push(`🕐 *Session Performance:*`);
        report.sessionReport.slice(0, 4).forEach(s => {
            const icon = s.passRate >= 30 ? '🟢' : s.passRate >= 15 ? '🟡' : '🔴';
            lines.push(`  ${icon} ${s.name}: ${s.passRate}% pass | avg ${s.avgScore}/100`);
        });
        lines.push(``);
    }

    // Asset performance
    if (report.assetReport.length > 0) {
        lines.push(`💰 *Asset Performance:*`);
        report.assetReport.slice(0, 4).forEach(a => {
            const wrStr = a.winRate !== null ? ` | WR: ${a.winRate}%` : '';
            lines.push(`  • ${a.name}: ${a.total} signals, avg R:R ${a.avgRR}:1${wrStr}`);
        });
        lines.push(``);
    }

    // Recommendations
    lines.push(`💡 *Recommendations:*`);
    report.recommendations.forEach(r => lines.push(`  ${r}`));
    lines.push(``);
    lines.push(`_Generated ${new Date().toUTCString()}_`);
    lines.push(`_Use /journal to track outcomes for better learning._`);

    return lines.join('\n');
}

/**
 * saveJournalEntry(entry) — saves to local journal file
 */
function saveJournalEntry(entry) {
    let journal = [];
    try {
        if (fs.existsSync(JOURNAL_FILE)) {
            journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'));
        }
    } catch(e) {}
    journal.push(entry);
    if (journal.length > 500) journal = journal.slice(-500);
    const dir = path.dirname(JOURNAL_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 2));
}

/**
 * getJournalEntries(days) — reads recent journal entries
 */
function getJournalEntries(days = 30) {
    try {
        if (!fs.existsSync(JOURNAL_FILE)) return [];
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        return JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'))
            .filter(j => new Date(j.tracked_at).getTime() > cutoff);
    } catch(e) { return []; }
}

// ─── v3.4 Learning Intelligence ──────────────────────────────────────────────

const MIN_SAMPLE_SIZE = 10;
const MAX_WEEKLY_WEIGHT_CHANGE = 2;

/**
 * getLearningStatus() — Returns sample sizes, maturity, confidence.
 */
function getLearningStatus() {
    const journal = getJournalEntries(90); // 90 days lookback
    let signals = [];
    try {
        if (fs.existsSync(LOG_FILE)) {
            signals = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        }
    } catch {}

    const totalOutcomes = journal.length;
    const mature = totalOutcomes >= MIN_SAMPLE_SIZE;

    // Setup maturity
    const setupCounts = {};
    journal.forEach(j => {
        const setup = j.setup_type || 'unclassified';
        setupCounts[setup] = (setupCounts[setup] || 0) + 1;
    });

    // Asset maturity
    const assetCounts = {};
    journal.forEach(j => {
        const asset = j.asset || 'UNKNOWN';
        assetCounts[asset] = (assetCounts[asset] || 0) + 1;
    });

    return {
        total_outcomes: totalOutcomes,
        total_signals: signals.length,
        mature,
        min_sample_size: MIN_SAMPLE_SIZE,
        max_weekly_weight_change: MAX_WEEKLY_WEIGHT_CHANGE,
        setup_sample_sizes: setupCounts,
        asset_sample_sizes: assetCounts,
        can_recommend: mature,
        safety_locks: {
            never_remove_vetoes: true,
            never_activate_brokers: true,
            never_activate_paid_providers: true,
            never_auto_change_trading_logic: true,
            max_weight_change_per_week: MAX_WEEKLY_WEIGHT_CHANGE
        }
    };
}

/**
 * getModelScore() — Aggregate model/agent performance from ANALYSIS snapshots.
 */
function getModelScore() {
    try {
        const snapStore = require('../snapshots/snapshot_store.cjs');
        const analyses = snapStore.getAll('ANALYSIS');
        if (!analyses.length) return { score: 0, samples: 0, note: 'No analysis data yet' };

        let totalLatency = 0, totalSuccess = 0, totalRuns = 0;
        const modelCounts = {};

        analyses.forEach(a => {
            const runs = a.payload?.agent_runs || [];
            runs.forEach(r => {
                totalRuns++;
                if (r.success) totalSuccess++;
                totalLatency += r.latency_ms || 0;
                const m = r.model || 'unknown';
                if (!modelCounts[m]) modelCounts[m] = { success: 0, fail: 0, total_latency: 0 };
                modelCounts[m][r.success ? 'success' : 'fail']++;
                modelCounts[m].total_latency += r.latency_ms || 0;
            });
        });

        const successRate = totalRuns > 0 ? Math.round(totalSuccess / totalRuns * 100) : 0;
        const avgLatency = totalRuns > 0 ? Math.round(totalLatency / totalRuns) : 0;

        // Score: 50% success rate + 50% latency bonus (sub 5s = full marks)
        const latencyScore = Math.max(0, 50 - Math.round(avgLatency / 100));
        const score = Math.round(successRate * 0.5 + latencyScore);

        return {
            score: Math.min(100, score),
            samples: analyses.length,
            total_agent_runs: totalRuns,
            success_rate: successRate,
            avg_latency_ms: avgLatency,
            models: Object.entries(modelCounts).map(([model, stats]) => ({
                model,
                success: stats.success,
                fail: stats.fail,
                avg_latency: Math.round(stats.total_latency / (stats.success + stats.fail))
            }))
        };
    } catch(e) {
        return { score: 0, samples: 0, error: e.message };
    }
}

/**
 * validateWeightChange(current, proposed) — Guard: max ±2 per week.
 */
function validateWeightChange(current, proposed) {
    const delta = Math.abs(proposed - current);
    if (delta > MAX_WEEKLY_WEIGHT_CHANGE) {
        return {
            approved: false,
            reason: `Weight change ${delta} exceeds max ${MAX_WEEKLY_WEIGHT_CHANGE}/week`,
            clamped: current + Math.sign(proposed - current) * MAX_WEEKLY_WEIGHT_CHANGE
        };
    }
    return { approved: true, reason: 'Within bounds', clamped: proposed };
}

/**
 * v5.1: getJournalStats() — Aggregate journal stats for /stats command
 */
function getJournalStats(days = 30) {
    const journal = getJournalEntries(days);
    const wins = journal.filter(j => j.outcome === 'win').length;
    const losses = journal.filter(j => j.outcome === 'loss').length;
    const scratches = journal.filter(j => j.outcome === 'scratch' || j.outcome === 'cancelled').length;
    const total = journal.length;
    const decided = wins + losses;
    const winRate = decided >= 3 ? Math.round(wins / decided * 100) : null;
    
    const rrValues = journal.filter(j => j.actual_rr != null && j.actual_rr > 0).map(j => j.actual_rr);
    const avgRR = rrValues.length >= 3 ? parseFloat((rrValues.reduce((a, b) => a + b, 0) / rrValues.length).toFixed(1)) : null;
    
    return { total, wins, losses, scratches, winRate, avgRR };
}

module.exports = {
    runWeeklyReview, formatWeeklyReview,
    saveJournalEntry, getJournalEntries, getJournalStats,
    getLearningStatus, getModelScore, validateWeightChange,
    MIN_SAMPLE_SIZE, MAX_WEEKLY_WEIGHT_CHANGE
};
