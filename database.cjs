/**
 * database.cjs — Hedge-fund grade news + signal database (JSON file store)
 * Stores: headlines, signals, Rwanda intelligence, performance tracking
 */

const fs   = require('fs');
const path = require('path');

const DB_DIR  = path.join(__dirname, 'data');
const HEADLINE_DB  = path.join(DB_DIR, 'headlines.json');
const SIGNAL_DB    = path.join(DB_DIR, 'signals.json');
const RWANDA_DB    = path.join(DB_DIR, 'rwanda.json');
const PERF_DB      = path.join(DB_DIR, 'performance.json');
const KNOWLEDGE_DB = path.join(DB_DIR, 'openclaw_knowledge.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function load(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch(e) { return []; }
}

function save(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── Formatting Shims ────────────────────────────────────────────────────────
function formatNewsForTelegram(news, asset = 'all', limit = 5) {
    const articles = news[asset] || (Array.isArray(news) ? news : news.all) || [];
    if (!articles.length) return '📰 No recent news found.';
    const lines = articles.slice(0, limit).map((a, i) => {
        const diff = Math.floor((Date.now() - new Date(a.publishedAt || a.time || a.savedAt)) / 60000);
        const ago = diff < 60 ? `${diff}m ago` : diff < 1440 ? `${Math.floor(diff / 60)}h ago` : `${Math.floor(diff / 1440)}d ago`;
        const title = a.title.length > 80 ? a.title.substring(0, 79) + '…' : a.title;
        return `${i + 1}. *${title}*\n   _${a.source} · ${ago}_`;
    });
    return lines.join('\n\n');
}

// ─── Headlines ────────────────────────────────────────────────────────────────
function saveHeadline(headline) {
    const db = load(HEADLINE_DB);
    // Deduplicate by title similarity (first 60 chars)
    const key = headline.title.substring(0, 60).toLowerCase();
    const exists = db.some(h => h.title.substring(0, 60).toLowerCase() === key);
    if (exists) return false;
    db.unshift({ ...headline, id: Date.now().toString(), savedAt: new Date().toISOString() });
    // Keep last 2000
    save(HEADLINE_DB, db.slice(0, 2000));
    return true;
}

function getHeadlines(hours = 24, source = null) {
    const db    = load(HEADLINE_DB);
    const since = Date.now() - hours * 3600000;
    return db.filter(h => {
        const ts = new Date(h.publishedAt || h.savedAt).getTime();
        return ts > since && (!source || h.source === source);
    });
}

function getRecentHeadlines(limit = 50) {
    return load(HEADLINE_DB).slice(0, limit);
}

// ─── Signals ──────────────────────────────────────────────────────────────────
function saveSignal(signal) {
    const db = load(SIGNAL_DB);
    // Deduplicate: no same asset+direction within 6h
    const sixHAgo = Date.now() - 6 * 3600000;
    const dup = db.find(s =>
        s.asset === signal.asset &&
        s.direction === signal.direction &&
        new Date(s.createdAt).getTime() > sixHAgo
    );
    if (dup) return false;
    db.unshift({ ...signal, id: Date.now().toString(), createdAt: new Date().toISOString(), result: null });
    save(SIGNAL_DB, db.slice(0, 500));
    return true;
}

function getSignals(limit = 20, status = null) {
    const db = load(SIGNAL_DB);
    return db.filter(s => !status || s.status === status).slice(0, limit);
}

function updateSignalResult(id, result) {
    const db = load(SIGNAL_DB);
    const s  = db.find(x => x.id === id);
    if (s) { s.result = result; s.closedAt = new Date().toISOString(); }
    save(SIGNAL_DB, db);
}

// ─── Rwanda Intelligence ──────────────────────────────────────────────────────
function saveRwandaIntel(item) {
    const db = load(RWANDA_DB);
    const key = item.title.substring(0, 60).toLowerCase();
    if (db.some(h => h.title.substring(0, 60).toLowerCase() === key)) return false;
    db.unshift({ ...item, id: Date.now().toString(), savedAt: new Date().toISOString() });
    save(RWANDA_DB, db.slice(0, 500));
    return true;
}

function getRwandaIntel(limit = 30) {
    const { isStrictRwanda } = require('./news_collector.cjs');
    return load(RWANDA_DB)
        .filter(h => isStrictRwanda(h.title + ' ' + (h.description || '')))
        .slice(0, limit);
}

// ─── Performance ──────────────────────────────────────────────────────────────
function getPerformance() {
    try { return JSON.parse(fs.readFileSync(PERF_DB, 'utf8')); }
    catch(e) { return { totalSignals: 0, sentToTelegram: 0, watchlist: 0, byAsset: {}, bySource: {}, winRate: null }; }
}

function recordSignalSent(asset, source) {
    const p = getPerformance();
    p.totalSignals++;
    p.sentToTelegram++;
    p.byAsset[asset]   = (p.byAsset[asset] || 0) + 1;
    p.bySource[source] = (p.bySource[source] || 0) + 1;
    p.lastSignalAt = new Date().toISOString();
    fs.writeFileSync(PERF_DB, JSON.stringify(p, null, 2));
}

// ─── Knowledge & Learning Base ───────────────────────────────────────────────
function saveKnowledgeRule(ruleText) {
    const db = load(KNOWLEDGE_DB);
    if (!db.some(r => r.rule === ruleText)) {
        db.push({ rule: ruleText, addedAt: new Date().toISOString() });
        save(KNOWLEDGE_DB, db);
    }
}

function getKnowledgeRules() {
    return load(KNOWLEDGE_DB);
}

function updateSignalWinRate(asset, isWin) {
    const p = getPerformance();
    if (!p.assetWinRates) p.assetWinRates = {};
    if (!p.assetWinRates[asset]) p.assetWinRates[asset] = { wins: 0, losses: 0 };
    
    if (isWin) p.assetWinRates[asset].wins++;
    else p.assetWinRates[asset].losses++;
    
    save(PERF_DB, p);
}

function getAssetWinRate(asset) {
    const p = getPerformance();
    const stats = p.assetWinRates?.[asset];
    if (!stats || (stats.wins + stats.losses) === 0) return 0.5; // Default neutral 50%
    return stats.wins / (stats.wins + stats.losses);
}

module.exports = {
    saveHeadline, getHeadlines, getRecentHeadlines, formatNewsForTelegram,
    saveSignal, getSignals, updateSignalResult,
    saveRwandaIntel, getRwandaIntel,
    getPerformance, recordSignalSent,
    saveKnowledgeRule, getKnowledgeRules, updateSignalWinRate, getAssetWinRate
};
