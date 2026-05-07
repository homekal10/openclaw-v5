/**
 * feature_flags.cjs — OpenClaw Feature Flag Management v3.0
 * Controls which features are enabled/disabled system-wide.
 */
'use strict';

const FLAGS = {
  // Data Layer
  snapshot_store:         { enabled: true,  label: 'Snapshot Store',          category: 'data',     description: 'Normalized snapshot layer for all data' },
  stale_badges:           { enabled: true,  label: 'Stale Badges',           category: 'frontend', description: 'Show freshness badges on all panels' },
  sync_health:            { enabled: true,  label: 'Sync Health Monitor',    category: 'system',   description: 'Monitor frontend/backend data sync' },

  // Signal Pipeline
  signal_verifier:        { enabled: true,  label: 'Signal Verifier',        category: 'signals',  description: 'Multi-gate verification before BUY/SELL' },
  veto_engine:            { enabled: true,  label: 'Veto Engine',            category: 'signals',  description: 'Hard veto rules (RR, ADX, stale, etc.)' },
  news_classification:    { enabled: true,  label: 'News Classification',    category: 'signals',  description: '5-tier headline classification filter' },
  grounding_validation:   { enabled: true,  label: 'Grounding Validation',   category: 'ai',       description: 'Validate AI output against snapshots' },

  // AI
  ai_analysis:            { enabled: true,  label: 'AI Multi-Agent Analysis', category: 'ai',      description: 'Gemini-powered trade analysis' },
  hallucination_guard:    { enabled: true,  label: 'Hallucination Guard',     category: 'ai',      description: 'Block AI output with ungrounded claims' },

  // Dashboard
  dashboard_charts:       { enabled: true,  label: 'Dashboard Charts',       category: 'frontend', description: 'Candlestick chart viewer' },
  dashboard_crypto:       { enabled: true,  label: 'Crypto Dashboard',       category: 'frontend', description: 'Trending coins, top coins panels' },
  dashboard_journal:      { enabled: true,  label: 'Trade Journal',          category: 'frontend', description: 'Signal tracking journal' },

  // Providers
  paid_providers:         { enabled: false, label: 'Paid Providers',         category: 'providers', description: 'Enable paid data providers' },

  // Supabase
  supabase_push:          { enabled: true,  label: 'Supabase Push',          category: 'data',     description: 'Push signals/news to Supabase' },
  supabase_read:          { enabled: false, label: 'Supabase Read',          category: 'data',     description: 'Read data from Supabase for dashboard' },

  // Scheduler
  realtime_scanner:       { enabled: true,  label: 'Realtime Scanner',       category: 'signals',  description: '15min automated signal scan' },
  daily_report:           { enabled: true,  label: 'Daily Report',           category: 'signals',  description: 'Daily intelligence summary' }
};

function isEnabled(flag) {
  const f = FLAGS[flag];
  if (!f) return false;
  // Environment override: OPENCLAW_FLAG_SNAPSHOT_STORE=true
  const envKey = 'OPENCLAW_FLAG_' + flag.toUpperCase();
  if (process.env[envKey] !== undefined) {
    return process.env[envKey] === 'true' || process.env[envKey] === '1';
  }
  return f.enabled;
}

function getAll() {
  return Object.entries(FLAGS).map(([key, f]) => ({
    key,
    ...f,
    enabled: isEnabled(key)
  }));
}

function getByCategory(category) {
  return getAll().filter(f => f.category === category);
}

function setFlag(key, enabled) {
  if (FLAGS[key]) FLAGS[key].enabled = enabled;
}

module.exports = { isEnabled, getAll, getByCategory, setFlag, FLAGS };
