-- ============================================================
-- OpenClaw Terminal — Institutional Schema Migration
-- Run this in Supabase SQL Editor
-- Safe to run multiple times (uses IF NOT EXISTS)
-- ============================================================

-- ── 1. Signal Snapshots (full institutional signal record) ──────────────────
CREATE TABLE IF NOT EXISTS signal_snapshots (
    id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    asset               text NOT NULL,
    final_action        text NOT NULL CHECK (final_action IN ('BUY','SELL','WAIT','WATCHLIST','REJECTED','ERROR')),
    setup_type          text,
    setup_label         text,
    total_score         integer,
    confidence          integer,
    score_breakdown     jsonb,          -- { trend, liquidity, fvg, momentum, session, macro, risk }
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
    provider_meta       jsonb,          -- { source, fetchedAt, stale }
    run_duration_ms     integer,
    created_at          timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_asset       ON signal_snapshots (asset);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_action      ON signal_snapshots (final_action);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_setup       ON signal_snapshots (setup_type);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_created     ON signal_snapshots (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_session     ON signal_snapshots (session);

-- Enable Row Level Security (open for service role)
ALTER TABLE signal_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_role_all" ON signal_snapshots
    FOR ALL USING (auth.role() = 'service_role');

-- ── 2. Agent Runs (per-agent output for debugging/audit) ────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    signal_id       uuid REFERENCES signal_snapshots(id) ON DELETE CASCADE,
    agent_name      text NOT NULL,      -- 'technical' | 'macro' | 'risk' | 'synthesis'
    decision        text,
    score           integer,
    blockers        text[],
    output          jsonb,              -- full agent output
    conflicts       jsonb,
    run_duration_ms integer,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_signal   ON agent_runs (signal_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent    ON agent_runs (agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_runs_decision ON agent_runs (decision);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_role_all" ON agent_runs
    FOR ALL USING (auth.role() = 'service_role');

-- ── 3. Tracked Signal Outcomes (real trade results) ────────────────────────
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

ALTER TABLE tracked_signal_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_role_all" ON tracked_signal_outcomes
    FOR ALL USING (auth.role() = 'service_role');

-- ── 4. Trade Journal (weekly performance review) ────────────────────────────
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
CREATE POLICY IF NOT EXISTS "service_role_all" ON trade_journal
    FOR ALL USING (auth.role() = 'service_role');

-- ── 5. Provider Status (data freshness tracking) ───────────────────────────
CREATE TABLE IF NOT EXISTS provider_status (
    provider_name       text PRIMARY KEY,
    healthy             boolean DEFAULT true,
    last_success        timestamptz,
    last_failure        timestamptz,
    failure_count       integer DEFAULT 0,
    rate_limit_reset    timestamptz,
    updated_at          timestamptz DEFAULT now()
);

-- ── 6. Strategy Profiles (score weight configurations) ─────────────────────
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

-- Insert default profile
INSERT INTO strategy_profiles (name, description, active)
VALUES (
    'Institutional Default v1',
    'OpenClaw base configuration — 8-layer scoring, 15 hard vetoes, 5 setup families',
    true
) ON CONFLICT DO NOTHING;

-- ── 7. Weekly Learning Stats (outcome-driven weight updates) ────────────────
-- Add columns to existing learning_weights table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'learning_weights') THEN
        -- Add new columns if they don't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'learning_weights' AND column_name = 'setup_type_stats') THEN
            ALTER TABLE learning_weights ADD COLUMN setup_type_stats jsonb DEFAULT '{}';
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'learning_weights' AND column_name = 'session_stats') THEN
            ALTER TABLE learning_weights ADD COLUMN session_stats jsonb DEFAULT '{}';
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'learning_weights' AND column_name = 'weekly_review_at') THEN
            ALTER TABLE learning_weights ADD COLUMN weekly_review_at timestamptz;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'learning_weights' AND column_name = 'false_positive_count') THEN
            ALTER TABLE learning_weights ADD COLUMN false_positive_count integer DEFAULT 0;
        END IF;
    END IF;
END$$;

-- ── 8. Add setup_type to existing signals table if present ─────────────────
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'signals') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'signals' AND column_name = 'setup_type') THEN
            ALTER TABLE signals ADD COLUMN setup_type text;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'signals' AND column_name = 'veto_passed') THEN
            ALTER TABLE signals ADD COLUMN veto_passed boolean;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns
                       WHERE table_name = 'signals' AND column_name = 'institutional_score') THEN
            ALTER TABLE signals ADD COLUMN institutional_score integer;
        END IF;
    END IF;
END$$;

-- ── 9. Realtime subscriptions (enable for live dashboard) ──────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE signal_snapshots;
ALTER PUBLICATION supabase_realtime ADD TABLE tracked_signal_outcomes;

-- ── Verification ────────────────────────────────────────────────────────────
SELECT 
    tablename,
    (SELECT count(*) FROM information_schema.columns 
     WHERE table_name = tablename) as column_count
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN (
    'signal_snapshots', 'agent_runs', 'tracked_signal_outcomes',
    'trade_journal', 'provider_status', 'strategy_profiles'
  )
ORDER BY tablename;
