/**
 * snapshot_store.cjs — Normalized Snapshot Layer v5.1
 * Single source of truth for ALL data across Telegram + Dashboard.
 *
 * Every module writes snapshots here; every consumer reads from here.
 * Staleness is computed on read, not write.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Staleness Thresholds (seconds) ──────────────────────────────────────────
const THRESHOLDS = {
  MARKET:          60,
  SIGNAL:          300,
  INDICATOR:       300,
  MACRO:           900,
  NEWS:            600,
  FEARGREED:       3600,
  ANALYSIS:        3600,
  PROVIDER:        300,
  APIUSAGE:        60,
  HEALTH:          120,
  CANDLE:          60,
  CRYPTO_TRENDING: 300,
  CRYPTO_TOP:      180,
  STRATEGY_ROUTE:  120,
  VETO_STATS:      300,
  REPLAY_RESULT:   3600,
  BACKTEST_RESULT: 3600
};

// ── Valid Snapshot Types ────────────────────────────────────────────────────
const VALID_TYPES = [
  'MARKET', 'CANDLE', 'INDICATOR', 'SIGNAL', 'ANALYSIS', 'MACRO', 'NEWS',
  'FEARGREED', 'CRYPTO_TOP', 'CRYPTO_TRENDING', 'PROVIDER', 'APIUSAGE',
  'STRATEGY_ROUTE', 'VETO_STATS', 'HEALTH', 'BACKGROUND_REASONING',
  'WATCHLIST_ALERT', 'LEARNING_STATUS', 'REPLAY_RESULT', 'BACKTEST_RESULT',
  'CRITICAL_REASONING'
];

// ── Schema Validation ──────────────────────────────────────────────────────
const REQUIRED_FIELDS = ['id', 'run_id', 'type', 'created_at', 'payload'];

function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') return { valid: false, errors: ['Snapshot must be an object'] };
  for (const f of REQUIRED_FIELDS) {
    if (snapshot[f] === undefined || snapshot[f] === null) errors.push(`Missing required field: ${f}`);
  }
  if (snapshot.type && !VALID_TYPES.includes(snapshot.type)) errors.push(`Invalid snapshot type: ${snapshot.type}`);
  if (snapshot.payload !== undefined && typeof snapshot.payload !== 'object') errors.push('Payload must be an object');
  return { valid: errors.length === 0, errors };
}

// ── In-Memory Store ─────────────────────────────────────────────────────────
// Key format: `${type}:${symbol||'_GLOBAL'}:${timeframe||'_'}`
const _store = new Map();
const BACKUP_PATH = path.join(__dirname, '..', '..', 'data', 'snapshots.json');

// ── Helpers ─────────────────────────────────────────────────────────────────
function genRunId(type) {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(2).toString('hex');
  return `snap_${type.toLowerCase()}_${ts}_${rand}`;
}

function genId() {
  // UUID v4 without external deps
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function makeKey(type, symbol, timeframe) {
  return `${type}:${(symbol || '_GLOBAL').toUpperCase()}:${timeframe || '_'}`;
}

function computeStaleness(snapshot) {
  if (!snapshot || !snapshot.created_at) return snapshot;
  const age = (Date.now() - new Date(snapshot.created_at).getTime()) / 1000;
  const threshold = THRESHOLDS[snapshot.type] || 300;
  snapshot.cache_age_seconds = Math.round(age);
  snapshot.stale = age > threshold;
  snapshot.stale_level = age < threshold ? 'FRESH'
    : age < threshold * 2 ? 'WARN'
    : age < threshold * 5 ? 'STALE'
    : 'EXPIRED';
  snapshot.stale_threshold = threshold;
  return snapshot;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Write a snapshot to the store.
 * @param {string} type - MARKET|SIGNAL|INDICATOR|MACRO|NEWS|FEARGREED|ANALYSIS|PROVIDER|APIUSAGE|HEALTH
 * @param {string|null} symbol - e.g. 'XAUUSD' or null for global
 * @param {string|null} timeframe - e.g. '1H','4H','1D' or null
 * @param {object} payload - type-specific data
 * @param {object} opts - { provider, warnings, fallback_used, fallback_provider, source_timestamp }
 * @returns {object} the stored snapshot
 */
function put(type, symbol, timeframe, payload, opts = {}) {
  const now = new Date().toISOString();
  const key = makeKey(type, symbol, timeframe);
  
  const snapshot = {
    id: genId(),
    run_id: genRunId(type),
    type,
    symbol: symbol ? symbol.toUpperCase() : null,
    timeframe: timeframe || null,
    source_provider: opts.provider || 'unknown',
    source_timestamp: opts.source_timestamp || now,
    created_at: now,
    updated_at: now,
    cache_age_seconds: 0,
    stale: false,
    stale_level: 'FRESH',
    stale_threshold: THRESHOLDS[type] || 300,
    payload,
    warnings: opts.warnings || [],
    fallback_used: opts.fallback_used || false,
    fallback_provider: opts.fallback_provider || null
  };
  
  _store.set(key, snapshot);
  
  // Also store as latest-by-type for quick global queries
  const typeKey = `_LATEST:${type}:${(symbol || '_GLOBAL').toUpperCase()}`;
  _store.set(typeKey, key);
  
  return snapshot;
}

/**
 * Read the latest snapshot. Staleness computed on read.
 * @param {string} type
 * @param {string|null} symbol
 * @param {string|null} timeframe
 * @returns {object|null}
 */
function get(type, symbol, timeframe) {
  const key = makeKey(type, symbol, timeframe);
  const snap = _store.get(key);
  if (!snap) return null;
  const result = computeStaleness({ ...snap });
  result.data = result.payload; // alias for consumer convenience
  // Track cache hit in api_counter
  try { const { recordCall } = require('../../api_counter.cjs'); recordCall('snapshot_store', true, 0, { type: 'cache_hit', caller: 'snapshot_store' }); } catch {}
  return result;
}

/**
 * Get latest snapshot of a type for a symbol (any timeframe).
 * Falls back to global if no symbol-specific snapshot exists.
 */
function getLatest(type, symbol) {
  // Try symbol-specific first
  if (symbol) {
    const symKey = `_LATEST:${type}:${symbol.toUpperCase()}`;
    const actualKey = _store.get(symKey);
    if (actualKey) {
      const snap = _store.get(actualKey);
      if (snap) { const r = computeStaleness({ ...snap }); r.data = r.payload; return r; }
    }
  }
  // Fall back to global
  const globalKey = `_LATEST:${type}:_GLOBAL`;
  const actualKey = _store.get(globalKey);
  if (actualKey) {
    const snap = _store.get(actualKey);
    if (snap) { const r = computeStaleness({ ...snap }); r.data = r.payload; return r; }
  }
  return null;
}

/**
 * Get all snapshots of a given type.
 * @param {string} type
 * @returns {object[]}
 */
function getAll(type) {
  const results = [];
  for (const [key, snap] of _store) {
    if (key.startsWith('_LATEST:')) continue;
    if (snap.type === type) {
      const r = computeStaleness({ ...snap }); r.data = r.payload;
      results.push(r);
    }
  }
  return results;
}

/**
 * Get linked snapshots referenced by a signal/analysis snapshot.
 * @param {object} snapshot - must have payload with *_snapshot_id fields
 * @returns {object}
 */
function getLinked(snapshot) {
  const linked = {};
  if (!snapshot || !snapshot.payload) return linked;
  const p = snapshot.payload;
  if (p.indicator_snapshot_id) {
    for (const [k, s] of _store) {
      if (!k.startsWith('_LATEST:') && s.run_id === p.indicator_snapshot_id) {
        linked.indicator = computeStaleness({ ...s });
        break;
      }
    }
  }
  if (p.macro_snapshot_id) {
    for (const [k, s] of _store) {
      if (!k.startsWith('_LATEST:') && s.run_id === p.macro_snapshot_id) {
        linked.macro = computeStaleness({ ...s });
        break;
      }
    }
  }
  if (p.news_snapshot_id) {
    for (const [k, s] of _store) {
      if (!k.startsWith('_LATEST:') && s.run_id === p.news_snapshot_id) {
        linked.news = computeStaleness({ ...s });
        break;
      }
    }
  }
  return linked;
}

/**
 * Get sync health across all snapshot types.
 * @returns {object}
 */
function getSyncHealth() {
  const types = Object.keys(THRESHOLDS);
  const status = types.map(type => {
    const snap = getLatest(type);
    return {
      type,
      available: !!snap,
      stale: snap ? snap.stale : true,
      stale_level: snap ? snap.stale_level : 'EXPIRED',
      age: snap ? snap.cache_age_seconds : -1,
      run_id: snap ? snap.run_id : null
    };
  });
  return {
    sync_ok: status.filter(s => s.available).every(s => !s.stale),
    total_types: types.length,
    available: status.filter(s => s.available).length,
    stale: status.filter(s => s.stale).length,
    snapshots: status,
    server_time: new Date().toISOString()
  };
}

/**
 * Dump store stats.
 */
function stats() {
  let count = 0;
  for (const k of _store.keys()) {
    if (!k.startsWith('_LATEST:')) count++;
  }
  return { snapshots: count, types: Object.keys(THRESHOLDS).length, thresholds: { ...THRESHOLDS } };
}

/**
 * Save store to disk (JSON backup).
 */
function saveToDisk() {
  try {
    const data = {};
    for (const [k, v] of _store) {
      if (!k.startsWith('_LATEST:')) data[k] = v;
    }
    const dir = path.dirname(BACKUP_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('[SnapshotStore] Save failed:', e.message);
    return false;
  }
}

/**
 * Load store from disk (restore on startup).
 */
function loadFromDisk() {
  try {
    if (!fs.existsSync(BACKUP_PATH)) return 0;
    const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
    let loaded = 0;
    for (const [key, snap] of Object.entries(raw)) {
      _store.set(key, snap);
      // Rebuild latest pointers
      const typeKey = `_LATEST:${snap.type}:${(snap.symbol || '_GLOBAL').toUpperCase()}`;
      const existing = _store.get(typeKey);
      if (!existing || !_store.get(existing) || new Date(snap.created_at) > new Date(_store.get(existing).created_at)) {
        _store.set(typeKey, key);
      }
      loaded++;
    }
    console.log(`[SnapshotStore] Restored ${loaded} snapshots from disk`);
    return loaded;
  } catch (e) {
    console.error('[SnapshotStore] Load failed:', e.message);
    return 0;
  }
}

// Auto-load on require
loadFromDisk();

// Auto-save every 5 minutes
setInterval(() => saveToDisk(), 5 * 60 * 1000);

module.exports = {
  put, get, getLatest, getAll, getLinked,
  getSyncHealth, stats, saveToDisk, loadFromDisk,
  THRESHOLDS, VALID_TYPES, computeStaleness, validateSnapshot
};
