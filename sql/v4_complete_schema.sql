-- ═══════════════════════════════════════════════════════════════════════════════
-- OpenClaw v4.0 — COMPLETE Supabase Schema (Copy-Paste Ready)
-- 
-- SAFE TO RUN MULTIPLE TIMES — uses IF NOT EXISTS everywhere
-- Paste this ENTIRE block into Supabase SQL Editor and click RUN
-- 
-- What this does:
--   ✅ Creates all tables if they don't exist
--   ✅ Adds v4.0 veto tracking columns
--   ✅ Creates analytics views (veto, setup, session performance)
--   ✅ Adds all indexes
--   ✅ Enables RLS + realtime
--   ✅ Verifies everything at the end
-- ═══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════
-- 1. SIGNAL SNAPSHOTS (core signal record)
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS signal_snapshots (
    id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    asset               text NOT NULL,
    final_action        text NOT NULL CHECK (final_action IN ('BUY','SELL','WAIT','WATCHLIST','REJECTED','ERROR')),
    setup_type          text,
    setup_label         text,
    total_score         integer,
    confidence          integer,
    score_breakdown     jsonb,
    entry_price         numeric,
    stop_loss           numeric,
    take_profit_1       numeric,
    take_profit_2       numeric,
    rr_value            numeric,
    session             text,
    trend_4h            text,
    trend_1h            text,
    structure_state     text,
    fvg_detected        boolean,
    fvg_in_entry_zone   boolean,
    sweep_detected      boolean,
    sweep_type          text,
    price_position      text,
    is_chase_entry      boolean,
    why_trade           text[],
    why_not_trade       text[],
    invalidation_level  text,
    needed_confirmation text[],
    veto_summary        text[],
    veto_passed         boolean,
    agreement_summary   text,
    event_risk_level    text,
    macro_regime        text,
    position_size       numeric,
    dollar_risk         numeric,
    account_size        numeric,
    provider_meta       jsonb,
    run_duration_ms     integer,
    created_at          timestamptz DEFAULT now()
);

-- v4.0 columns — add if missing
DO $$
BEGIN
    -- run_id (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='run_id') THEN
        ALTER TABLE signal_snapshots ADD COLUMN run_id text;
        RAISE NOTICE 'Added: run_id';
    END IF;

    -- verification_state (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='verification_state') THEN
        ALTER TABLE signal_snapshots ADD COLUMN verification_state text;
        RAISE NOTICE 'Added: verification_state';
    END IF;

    -- session_at_signal (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='session_at_signal') THEN
        ALTER TABLE signal_snapshots ADD COLUMN session_at_signal text;
        RAISE NOTICE 'Added: session_at_signal';
    END IF;

    -- veto_result (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='veto_result') THEN
        ALTER TABLE signal_snapshots ADD COLUMN veto_result jsonb;
        RAISE NOTICE 'Added: veto_result';
    END IF;

    -- failed_gates (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='failed_gates') THEN
        ALTER TABLE signal_snapshots ADD COLUMN failed_gates text[];
        RAISE NOTICE 'Added: failed_gates';
    END IF;

    -- data_quality (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='data_quality') THEN
        ALTER TABLE signal_snapshots ADD COLUMN data_quality text;
        RAISE NOTICE 'Added: data_quality';
    END IF;

    -- price_source (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='price_source') THEN
        ALTER TABLE signal_snapshots ADD COLUMN price_source text;
        RAISE NOTICE 'Added: price_source';
    END IF;

    -- error_count (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='error_count') THEN
        ALTER TABLE signal_snapshots ADD COLUMN error_count integer DEFAULT 0;
        RAISE NOTICE 'Added: error_count';
    END IF;

    -- agent_outputs (Phase 1)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='agent_outputs') THEN
        ALTER TABLE signal_snapshots ADD COLUMN agent_outputs jsonb;
        RAISE NOTICE 'Added: agent_outputs';
    END IF;

    -- ═══ v4.0 VETO TRACKING COLUMNS ═══

    -- veto_flags — individual veto rule IDs that fired
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='veto_flags') THEN
        ALTER TABLE signal_snapshots ADD COLUMN veto_flags text[] DEFAULT '{}';
        RAISE NOTICE 'Added: veto_flags';
    END IF;

    -- veto_count — number of vetoes triggered
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='veto_count') THEN
        ALTER TABLE signal_snapshots ADD COLUMN veto_count integer DEFAULT 0;
        RAISE NOTICE 'Added: veto_count';
    END IF;

    -- veto_categories — unique categories (RISK, MOMENTUM, SESSION, etc.)
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='veto_categories') THEN
        ALTER TABLE signal_snapshots ADD COLUMN veto_categories text[] DEFAULT '{}';
        RAISE NOTICE 'Added: veto_categories';
    END IF;

    -- gate_failures — verification gates that failed
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='gate_failures') THEN
        -- gate_failures might already exist as failed_gates, skip if so
        NULL;
    END IF;

    -- setup_confidence — HIGH/MEDIUM/LOW from setup classifier
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='setup_confidence') THEN
        ALTER TABLE signal_snapshots ADD COLUMN setup_confidence text;
        RAISE NOTICE 'Added: setup_confidence';
    END IF;

END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_asset       ON signal_snapshots (asset);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_action      ON signal_snapshots (final_action);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_setup       ON signal_snapshots (setup_type);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_created     ON signal_snapshots (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_session     ON signal_snapshots (session);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_veto_flags  ON signal_snapshots USING GIN (veto_flags);

ALTER TABLE signal_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='signal_snapshots' AND policyname='service_role_all') THEN
        CREATE POLICY service_role_all ON signal_snapshots FOR ALL USING (true) WITH CHECK (true);
    END IF;
END$$;


-- ══════════════════════════════════════════════
-- 2. AGENT RUNS (per-agent audit trail)
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_runs (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    signal_id       uuid REFERENCES signal_snapshots(id) ON DELETE CASCADE,
    agent_name      text NOT NULL,
    decision        text,
    score           integer,
    blockers        text[],
    output          jsonb,
    conflicts       jsonb,
    run_duration_ms integer,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_signal   ON agent_runs (signal_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent    ON agent_runs (agent_name);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='agent_runs' AND policyname='service_role_all') THEN
        CREATE POLICY service_role_all ON agent_runs FOR ALL USING (true) WITH CHECK (true);
    END IF;
END$$;


-- ══════════════════════════════════════════════
-- 3. TRACKED SIGNAL OUTCOMES (trade results)
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tracked_signal_outcomes (
    id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    signal_id    uuid REFERENCES signal_snapshots(id) ON DELETE SET NULL,
    asset        text NOT NULL,
    setup_type   text,
    session      text,
    outcome      text NOT NULL CHECK (outcome IN ('win','loss','scratch','open','cancelled')),
    entry_price  numeric,
    exit_price   numeric,
    actual_rr    numeric,
    stop_hit     boolean DEFAULT false,
    tp1_hit      boolean DEFAULT false,
    tp2_hit      boolean DEFAULT false,
    notes        text,
    tracked_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outcomes_asset     ON tracked_signal_outcomes (asset);
CREATE INDEX IF NOT EXISTS idx_outcomes_setup     ON tracked_signal_outcomes (setup_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome   ON tracked_signal_outcomes (outcome);
CREATE INDEX IF NOT EXISTS idx_outcomes_tracked   ON tracked_signal_outcomes (tracked_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_signal    ON tracked_signal_outcomes (signal_id);

ALTER TABLE tracked_signal_outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='tracked_signal_outcomes' AND policyname='service_role_all') THEN
        CREATE POLICY service_role_all ON tracked_signal_outcomes FOR ALL USING (true) WITH CHECK (true);
    END IF;
END$$;


-- ══════════════════════════════════════════════
-- 4. TRADE JOURNAL
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS trade_journal (
    id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    asset        text,
    setup_type   text,
    session      text,
    direction    text,
    entry_price  numeric,
    exit_price   numeric,
    rr_actual    numeric,
    outcome      text,
    week_number  integer,
    year         integer,
    notes        text,
    created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_asset  ON trade_journal (asset);
CREATE INDEX IF NOT EXISTS idx_journal_week   ON trade_journal (week_number, year);
CREATE INDEX IF NOT EXISTS idx_journal_setup  ON trade_journal (setup_type);

ALTER TABLE trade_journal ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='trade_journal' AND policyname='service_role_all') THEN
        CREATE POLICY service_role_all ON trade_journal FOR ALL USING (true) WITH CHECK (true);
    END IF;
END$$;


-- ══════════════════════════════════════════════
-- 5. PROVIDER STATUS
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS provider_status (
    provider_name       text PRIMARY KEY,
    healthy             boolean DEFAULT true,
    last_success        timestamptz,
    last_failure        timestamptz,
    failure_count       integer DEFAULT 0,
    rate_limit_reset    timestamptz,
    updated_at          timestamptz DEFAULT now()
);


-- ══════════════════════════════════════════════
-- 6. STRATEGY PROFILES
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS strategy_profiles (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name            text NOT NULL,
    description     text,
    score_weights   jsonb NOT NULL DEFAULT '{
        "trend": 20, "liquidity": 20, "fvg": 20,
        "momentum": 10, "session": 10, "macro": 10, "risk": 10
    }',
    veto_overrides  jsonb DEFAULT '{}',
    active          boolean DEFAULT false,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

INSERT INTO strategy_profiles (name, description, active)
VALUES (
    'Institutional Default v4.0',
    'OpenClaw v4.0 — 100pt scoring, 20 hard vetoes, 5 setup families',
    true
) ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════
-- 7. v4.0 ANALYTICS VIEWS
-- ══════════════════════════════════════════════

-- Setup Performance (win rates by setup type)
CREATE OR REPLACE VIEW setup_performance AS
SELECT
    s.setup_type,
    COUNT(*) AS total_generated,
    COUNT(*) FILTER (WHERE s.final_action IN ('BUY','SELL')) AS total_executed,
    ROUND(AVG(s.total_score), 1) AS avg_score,
    COUNT(o.id) FILTER (WHERE o.outcome = 'win') AS wins,
    COUNT(o.id) FILTER (WHERE o.outcome = 'loss') AS losses,
    ROUND(
        COUNT(o.id) FILTER (WHERE o.outcome = 'win')::NUMERIC /
        NULLIF(COUNT(o.id) FILTER (WHERE o.outcome IN ('win','loss')), 0) * 100, 1
    ) AS win_rate_pct,
    ROUND(AVG(o.actual_rr) FILTER (WHERE o.outcome = 'win'), 2) AS avg_win_rr,
    ROUND(AVG(o.actual_rr) FILTER (WHERE o.outcome = 'loss'), 2) AS avg_loss_rr
FROM signal_snapshots s
LEFT JOIN tracked_signal_outcomes o ON o.signal_id = s.id
WHERE s.setup_type IS NOT NULL
GROUP BY s.setup_type
ORDER BY total_generated DESC;

-- Session Performance
CREATE OR REPLACE VIEW session_performance AS
SELECT
    s.session AS session_label,
    COUNT(*) AS total_signals,
    COUNT(*) FILTER (WHERE s.final_action IN ('BUY','SELL')) AS passed,
    ROUND(
        COUNT(*) FILTER (WHERE s.final_action IN ('BUY','SELL'))::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 1
    ) AS pass_rate_pct,
    ROUND(AVG(s.total_score), 1) AS avg_score,
    COUNT(o.id) FILTER (WHERE o.outcome = 'win') AS wins,
    COUNT(o.id) FILTER (WHERE o.outcome = 'loss') AS losses
FROM signal_snapshots s
LEFT JOIN tracked_signal_outcomes o ON o.signal_id = s.id
WHERE s.session IS NOT NULL
GROUP BY s.session
ORDER BY total_signals DESC;

-- Daily Veto Analytics
CREATE OR REPLACE VIEW veto_analytics AS
SELECT
    date_trunc('day', created_at)::date AS day,
    COUNT(*) AS total_signals,
    COUNT(*) FILTER (WHERE final_action IN ('BUY','SELL')) AS passed,
    COUNT(*) FILTER (WHERE final_action IN ('WAIT','REJECTED')) AS blocked,
    ROUND(
        COUNT(*) FILTER (WHERE final_action IN ('WAIT','REJECTED'))::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 1
    ) AS filter_rate_pct,
    ROUND(AVG(total_score), 1) AS avg_score,
    AVG(veto_count) AS avg_veto_count
FROM signal_snapshots
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

-- Asset Performance
CREATE OR REPLACE VIEW asset_performance AS
SELECT
    s.asset,
    COUNT(*) AS total_signals,
    COUNT(*) FILTER (WHERE s.final_action IN ('BUY','SELL')) AS executed,
    ROUND(AVG(s.total_score), 1) AS avg_score,
    ROUND(AVG(s.rr_value), 2) AS avg_modelled_rr,
    COUNT(o.id) FILTER (WHERE o.outcome = 'win') AS wins,
    COUNT(o.id) FILTER (WHERE o.outcome = 'loss') AS losses,
    ROUND(
        COUNT(o.id) FILTER (WHERE o.outcome = 'win')::NUMERIC /
        NULLIF(COUNT(o.id) FILTER (WHERE o.outcome IN ('win','loss')), 0) * 100, 1
    ) AS win_rate_pct
FROM signal_snapshots s
LEFT JOIN tracked_signal_outcomes o ON o.signal_id = s.id
GROUP BY s.asset
ORDER BY total_signals DESC;


-- ══════════════════════════════════════════════
-- 8. ENABLE REALTIME
-- ══════════════════════════════════════════════
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE signal_snapshots;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tracked_signal_outcomes;
EXCEPTION WHEN OTHERS THEN NULL;
END$$;


-- ══════════════════════════════════════════════
-- 9. VERIFICATION — Shows all tables + column counts
-- ══════════════════════════════════════════════
SELECT '✅ SCHEMA VERIFICATION' AS status;

SELECT 
    t.tablename AS table_name,
    (SELECT count(*) FROM information_schema.columns c 
     WHERE c.table_name = t.tablename AND c.table_schema = 'public') AS columns
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'signal_snapshots', 'agent_runs', 'tracked_signal_outcomes',
    'trade_journal', 'provider_status', 'strategy_profiles'
  )
ORDER BY t.tablename;

-- Show v4.0 columns specifically
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'signal_snapshots' 
  AND column_name IN ('veto_flags','veto_count','veto_categories','setup_confidence','score_breakdown','failed_gates')
ORDER BY column_name;

SELECT '🏆 OpenClaw v4.0 Schema Complete' AS result;
