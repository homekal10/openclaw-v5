/**
 * signal-store.cjs — OpenClaw Signal Storage Layer
 *
 * Writes orchestrator output to Supabase.
 * Graceful — never crashes the pipeline if Supabase is unavailable.
 * Queues locally if write fails, retries once after 60s.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../telegram.env') });

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const QUEUE_FILE    = path.join(__dirname, '../../logs/signal_queue.json');

// toArr — always returns a JS array for TEXT[] Supabase columns
// PostgREST auto-converts JSON arrays to PostgreSQL TEXT[] format
function toArr(val) {
    if (!val) return null;
    if (Array.isArray(val)) return val.filter(Boolean).length ? val.filter(Boolean) : null;
    const s = String(val).trim();
    return s ? [s] : null;
}


// Confirmed base columns — always present (schema fully upgraded)
const BASE_COLUMNS = new Set([
    'symbol','direction','confidence','total_score','setup_type','setup_label',
    'session_label','trend_state_4h','trend_state_1h','structure_state',
    'fvg_detected','fvg_in_entry_zone','sweep_detected','sweep_type',
    'price_position','is_chase_entry','why_trade','why_not_trade',
    'invalidation_level','veto_summary','veto_passed','event_risk_level',
    'macro_regime','position_size','dollar_risk','run_duration_ms',
    'agreement_summary','needed_confirmation','provider_meta','account_size','trend_1h',
    // Phase 1 columns (now live in Supabase after SUPABASE_SCHEMA_UPGRADE.sql)
    'run_id','verification_state','session_at_signal','veto_result','failed_gates','data_quality','price_source',
    'error_count','agent_outputs',
    // v4.0 columns (live after v4_schema_upgrade.sql)
    'veto_flags','veto_count','veto_categories','gate_failures','setup_confidence','score_breakdown'
]);

// ─── Supabase REST helper ──────────────────────────────────────────────────────
async function supabaseInsert(table, record, baseOnly = false) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase not configured');

    // Strip undefined/null first
    let clean = Object.fromEntries(Object.entries(record).filter(([,v]) => v !== undefined && v !== null));

    // If baseOnly mode, strip any Phase 1 columns not yet in schema
    if (baseOnly && table === 'signal_snapshots') {
        clean = Object.fromEntries(Object.entries(clean).filter(([k]) => BASE_COLUMNS.has(k)));
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=representation'
        },
        body: JSON.stringify(clean)
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => String(res.status));
        // PGRST204 = column not found — schema needs upgrade, retry with base columns
        if (!baseOnly && errText.includes('PGRST204')) {
            console.warn('[SignalStore] Schema missing Phase 1 columns — retrying with base columns. Run SUPABASE_SCHEMA_UPGRADE.sql to enable full tracking.');
            return supabaseInsert(table, record, true);
        }
        throw new Error(`Supabase ${table} insert failed: ${errText}`);
    }

    return await res.json();
}


// ─── Local queue for retry ─────────────────────────────────────────────────────
function enqueue(table, record) {
    let queue = [];
    try { if (fs.existsSync(QUEUE_FILE)) queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch(e) {}
    queue.push({ table, record, queuedAt: new Date().toISOString() });
    if (queue.length > 100) queue = queue.slice(-100); // cap
    try { fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2)); } catch(e) {}
}

async function flushQueue() {
    if (!fs.existsSync(QUEUE_FILE)) return;
    let queue = [];
    try { queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch(e) { return; }
    if (!queue.length) return;

    const remaining = [];
    for (const item of queue) {
        try {
            await supabaseInsert(item.table, item.record);
        } catch(e) {
            remaining.push(item);
        }
    }
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(remaining, null, 2));
    if (remaining.length < queue.length) {
        console.log(`[SignalStore] Flushed ${queue.length - remaining.length} queued records`);
    }
}

// ─── Main save function ────────────────────────────────────────────────────────
/**
 * saveSignalSnapshot(orchResult, agentOutputs) → { id, saved }
 * Called by orchestrator after synthesis agent completes.
 */
async function saveSignalSnapshot(orchResult, agentOutputs = {}) {
    // Columns confirmed in deployed schema (002_patch adds more if run)
    const record = {
        asset:              orchResult.symbol,
        final_action:       orchResult.final_action   || 'REJECTED',
        setup_type:         orchResult.setup_type,
        setup_label:        orchResult.setup_label,
        total_score:        orchResult.total_score,
        confidence:         orchResult.confidence,
        score_breakdown:    agentOutputs.synthesis?.score_breakdown,
        entry_price:        orchResult.entry_price,
        stop_loss:          orchResult.stop_loss,
        take_profit_1:      orchResult.take_profit_1,
        take_profit_2:      orchResult.take_profit_2,
        rr_value:           orchResult.rr_value,
        session:            orchResult.session,
        trend_4h:           orchResult.trend_4h,
        structure_state:    agentOutputs.technical?.structure_state,
        fvg_detected:       agentOutputs.technical?.fvg_state?.detected,
        fvg_in_entry_zone:  agentOutputs.technical?.fvg_state?.inEntryZone,
        sweep_detected:     agentOutputs.technical?.liquidity_map?.swept,
        sweep_type:         agentOutputs.technical?.liquidity_map?.type,
        price_position:     agentOutputs.technical?.price_position,
        is_chase_entry:     agentOutputs.technical?.is_chase_entry,
        why_trade:     toArr(orchResult.why_trade),
        why_not_trade: toArr(orchResult.why_not_trade),
        invalidation_level: orchResult.invalidation,
        veto_summary:       toArr(orchResult.veto_summary),
        veto_passed:        !(orchResult.veto_result?.vetoed),
        event_risk_level:   orchResult.event_risk,
        macro_regime:       agentOutputs.macro?.regime_label,
        position_size:      orchResult.position_size,
        dollar_risk:        orchResult.dollar_risk,
        run_duration_ms:    orchResult.run_duration_ms,
        // Phase 1 columns (live in Supabase after schema upgrade)
        run_id:             orchResult.run_id             || null,
        verification_state: orchResult.verification_state || null,
        session_at_signal:  orchResult.session_at_signal  || null,
        error_count:        orchResult.error_count        ?? 0,
        agent_outputs:      orchResult.agent_outputs || null,
        // Additional confirmed columns
        agreement_summary:    agentOutputs.synthesis?.agreement_summary   || null,
        needed_confirmation:  orchResult.needed_confirmation               || null,
        provider_meta:        agentOutputs.technical?.provider_meta        || null,
        account_size:         orchResult.account_size                      || null,
        trend_1h:             agentOutputs.technical?.trend_1h             || orchResult.trend_1h || null,
        // v4.0 veto tracking columns (live after v4_schema_upgrade.sql)
        veto_flags:         toArr(orchResult.veto_result?.reasons?.map(r => r.id || r)),
        veto_count:         orchResult.veto_result?.vetoCount             ?? 0,
        veto_categories:    toArr(orchResult.veto_result?.reasons?.map(r => r.category).filter((v,i,a) => a.indexOf(v) === i)),
        gate_failures:      toArr(orchResult.failed_gates),
        setup_confidence:   orchResult.setup_confidence                   || null,
        score_breakdown:    agentOutputs.synthesis?.score_breakdown       || orchResult.score_breakdown || null
    };

    try {
        const saved = await supabaseInsert('signal_snapshots', record);
        const signalId = saved?.[0]?.id;

        // Save individual agent runs (non-blocking)
        if (signalId && agentOutputs) {
            saveAgentRuns(signalId, agentOutputs).catch(() => {});
        }

        // Try to flush any queued records
        flushQueue().catch(() => {});

        return { id: signalId, saved: true };
    } catch (e) {
        console.log(`[SignalStore] Save failed, queuing: ${e.message}`);
        enqueue('signal_snapshots', record);
        // Retry after 60s
        setTimeout(() => flushQueue().catch(() => {}), 60000);
        return { id: null, saved: false, queued: true };
    }
}

/**
 * saveAgentRuns(signalId, agentOutputs)
 */
async function saveAgentRuns(signalId, agentOutputs) {
    const agents = ['technical', 'macro', 'risk', 'synthesis'];
    for (const name of agents) {
        const out = agentOutputs[name];
        if (!out) continue;
        try {
            await supabaseInsert('agent_runs', {
                signal_id:      signalId,
                agent_name:     name,
                decision:       out.technical_decision || out.macro_decision || out.risk_decision || out.final_action,
                score:          out.technical_score || out.macro_score || out.risk_score || out.total_score,
                blockers:       out.blockers || [],
                output:         out,
                run_duration_ms: out.run_duration_ms
            });
        } catch(e) {
            console.log(`[SignalStore] Agent run save failed for ${name}: ${e.message}`);
        }
    }
}

/**
 * saveOutcome(signalId, outcome)
 * Called via /journal command when user reports a trade result.
 */
async function saveOutcome(signalId, outcome) {
    try {
        await supabaseInsert('tracked_signal_outcomes', { signal_id: signalId, ...outcome });
        return { saved: true };
    } catch (e) {
        enqueue('tracked_signal_outcomes', { signal_id: signalId, ...outcome });
        return { saved: false, queued: true };
    }
}

/**
 * getRecentSnapshots(limit) — for /stats command
 */
async function getRecentSnapshots(asset, limit = 20) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return [];
    try {
        const filter = asset ? `asset=eq.${asset}&` : '';
        const url = `${SUPABASE_URL}/rest/v1/signal_snapshots?${filter}order=created_at.desc&limit=${limit}`;
        const res = await fetch(url, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (!res.ok) return [];
        return await res.json();
    } catch(e) { return []; }
}

module.exports = { saveSignalSnapshot, saveOutcome, getRecentSnapshots, flushQueue };


