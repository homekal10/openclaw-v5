-- ============================================================
-- SUPABASE_SCHEMA_UPGRADE.sql  (Phase 1-3 Complete Edition)
-- OpenClaw Institutional Intelligence Terminal
-- Run this entire file in Supabase SQL Editor → Run
-- ============================================================

-- 1. system_errors
CREATE TABLE IF NOT EXISTS system_errors (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           TEXT,
    error_class      TEXT        NOT NULL,
    stage            TEXT,
    asset            TEXT,
    command          TEXT,
    provider         TEXT,
    severity         TEXT        DEFAULT 'MEDIUM',
    retryable        BOOLEAN     DEFAULT TRUE,
    fallback_used    BOOLEAN     DEFAULT FALSE,
    user_visible     BOOLEAN     DEFAULT FALSE,
    human_summary    TEXT,
    technical_detail TEXT,
    resolution_hint  TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 2. run_logs
CREATE TABLE IF NOT EXISTS run_logs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      TEXT        NOT NULL,
    asset       TEXT,
    command     TEXT,
    stage       TEXT,
    status      TEXT        DEFAULT 'running',
    error_count INTEGER     DEFAULT 0,
    duration_ms INTEGER,
    meta        JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs (run_id);

-- 3. provider_health_events
CREATE TABLE IF NOT EXISTS provider_health_events (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider   TEXT        NOT NULL,
    event      TEXT        NOT NULL,
    latency_ms INTEGER,
    error_msg  TEXT,
    tier       TEXT        DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phe_provider ON provider_health_events (provider);

-- 4. fallback_events
CREATE TABLE IF NOT EXISTS fallback_events (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id         TEXT,
    asset          TEXT,
    stage          TEXT,
    primary_failed TEXT,
    fallback_used  TEXT,
    latency_ms     INTEGER,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 5. scheduler_runs
CREATE TABLE IF NOT EXISTS scheduler_runs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name    TEXT        NOT NULL,
    run_id      TEXT,
    status      TEXT        DEFAULT 'success',
    duration_ms INTEGER,
    records_out INTEGER     DEFAULT 0,
    error_msg   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduler_runs_job ON scheduler_runs (job_name);

-- 6. learning_recommendations
CREATE TABLE IF NOT EXISTS learning_recommendations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    week_ending     DATE,
    recommendation  TEXT,
    category        TEXT,
    proposed_change JSONB,
    applied         BOOLEAN     DEFAULT FALSE,
    applied_at      TIMESTAMPTZ,
    sample_size     INTEGER,
    confidence      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 7. agent_runs
CREATE TABLE IF NOT EXISTS agent_runs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      TEXT,
    asset       TEXT,
    agent_name  TEXT        NOT NULL,
    decision    TEXT,
    score       INTEGER,
    duration_ms INTEGER,
    meta        JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_run_id ON agent_runs (run_id);

-- 8. signal_verifications
CREATE TABLE IF NOT EXISTS signal_verifications (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id             TEXT,
    asset              TEXT,
    verification_state TEXT,
    gates_passed       INTEGER,
    gates_total        INTEGER,
    failed_gates       JSONB,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Add Phase 1 columns to signal_snapshots (safe: IF NOT EXISTS)
-- ============================================================

ALTER TABLE signal_snapshots
    ADD COLUMN IF NOT EXISTS run_id             TEXT,
    ADD COLUMN IF NOT EXISTS verification_state TEXT,
    ADD COLUMN IF NOT EXISTS setup_type         TEXT,
    ADD COLUMN IF NOT EXISTS session_at_signal  TEXT,
    ADD COLUMN IF NOT EXISTS veto_summary       TEXT,
    ADD COLUMN IF NOT EXISTS error_count        INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS run_duration_ms    INTEGER,
    ADD COLUMN IF NOT EXISTS agent_outputs      JSONB,
    ADD COLUMN IF NOT EXISTS failed_gates       JSONB,
    ADD COLUMN IF NOT EXISTS provider_meta      JSONB;

CREATE INDEX IF NOT EXISTS idx_snapshots_run_id ON signal_snapshots (run_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_verification ON signal_snapshots (verification_state);

-- ============================================================
-- Verify: this query should return all column names
-- ============================================================
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'signal_snapshots'
ORDER BY ordinal_position;
