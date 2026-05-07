-- OpenClaw — Patch Migration: Add missing columns to signal_snapshots
-- Safe to run multiple times (uses IF NOT EXISTS checks)
-- Run in: https://supabase.com/dashboard/project/rsdujhhdzcghypkzjciz/sql/new

DO $$
BEGIN
    -- agreement_summary
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='agreement_summary') THEN
        ALTER TABLE signal_snapshots ADD COLUMN agreement_summary text;
        RAISE NOTICE 'Added: agreement_summary';
    ELSE RAISE NOTICE 'Exists: agreement_summary'; END IF;

    -- needed_confirmation
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='needed_confirmation') THEN
        ALTER TABLE signal_snapshots ADD COLUMN needed_confirmation text[];
        RAISE NOTICE 'Added: needed_confirmation';
    ELSE RAISE NOTICE 'Exists: needed_confirmation'; END IF;

    -- provider_meta
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='provider_meta') THEN
        ALTER TABLE signal_snapshots ADD COLUMN provider_meta jsonb;
        RAISE NOTICE 'Added: provider_meta';
    ELSE RAISE NOTICE 'Exists: provider_meta'; END IF;

    -- account_size
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='account_size') THEN
        ALTER TABLE signal_snapshots ADD COLUMN account_size numeric;
        RAISE NOTICE 'Added: account_size';
    ELSE RAISE NOTICE 'Exists: account_size'; END IF;

    -- trend_1h
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='signal_snapshots' AND column_name='trend_1h') THEN
        ALTER TABLE signal_snapshots ADD COLUMN trend_1h text;
        RAISE NOTICE 'Added: trend_1h';
    ELSE RAISE NOTICE 'Exists: trend_1h'; END IF;
END$$;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'signal_snapshots' 
ORDER BY ordinal_position;
