-- ============================================================
-- OpenClaw v4.0 — Supabase Schema Patch
-- Run this against your Supabase SQL Editor
-- SAFE: Uses IF NOT EXISTS — won't break existing tables
-- ============================================================

-- ── Schema Version Tracking ──────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations_status (
    id SERIAL PRIMARY KEY,
    version TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    description TEXT
);

INSERT INTO schema_migrations_status (version, description)
SELECT 'v4.0.0', 'OpenClaw v4.0 institutional upgrade'
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations_status WHERE version = 'v4.0.0');

-- ── System Errors ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_errors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    stage TEXT,
    asset TEXT,
    command TEXT,
    provider TEXT,
    severity TEXT DEFAULT 'WARN',
    retryable BOOLEAN DEFAULT false,
    fallback_used BOOLEAN DEFAULT false,
    user_visible BOOLEAN DEFAULT false,
    human_summary TEXT,
    technical_detail TEXT,
    stack_trace TEXT,
    resolution_hint TEXT,
    error_class TEXT
);

-- ── Run Logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS run_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id TEXT NOT NULL,
    command TEXT,
    asset TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    stages JSONB DEFAULT '[]'::jsonb,
    providers_used JSONB DEFAULT '[]'::jsonb,
    fallbacks_used JSONB DEFAULT '[]'::jsonb,
    errors JSONB DEFAULT '[]'::jsonb,
    model_used TEXT,
    result TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Provider Health Events ───────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_health_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    healthy BOOLEAN DEFAULT true,
    response_time_ms INTEGER,
    error_message TEXT,
    fallback_triggered BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Fallback Events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fallback_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id TEXT,
    from_provider TEXT,
    to_provider TEXT,
    reason TEXT,
    asset TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scheduler Runs ───────────────────────────────────────────
-- (May already exist from v3.0 — safe to re-create)
CREATE TABLE IF NOT EXISTS scheduler_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_name TEXT NOT NULL,
    run_id TEXT,
    status TEXT DEFAULT 'success',
    duration_ms INTEGER,
    records_out INTEGER DEFAULT 0,
    error_msg TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── API Usage Snapshots ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_usage_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL,
    tier TEXT DEFAULT 'free',
    calls_today INTEGER DEFAULT 0,
    calls_month INTEGER DEFAULT 0,
    daily_limit INTEGER,
    monthly_limit INTEGER,
    predicted_exhaustion TIMESTAMPTZ,
    throttled BOOLEAN DEFAULT false,
    snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Signal Verifications ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_verifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id TEXT,
    symbol TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    setup_type TEXT,
    score INTEGER,
    confidence INTEGER,
    gates_passed JSONB DEFAULT '[]'::jsonb,
    gates_failed JSONB DEFAULT '[]'::jsonb,
    vetoes JSONB DEFAULT '[]'::jsonb,
    final_action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Learning Recommendations ─────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_recommendations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    review_period TEXT,
    setup_type TEXT,
    metric TEXT,
    current_value NUMERIC,
    recommended_value NUMERIC,
    adjustment NUMERIC,
    reason TEXT,
    applied BOOLEAN DEFAULT false,
    applied_by TEXT,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Feature Flags ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
    id SERIAL PRIMARY KEY,
    flag_name TEXT UNIQUE NOT NULL,
    enabled BOOLEAN DEFAULT false,
    description TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Paid Provider Configs ────────────────────────────────────
CREATE TABLE IF NOT EXISTS paid_provider_placeholders (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    category TEXT,
    tier TEXT DEFAULT 'paid_placeholder',
    enabled BOOLEAN DEFAULT false,
    api_key_env TEXT,
    setup_notes TEXT,
    last_activated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Patch: Add optional columns to existing tables ───────────
-- signal_snapshots
DO $$ BEGIN
    ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS agreement_summary TEXT;
    ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS needed_confirmation TEXT;
    ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS provider_meta JSONB;
    ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS trend_1h TEXT;
    ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS run_id TEXT;
    ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS verification_status TEXT;
    ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS relevance_score INTEGER;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- agent_runs
DO $$ BEGIN
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS run_id TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model_used TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS fallback_depth INTEGER DEFAULT 0;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- trade_journal
DO $$ BEGIN
    ALTER TABLE trade_journal ADD COLUMN IF NOT EXISTS setup_type TEXT;
    ALTER TABLE trade_journal ADD COLUMN IF NOT EXISTS session TEXT;
    ALTER TABLE trade_journal ADD COLUMN IF NOT EXISTS veto_overridden BOOLEAN DEFAULT false;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── Indexes for query performance ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_system_errors_run_id ON system_errors(run_id);
CREATE INDEX IF NOT EXISTS idx_system_errors_created ON system_errors(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_run_logs_asset ON run_logs(asset);
CREATE INDEX IF NOT EXISTS idx_provider_health_provider ON provider_health_events(provider);
CREATE INDEX IF NOT EXISTS idx_scheduler_runs_job ON scheduler_runs(job_name);
CREATE INDEX IF NOT EXISTS idx_signal_verifications_symbol ON signal_verifications(symbol);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON api_usage_snapshots(provider);

-- ============================================================
-- Schema patch complete. Verify with:
--   SELECT version, applied_at FROM schema_migrations_status ORDER BY applied_at DESC LIMIT 5;
-- ============================================================
