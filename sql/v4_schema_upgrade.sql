-- ═══════════════════════════════════════════════════════════════════════════════
-- OpenClaw v4.0 — Supabase Schema Upgrade
-- Run this in the Supabase SQL Editor to enable full veto tracking + outcomes
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Add veto tracking columns to signal_snapshots
ALTER TABLE signal_snapshots
  ADD COLUMN IF NOT EXISTS veto_flags      TEXT[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS veto_count      INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS veto_categories TEXT[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gate_failures   TEXT[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS setup_confidence TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB    DEFAULT NULL;

-- 2. Create outcome tracking table (if not exists)
CREATE TABLE IF NOT EXISTS signal_outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       UUID REFERENCES signal_snapshots(id) ON DELETE SET NULL,
  asset           TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('win','loss','scratch','cancelled')),
  actual_rr       NUMERIC(5,2) DEFAULT NULL,
  setup_type      TEXT DEFAULT NULL,
  session         TEXT DEFAULT NULL,
  notes           TEXT DEFAULT NULL,
  tracked_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create veto analytics view
CREATE OR REPLACE VIEW veto_analytics AS
SELECT
  date_trunc('day', created_at) AS day,
  COUNT(*) AS total_signals,
  COUNT(*) FILTER (WHERE final_action IN ('BUY','SELL')) AS passed,
  COUNT(*) FILTER (WHERE final_action IN ('WAIT','REJECTED')) AS blocked,
  ROUND(
    COUNT(*) FILTER (WHERE final_action IN ('WAIT','REJECTED'))::NUMERIC /
    NULLIF(COUNT(*), 0) * 100, 1
  ) AS filter_rate_pct,
  AVG(total_score) AS avg_score,
  array_agg(DISTINCT unnest_vf) FILTER (WHERE unnest_vf IS NOT NULL) AS unique_veto_flags
FROM signal_snapshots
LEFT JOIN LATERAL unnest(veto_flags) AS unnest_vf ON true
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

-- 4. Create setup performance view
CREATE OR REPLACE VIEW setup_performance AS
SELECT
  s.setup_type,
  COUNT(*) AS total_generated,
  COUNT(*) FILTER (WHERE s.final_action IN ('BUY','SELL')) AS total_executed,
  AVG(s.total_score) AS avg_score,
  COUNT(o.id) FILTER (WHERE o.outcome = 'win') AS wins,
  COUNT(o.id) FILTER (WHERE o.outcome = 'loss') AS losses,
  ROUND(
    COUNT(o.id) FILTER (WHERE o.outcome = 'win')::NUMERIC /
    NULLIF(COUNT(o.id) FILTER (WHERE o.outcome IN ('win','loss')), 0) * 100, 1
  ) AS win_rate_pct,
  AVG(o.actual_rr) FILTER (WHERE o.outcome = 'win') AS avg_win_rr,
  AVG(o.actual_rr) FILTER (WHERE o.outcome = 'loss') AS avg_loss_rr
FROM signal_snapshots s
LEFT JOIN signal_outcomes o ON o.signal_id = s.id
WHERE s.setup_type IS NOT NULL
GROUP BY s.setup_type
ORDER BY total_generated DESC;

-- 5. Create session performance view
CREATE OR REPLACE VIEW session_performance AS
SELECT
  s.session AS session_label,
  COUNT(*) AS total_signals,
  COUNT(*) FILTER (WHERE s.final_action IN ('BUY','SELL')) AS passed,
  AVG(s.total_score) AS avg_score,
  COUNT(o.id) FILTER (WHERE o.outcome = 'win') AS wins,
  COUNT(o.id) FILTER (WHERE o.outcome = 'loss') AS losses
FROM signal_snapshots s
LEFT JOIN signal_outcomes o ON o.signal_id = s.id
WHERE s.session IS NOT NULL
GROUP BY s.session
ORDER BY total_signals DESC;

-- 6. Index for faster veto queries
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_veto_flags
  ON signal_snapshots USING GIN (veto_flags);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_setup_type
  ON signal_snapshots (setup_type);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal_id
  ON signal_outcomes (signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_asset
  ON signal_outcomes (asset);

-- 7. RLS policies for signal_outcomes
ALTER TABLE signal_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service role full access" ON signal_outcomes
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE signal_outcomes IS 'Trade outcome tracking for learning engine — linked to signal_snapshots via signal_id';
COMMENT ON VIEW veto_analytics IS 'Daily veto statistics: filter rate, unique veto flags, pass/block counts';
COMMENT ON VIEW setup_performance IS 'Setup type win rates with R:R tracking from signal_outcomes';
