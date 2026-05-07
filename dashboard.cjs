/**
 * dashboard.cjs — Live Bloomberg-style trading intelligence dashboard
 * Express web server showing: news feed, Rwanda intel, signals, performance
 */

const express  = require('express');
const path     = require('path');
const { getRecentHeadlines, getSignals, getRwandaIntel, getPerformance } = require('./database.cjs');
const snapStore = require('./lib/snapshots/snapshot_store.cjs');

const app  = express();
const PORT = process.env.DASHBOARD_PORT || 3737;

// ── CORS: Allow Netlify frontend + any local clients ─────────────────────────
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ── v3.4 Security Headers ────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.header('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data:; img-src * data:; font-src * data:;");
    next();
});

// ── Health Check (Render / monitoring) ───────────────────────────────────────
app.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        version: 'v5.1.0',
        codename: 'Institutional Alpha',
        memory_mb: Math.round(mem.heapUsed / 1024 / 1024),
        timestamp: new Date().toISOString()
    });
});

// ── v3.4 Symbol Sanitizer ────────────────────────────────────────────────────
function sanitizeSymbol(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.toUpperCase().replace(/[^A-Z0-9_/.-]/g, '').substring(0, 20);
}

// ── In-memory analysis cache for dashboard display ───────────────────────────
const _analysisCache = [];
const _analysisCacheTTL = new Map(); // symbol → { result, timestamp }
const ANALYSIS_CACHE_TTL_MS = 30000; // 30s per-symbol dedup

function storeAnalysis(ticker, result) {
    _analysisCache.unshift({ ticker, result, timestamp: new Date().toISOString() });
    if (_analysisCache.length > 15) _analysisCache.length = 15;
    // Per-symbol cache for rapid re-queries
    _analysisCacheTTL.set(ticker?.toUpperCase(), { result, timestamp: Date.now() });
}
function getRecentAnalyses(n = 10) { return _analysisCache.slice(0, n); }

/**
 * Get cached analysis for a symbol if it's within the TTL window.
 * Returns null if no cache hit or cache expired.
 */
function getCachedAnalysis(symbol) {
    const key = symbol?.toUpperCase();
    if (!key) return null;
    const entry = _analysisCacheTTL.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ANALYSIS_CACHE_TTL_MS) {
        _analysisCacheTTL.delete(key);
        return null;
    }
    return entry.result;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenClaw — Bloomberg Intelligence Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#090e1a;--bg2:#0d1421;--bg3:#111827;
    --border:#1e2d45;--accent:#00c3ff;--green:#00d264;
    --red:#ff4545;--gold:#f0a500;--purple:#9d4edd;
    --text:#e2e8f0;--muted:#64748b;
  }
  [data-theme="light"]{
    --bg:#f0f2f5;--bg2:#ffffff;--bg3:#e8ecf1;
    --border:#d1d9e6;--accent:#0077cc;--green:#16a34a;
    --red:#dc2626;--gold:#d97706;--purple:#7c3aed;
    --text:#1e293b;--muted:#64748b;
  }
  [data-theme="light"] header{background:linear-gradient(135deg,#e2e8f0 0%,#cbd5e1 100%)}
  [data-theme="light"] header h1{background:linear-gradient(90deg,var(--accent),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  [data-theme="light"] .badge{background:#e2e8f0;border-color:var(--accent);color:var(--accent)}
  [data-theme="light"] .session-bar{background:#e8ecf1}
  [data-theme="light"] .ticker-bar{background:#f8fafc}
  [data-theme="light"] .signal-ticker{background:#f8fafc}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh}
  header{background:linear-gradient(135deg,#0a1628 0%,#0d1f3c 100%);border-bottom:1px solid var(--border);padding:18px 28px;display:flex;align-items:center;gap:16px}
  header h1{font-size:22px;font-weight:700;background:linear-gradient(90deg,var(--accent),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .badge{background:#1a2840;border:1px solid var(--accent);color:var(--accent);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .live-dot{width:8px;height:8px;background:var(--green);border-radius:50%;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:20px;max-width:1600px;margin:0 auto}
  .panel{background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden}
  .panel-header{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .panel-title{font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px}
  .panel-body{padding:0;max-height:420px;overflow-y:auto}
  .panel-body::-webkit-scrollbar{width:4px}
  .panel-body::-webkit-scrollbar-track{background:var(--bg)}
  .panel-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
  .news-item{padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s}
  .news-item:hover{background:var(--bg3)}
  .news-item:last-child{border-bottom:none}
  .news-title{font-size:12.5px;font-weight:500;line-height:1.4;margin-bottom:5px}
  .news-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .tag{padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600}
  .tag-source{background:#1a2840;color:var(--accent)}
  .tag-rwanda{background:#1a2d1a;color:var(--green)}
  .tag-crypto{background:#1a1a2d;color:var(--purple)}
  .tag-global{background:#1e1e1e;color:var(--muted)}
  /* ── Institutional Signal States ── */
  .signal-item{padding:14px 16px;border-bottom:1px solid var(--border);transition:background .15s}
  .signal-item:last-child{border-bottom:none}
  .signal-item.state-wait{border-left:3px solid var(--gold);opacity:.85}
  .signal-item.state-watchlist{border-left:3px solid var(--accent)}
  .signal-item.state-rejected{border-left:3px solid #444;opacity:.55}
  .signal-item.state-buy{border-left:3px solid var(--green)}
  .signal-item.state-sell{border-left:3px solid var(--red)}
  .signal-header{display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap}
  .signal-asset{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600}
  .dir-buy{color:var(--green);font-weight:700}
  .dir-sell{color:var(--red);font-weight:700}
  .dir-wait{color:var(--gold);font-weight:700}
  .dir-watchlist{color:var(--accent);font-weight:700}
  .dir-rejected{color:var(--muted);font-weight:600}
  .setup-badge{background:#0d1f3c;border:1px solid #1e3a5f;color:var(--accent);padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;letter-spacing:.5px}
  .signal-reason{font-size:11.5px;color:var(--text);line-height:1.4}
  .veto-note{font-size:10.5px;color:var(--red);margin-top:4px;font-style:italic}
  /* Score decomposition */
  .score-bars{margin-top:8px}
  .score-row{display:flex;align-items:center;gap:6px;margin-bottom:3px}
  .score-label{font-size:9px;color:var(--muted);width:44px;text-align:right;flex-shrink:0}
  .score-track{flex:1;height:4px;background:var(--border);border-radius:2px}
  .score-fill{height:100%;border-radius:2px;transition:width .4s}
  .freshness{font-size:9px;padding:1px 6px;border-radius:8px;font-weight:600}
  .fresh-live{background:rgba(0,210,100,.15);color:var(--green);border:1px solid rgba(0,210,100,.3)}
  .fresh-ok{background:rgba(240,165,0,.15);color:var(--gold);border:1px solid rgba(240,165,0,.3)}
  .fresh-stale{background:rgba(255,69,69,.1);color:var(--red);border:1px solid rgba(255,69,69,.2)}
  /* v4.0 panels */
  .health-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .health-card{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center}
  .health-card .hc-val{font-size:18px;font-weight:700;font-family:'JetBrains Mono',monospace}
  .health-card .hc-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;margin-top:4px}
  .prov-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px}
  .prov-row:last-child{border-bottom:none}
  .prov-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .flag-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px}
  .flag-icon{font-size:14px}
  .log-item{padding:10px 16px;border-bottom:1px solid var(--border);font-size:11px;font-family:'JetBrains Mono',monospace}
  .log-item:last-child{border-bottom:none}
  .log-cmd{color:var(--accent);font-weight:600}
  .log-err{color:var(--red)}
  .log-ok{color:var(--green)}
  .stale-badge{font-size:9px;background:rgba(220,38,38,.15);color:#D32F2F;padding:2px 6px;border-radius:8px;margin-left:6px}
  .theme-toggle{background:var(--bg3);color:var(--accent);border:1px solid var(--border);padding:4px 10px;border-radius:20px;font-size:11px;cursor:pointer;font-weight:600;transition:all .2s}
  .theme-toggle:hover{border-color:var(--accent);box-shadow:0 0 8px rgba(0,195,255,.2)}
  /* Floating Chart Control Panel */
  .chart-float-panel{position:sticky;top:0;z-index:50;background:rgba(15,23,42,.92);backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:12px;padding:10px 16px;margin:0 0 12px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 4px 24px rgba(0,0,0,.4)}
  .chart-float-panel .cfp-group{display:flex;align-items:center;gap:6px}
  .chart-float-panel .cfp-label{font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600;letter-spacing:.5px}
  .chart-float-panel select,.chart-float-panel button{background:var(--bg3);color:var(--text);border:1px solid var(--border);padding:5px 10px;border-radius:8px;font-size:11px;font-family:'JetBrains Mono',monospace;cursor:pointer;transition:all .2s}
  .chart-float-panel select:hover,.chart-float-panel button:hover{border-color:var(--accent);box-shadow:0 0 8px rgba(0,195,255,.2)}
  .chart-float-panel button.cfp-active{background:var(--accent);color:#000;border-color:var(--accent);font-weight:700}
  .chart-float-panel .cfp-status{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:10px}
  .chart-float-panel .cfp-dot{width:6px;height:6px;border-radius:50%;display:inline-block}
  .chart-float-panel .cfp-dot-live{background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite}
  .chart-float-panel .cfp-dot-stale{background:var(--gold)}
  .chart-float-panel .cfp-dot-off{background:var(--muted)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  /* Chart & indicator panels */
  .chart-frame{width:100%;border:none;border-radius:8px;min-height:320px;background:var(--bg3)}
  .asset-select{background:var(--bg3);color:var(--text);border:1px solid var(--border);padding:6px 12px;border-radius:8px;font-size:12px;font-family:'JetBrains Mono',monospace;cursor:pointer}
  .ind-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;padding:12px}
  .ind-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 10px;text-align:center;transition:border-color .2s,box-shadow .2s}
  .ind-card:hover{border-color:var(--accent);box-shadow:0 0 12px rgba(0,195,255,.1)}
  .ind-card.ind-highlight{border-color:var(--green);box-shadow:0 0 10px rgba(0,210,100,.15)}
  .ind-card.ind-warn{border-color:var(--gold);box-shadow:0 0 10px rgba(255,193,7,.12)}
  .ind-card.ind-danger{border-color:var(--red);box-shadow:0 0 10px rgba(255,69,69,.12)}
  .ind-val{font-size:18px;font-weight:700;font-family:'JetBrains Mono',monospace}
  .ind-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;margin-top:2px}
  .ind-sub{font-size:9px;color:var(--muted);margin-top:3px}
  .ind-sig{font-size:10px;font-weight:600;margin-top:3px;padding:2px 8px;border-radius:10px;display:inline-block}
  .sig-bull{background:rgba(0,210,100,.15);color:var(--green)}
  .sig-bear{background:rgba(255,69,69,.15);color:var(--red)}
  .sig-neutral{background:rgba(100,116,139,.15);color:var(--muted)}
  .sig-squeeze{background:rgba(255,193,7,.15);color:var(--gold)}
  .sig-expansion{background:rgba(0,195,255,.15);color:var(--accent)}
  .strat-section{margin-bottom:10px}
  .strat-label{font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:600;margin-bottom:4px}
  .strat-tag{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin:2px 3px}
  .strat-active{background:rgba(0,210,100,.15);color:var(--green);border:1px solid rgba(0,210,100,.3)}
  .strat-watch{background:rgba(0,195,255,.1);color:var(--accent);border:1px solid rgba(0,195,255,.3)}
  .strat-avoid{background:rgba(255,69,69,.1);color:var(--red);border:1px solid rgba(255,69,69,.2)}
  .crypto-row{display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--border);font-size:12px}
  .crypto-row:last-child{border-bottom:none}
  .crypto-img{width:22px;height:22px;border-radius:50%}
  .crypto-name{font-weight:600;flex:1}
  .crypto-price{font-family:'JetBrains Mono',monospace;font-weight:600}
  /* Session banner */
  .session-bar{display:flex;align-items:center;gap:12px;padding:10px 20px;background:#0a1628;border-bottom:1px solid var(--border);font-size:11px;overflow-x:auto}
  .sess-pill{padding:4px 12px;border-radius:20px;font-weight:700;font-size:10px;white-space:nowrap}
  .sess-high{background:rgba(0,210,100,.2);color:var(--green);border:1px solid rgba(0,210,100,.4)}
  .sess-med{background:rgba(240,165,0,.15);color:var(--gold);border:1px solid rgba(240,165,0,.3)}
  .sess-low{background:rgba(100,116,139,.15);color:var(--muted);border:1px solid var(--border)}
  .sess-active{box-shadow:0 0 8px currentColor}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0}
  .stat{padding:16px;border-right:1px solid var(--border);text-align:center}
  .stat:last-child{border-right:none}
  .stat-val{font-size:22px;font-weight:700;font-family:'JetBrains Mono',monospace}
  .stat-lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:3px}
  .heatmap{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:16px}
  .heat-cell{padding:10px 6px;border-radius:8px;text-align:center;font-size:11px;font-weight:600;cursor:default;transition:transform .2s}
  .heat-cell:hover{transform:scale(1.05)}
  .heat-bull{background:rgba(0,210,100,.2);border:1px solid rgba(0,210,100,.4);color:var(--green)}
  .heat-bear{background:rgba(255,69,69,.2);border:1px solid rgba(255,69,69,.4);color:var(--red)}
  .heat-neutral{background:rgba(100,116,139,.15);border:1px solid var(--border);color:var(--muted)}
  .full-width{grid-column:1/-1}
  .refresh-btn{background:var(--accent);color:#000;border:none;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer}
  .ts{font-size:10px;color:var(--muted)}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  /* ── Live Ticker Bar ── */
  .ticker-bar{display:flex;align-items:center;gap:0;padding:0 12px;background:#060b14;border-bottom:1px solid var(--border);overflow-x:auto;white-space:nowrap;font-family:'JetBrains Mono',monospace;font-size:12px;animation:tickerFadeIn .5s}
  @keyframes tickerFadeIn{from{opacity:0}to{opacity:1}}
  .ticker-item{display:flex;align-items:center;gap:6px;padding:8px 14px;border-right:1px solid var(--border);flex-shrink:0}
  .ticker-item:last-child{border-right:none}
  .ticker-sym{color:var(--accent);font-weight:600;font-size:11px}
  .ticker-price{color:var(--text);font-weight:500}
  .ticker-chg{font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px}
  .ticker-up{color:var(--green);background:rgba(0,210,100,.1)}
  .ticker-down{color:var(--red);background:rgba(255,69,69,.1)}
  .ticker-flat{color:var(--muted)}
  /* Scrolling signal ticker */
  .signal-ticker{background:#060b14;border-bottom:1px solid var(--border);padding:6px 0;overflow:hidden;white-space:nowrap}
  .signal-ticker-inner{display:inline-flex;gap:24px;animation:scroll-ticker 30s linear infinite}
  @keyframes scroll-ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
  .signal-ticker:hover .signal-ticker-inner{animation-play-state:paused}
  .st-item{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 10px;border-radius:6px;border:1px solid var(--border)}
  .st-buy{border-color:rgba(0,210,100,.3);color:var(--green)}
  .st-sell{border-color:rgba(255,69,69,.3);color:var(--red)}
  .st-wait{border-color:rgba(240,165,0,.3);color:var(--gold)}
  /* TZ selector */
  .tz-select{background:var(--bg3);color:var(--accent);border:1px solid var(--border);padding:4px 8px;border-radius:8px;font-size:10px;cursor:pointer;font-family:'JetBrains Mono',monospace}
  /* API counter */
  .api-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:12px}
  .api-card{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;font-size:10px}
  .api-card .api-ct{font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace}
  .api-card .api-nm{color:var(--muted);margin-top:2px}
  /* Journal */
  .journal-table{width:100%;border-collapse:collapse;font-size:11px}
  .journal-table th{background:var(--bg);color:var(--muted);text-transform:uppercase;font-size:9px;padding:8px 10px;text-align:left;border-bottom:1px solid var(--border)}
  .journal-table td{padding:8px 10px;border-bottom:1px solid var(--border)}
  .journal-win{color:var(--green)}
  .journal-loss{color:var(--red)}
  /* Expandable analysis */
  .analysis-full{font-size:11.5px;color:var(--text);line-height:1.5;white-space:pre-wrap;max-height:0;overflow:hidden;transition:max-height .3s}
  .analysis-full.open{max-height:2000px}
  .analysis-toggle{color:var(--accent);cursor:pointer;font-size:10px;font-weight:600;margin-top:4px;display:inline-block}
  /* Source badge */
  .src-badge{font-size:8px;padding:1px 5px;border-radius:6px;font-weight:700;margin-left:6px}
  .src-primary{background:rgba(0,210,100,.15);color:var(--green)}
  .src-fallback{background:rgba(240,165,0,.15);color:var(--gold)}
  /* ── Fear & Greed Gauge ── */
  .fg-gauge{display:flex;align-items:center;gap:16px;padding:20px}
  .fg-circle{width:90px;height:90px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;border:3px solid}
  .fg-score{font-size:26px;font-family:'JetBrains Mono',monospace}
  .fg-label{font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .fg-meta{flex:1}
  .fg-title{font-size:13px;font-weight:600;margin-bottom:6px}
  .fg-desc{font-size:11px;color:var(--muted);line-height:1.5}
  /* ── Analysis Panel ── */
  .analysis-item{padding:14px 16px;border-bottom:1px solid var(--border)}
  .analysis-item:last-child{border-bottom:none}
  .analysis-header{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .analysis-ticker{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--accent)}
  .analysis-model{font-size:9px;background:#1a2840;color:var(--muted);padding:2px 6px;border-radius:8px}
  .analysis-preview{font-size:11px;color:var(--text);line-height:1.45;max-height:60px;overflow:hidden;text-overflow:ellipsis}
  .last-updated{font-size:9px;color:var(--muted);font-style:italic}
  .freshness{display:inline-block;font-size:9px;padding:1px 6px;border-radius:8px;font-weight:600;margin-left:6px;vertical-align:middle}
  .fresh-live{background:rgba(0,210,100,.12);color:var(--green);border:1px solid rgba(0,210,100,.25)}
  .fresh-ok{background:rgba(240,165,0,.12);color:var(--gold);border:1px solid rgba(240,165,0,.25)}
  .fresh-stale{background:rgba(255,69,69,.1);color:var(--red);border:1px solid rgba(255,69,69,.2)}
  #sync-status{font-size:10px;margin-left:12px;display:inline-block}
</style>
</head>
<body>
<header>
  <div class="live-dot"></div>
  <h1>🔭 OpenClaw v5.1 Institutional Alpha</h1>
  <span class="badge">INSTITUTIONAL ALPHA</span>
  <span class="badge" style="color:var(--gold);border-color:var(--gold)">8-Layer Scoring</span>
  <select class="tz-select" id="tz-select" onchange="updateTimezone()">
    <option value="UTC">UTC</option><option value="EAT">EAT +3</option><option value="EST">EST -5</option><option value="GMT">London</option><option value="CET">CET +1</option><option value="JST">JST +9</option>
  </select>
  <button class="theme-toggle" id="theme-toggle" onclick="toggleTheme()" aria-label="Toggle dark/light mode">🌙 Dark</button>
  <span class="ts" style="margin-left:auto" id="clock"></span>
  <span id="sync-status"></span>
</header>
<!-- Session Quality Banner -->
<div class="session-bar" id="session-bar">
  <span style="color:var(--muted);font-weight:600">SESSION:</span>
  <span class="sess-pill sess-low" id="s-asia">🌙 ASIA 00-07</span>
  <span class="sess-pill sess-high" id="s-lon-open">⭐ LONDON OPEN 07-08</span>
  <span class="sess-pill sess-med" id="s-london">🇬🇧 LONDON 08-12</span>
  <span class="sess-pill sess-high" id="s-overlap">⭐ OVERLAP 12-16</span>
  <span class="sess-pill sess-med" id="s-ny">🇺🇸 NY 16-21</span>
  <span class="sess-pill sess-low" id="s-off">🌑 OFF 21-24</span>
  <span style="margin-left:auto;color:var(--muted)" id="sess-quality"></span>
</div>
<!-- Live Price Ticker -->
<div class="ticker-bar" id="ticker-bar">
  <div class="ticker-item"><span class="ticker-sym">Loading prices...</span></div>
</div>
<!-- Scrolling Signal Ticker -->
<div class="signal-ticker" id="signal-ticker">
  <div class="signal-ticker-inner" id="signal-ticker-inner">Loading signals...</div>
</div>

<div class="grid">
  <!-- Stats Row -->
  <div class="panel full-width">
    <div class="stat-grid" id="stats">
      <div class="stat"><div class="stat-val" id="s-headlines">—</div><div class="stat-lbl">Headlines Today</div></div>
      <div class="stat"><div class="stat-val" id="s-signals">—</div><div class="stat-lbl">Signals Sent</div></div>
      <div class="stat"><div class="stat-val" id="s-watchlist">—</div><div class="stat-lbl">Watchlist</div></div>
      <div class="stat"><div class="stat-val" id="s-rwanda">—</div><div class="stat-lbl">Rwanda Intel</div></div>
    </div>
  </div>

  <!-- Live News -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">📰 Live News Feed <span class="live-dot"></span> <span id="news-freshness"></span></div>
      <button class="refresh-btn" onclick="loadAll()">↻ Refresh</button>
    </div>
    <div class="panel-body" id="news-feed"></div>
  </div>

  <!-- Signals -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🚨 Signal Log <span id="signals-freshness"></span></div>
      <span class="ts" id="last-signal-ts"></span>
    </div>
    <div class="panel-body" id="signals-feed"></div>
  </div>

  <!-- Rwanda -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🇷🇼 Rwanda Intelligence</div>
    </div>
    <div class="panel-body" id="rwanda-feed"></div>
  </div>

  <!-- Asset Heatmap -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🌡️ Asset Signal Heatmap</div>
    </div>
    <div class="heatmap" id="heatmap"></div>
  </div>

  <!-- Fear & Greed -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">😱 Fear & Greed Index</div>
      <span class="last-updated" id="fg-updated"></span>
    </div>
    <div class="fg-gauge" id="fg-gauge">
      <div style="color:var(--muted);padding:20px;text-align:center">Loading...</div>
    </div>
  </div>

  <!-- AI Analysis -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🤖 AI Multi-Agent Analyses</div>
      <span class="last-updated" id="analysis-updated"></span>
    </div>
    <div class="panel-body" id="analysis-feed">
      <div style="padding:20px;color:var(--muted);text-align:center">Run /analyze from Telegram to populate</div>
    </div>
  </div>

  <!-- System Health -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">⚡ System Health <span class="live-dot"></span></div>
      <span class="last-updated" id="health-updated"></span>
    </div>
    <div id="health-panel" style="padding:16px">
      <div style="color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- Provider Status -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">📡 Providers</div>
    </div>
    <div class="panel-body" id="providers-panel" style="padding:16px">
      <div style="color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- Strategy Router v3.3 -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🧭 Strategy Router</div>
      <span class="ts" id="strat-updated"></span>
    </div>
    <div class="panel-body" id="strat-route-panel" style="padding:16px">
      <div style="color:var(--muted);text-align:center">Loading strategies...</div>
    </div>
  </div>

  <!-- Run Logs -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">📋 Run Logs</div>
      <span class="last-updated" id="logs-updated"></span>
    </div>
    <div class="panel-body" id="logs-panel">
      <div style="padding:20px;color:var(--muted);text-align:center">Waiting for runs...</div>
    </div>
  </div>

  <!-- Feature Flags -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🏳️ Feature Flags</div>
    </div>
    <div id="flags-panel" style="padding:16px">
      <div style="color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- API Usage Counter -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">📊 API Usage</div>
    </div>
    <div id="api-usage-panel" style="padding:12px">
      <div style="color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- Signal History -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">📜 Signal History</div>
      <select class="asset-select" id="sig-filter" onchange="loadSignalHistory()">
        <option value="">All Assets</option><option>BTC</option><option>XAUUSD</option><option>EURUSD</option><option>ETH</option>
      </select>
    </div>
    <div class="panel-body" id="signal-history-panel">
      <div style="padding:20px;color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- v4.0: Veto Decomposition -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">⛔ Veto Decomposition</div>
      <span class="ts" id="veto-updated"></span>
    </div>
    <div class="panel-body" id="veto-panel" style="padding:16px">
      <div style="color:var(--muted);text-align:center">Loading veto analysis...</div>
    </div>
  </div>

  <!-- v4.0: Event Risk Status -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">⚠️ Event Risk Status</div>
      <span class="ts" id="event-updated"></span>
    </div>
    <div id="event-risk-panel" style="padding:16px">
      <div style="color:var(--muted);text-align:center">Scanning event risk...</div>
    </div>
  </div>

  <!-- Trade Journal -->
  <div class="panel full-width">
    <div class="panel-header">
      <div class="panel-title">📓 Trade Journal</div>
    </div>
    <div class="panel-body" id="journal-panel">
      <div style="padding:20px;color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- Chart Viewer with Floating Control Panel -->
  <div class="panel full-width">
    <div class="panel-header">
      <div class="panel-title">📈 Chart Viewer</div>
      <span class="last-updated" id="chart-updated"></span>
    </div>
    <!-- Floating intelligent control panel -->
    <div class="chart-float-panel" id="chart-controls">
      <div class="cfp-group">
        <span class="cfp-label">Asset</span>
        <select id="chart-asset" onchange="loadChart()">
          <option>BTCUSD</option><option>XAUUSD</option><option>EURUSD</option><option>GBPUSD</option><option>OIL</option><option>NAS100</option><option>US30</option><option>ETH</option><option>SOL</option><option>XRP</option><option>USDJPY</option>
        </select>
      </div>
      <div class="cfp-group">
        <span class="cfp-label">TF</span>
        <button class="cfp-tf cfp-active" data-tf="60" onclick="setTF(this)">1H</button>
        <button class="cfp-tf" data-tf="240" onclick="setTF(this)">4H</button>
        <button class="cfp-tf" data-tf="1440" onclick="setTF(this)">1D</button>
      </div>
      <div class="cfp-status" id="chart-status">
        <span class="cfp-dot cfp-dot-off"></span>
        <span style="color:var(--muted)">No data</span>
      </div>
    </div>
    <div style="padding:12px" id="chart-panel">
      <div style="color:var(--muted);text-align:center;padding:40px">Select asset above — chart loads from Binance/Yahoo via QuickChart</div>
    </div>
  </div>

  <!-- Expert Indicators -->
  <div class="panel full-width">
    <div class="panel-header">
      <div class="panel-title">📊 Expert Indicators</div>
      <span class="last-updated" id="ind-updated"></span>
    </div>
    <div id="ind-panel">
      <div style="padding:20px;color:var(--muted);text-align:center">Select asset from chart to load indicators</div>
    </div>
  </div>

  <!-- Strategies -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🎯 Regime & Strategies</div>
      <span class="last-updated" id="strat-updated"></span>
    </div>
    <div id="strat-panel" style="padding:16px">
      <div style="color:var(--muted);text-align:center">Select asset from chart to load regime</div>
    </div>
  </div>

  <!-- Crypto Trending -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🔥 Crypto Trending</div>
      <span class="last-updated" id="trend-updated"></span>
    </div>
    <div class="panel-body" id="trending-panel">
      <div style="padding:20px;color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- Crypto Top 10 -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">💎 Top 10 by Market Cap</div>
      <span class="last-updated" id="top-updated"></span>
    </div>
    <div class="panel-body" id="top-panel">
      <div style="padding:20px;color:var(--muted);text-align:center">Loading...</div>
    </div>
  </div>

  <!-- v3.4 Learning Intelligence Panel -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🧠 Learning Engine <span id="learning-stale-badge" style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bg3);color:var(--muted);margin-left:6px">⏳ loading</span></div>
      <span class="last-updated" id="learning-updated"></span>
    </div>
    <div class="panel-body" id="learning-panel" style="padding:14px">
      <div style="color:var(--muted);text-align:center">Loading learning status...</div>
    </div>
  </div>

  <!-- v3.4 Replay / Backtest Panel -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">🔁 Replay &amp; Backtest <span id="replay-stale-badge" style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bg3);color:var(--muted);margin-left:6px">⏳ loading</span></div>
      <span class="last-updated" id="replay-updated"></span>
    </div>
    <div class="panel-body" id="replay-panel" style="padding:14px">
      <div style="color:var(--muted);text-align:center">No recent replays or backtests.</div>
    </div>
  </div>

  <!-- v3.4 Indicator Intelligence Panel -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">📐 Indicator Intelligence <span id="indic-stale-badge" style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bg3);color:var(--muted);margin-left:6px">⏳ loading</span></div>
      <span class="last-updated" id="indic-updated"></span>
    </div>
    <div class="panel-body" id="indic-intel-panel" style="padding:14px">
      <div style="color:var(--muted);text-align:center">Loading indicator enrichments...</div>
    </div>
  </div>

</div>


<script>
// Smart API Base — auto-detects environment
var API_BASE = '';
(function(){
  var loc = window.location.hostname;
  if (loc === 'localhost' || loc === '127.0.0.1') {
    API_BASE = ''; // same-origin
  } else {
    // Remote deploy: try stored server URL or prompt
    var stored = localStorage.getItem('openclaw_api_base');
    if (stored) { API_BASE = stored; }
    else {
      var url = prompt('Enter your OpenClaw server URL (e.g. http://YOUR_IP:3737):', 'http://localhost:3737');
      if (url) { API_BASE = url.replace(/\\/+$/,''); localStorage.setItem('openclaw_api_base', API_BASE); }
    }
  }
  console.log('[OpenClaw] API Base:', API_BASE || '(same-origin)');
})();
function apiFetch(path, opts) {
  // v5.2: Global 8s timeout for all internal API calls — no infinite Loading
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 8000);
  var fetchOpts = Object.assign({}, opts || {}, { signal: controller.signal });
  return fetch(API_BASE + path, fetchOpts).finally(function() { clearTimeout(timeout); });
}

// ── Dark/Light Mode Toggle ──
function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('openclaw_theme', next);
  var btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = next === 'dark' ? '\\ud83c\\udf19 Dark' : '\\u2600\\ufe0f Light';
}
// Apply saved theme on load
(function(){
  var saved = localStorage.getItem('openclaw_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  var btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = saved === 'dark' ? '\\ud83c\\udf19 Dark' : '\\u2600\\ufe0f Light';
})();

// ── Stale Badge (reads snapshot metadata) ──
function staleBadge(data) {
  if (!data) return '<span class="freshness fresh-stale">NO DATA</span>';
  var age = data.cache_age_seconds;
  if (age === undefined || age === null) {
    if (data.created_at) age = (Date.now() - new Date(data.created_at).getTime()) / 1000;
    else return '';
  }
  var threshold = data.stale_threshold || 300;

  // v4.0 HARD RULE: If stale=true, NEVER show LIVE badge
  if (data.stale === true) {
    if (age > threshold * 5) return '<span class="freshness fresh-stale">\u274c EXPIRED ' + Math.round(age/3600) + 'h</span>';
    return '<span class="freshness fresh-stale">\ud83d\udd34 STALE ' + Math.round(age/60) + 'm</span>';
  }

  if (age < threshold) return '<span class="freshness fresh-live">LIVE ' + Math.round(age) + 's</span>';
  if (age < threshold * 2) return '<span class="freshness fresh-ok">\u26a0 ' + Math.round(age/60) + 'm ago</span>';
  if (age < threshold * 5) return '<span class="freshness fresh-stale">\ud83d\udd34 STALE ' + Math.round(age/60) + 'm</span>';
  return '<span class="freshness fresh-stale">\u274c EXPIRED</span>';
}

// v4.0: Enhanced panel state — shows source failure, last attempt, retry hint
function panelState(id, state, msg, meta) {
  var el = document.getElementById(id);
  if (!el) return;
  var icons = { loading: '\u23f3', error: '\u274c', empty: '\ud83d\udced', offline: '\ud83d\udd0c', stale: '\u26a0\ufe0f', nodata: '\ud83d\udcad' };
  var colors = { loading: 'var(--muted)', error: 'var(--red)', empty: 'var(--muted)', offline: 'var(--gold)', stale: 'var(--gold)', nodata: 'var(--muted)' };
  var extra = '';
  if (meta && meta.source) extra += '<div style="font-size:9px;color:var(--muted);margin-top:4px">Source: ' + meta.source + '</div>';
  if (meta && meta.lastAttempt) extra += '<div style="font-size:9px;color:var(--muted)">Last attempt: ' + meta.lastAttempt + '</div>';
  if (state === 'error' || state === 'stale') extra += '<div style="font-size:9px;margin-top:4px"><button onclick="loadAll()" style="background:var(--card);color:var(--green);border:1px solid var(--green);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:9px">\u21bb Retry</button></div>';
  el.innerHTML = '<div style="padding:20px;color:' + (colors[state]||'var(--muted)') + ';text-align:center">' + (icons[state]||'') + ' ' + (msg||state) + extra + '</div>';
}


// ── Sync Health Monitor ──
var _syncHealthOk = true;
async function loadSyncHealth() {
  try {
    var d = await apiFetch('/api/v4/sync-health').then(function(r){return r.json();});
    _syncHealthOk = d.sync_ok;
    var el = document.getElementById('sync-status');
    if (el) {
      el.innerHTML = d.sync_ok
        ? '<span style="color:var(--green)">\u2705 Sync OK (' + d.available + '/' + d.total_types + ')</span>'
        : '<span style="color:var(--gold)">\u26a0 ' + d.stale + ' stale snapshot' + (d.stale>1?'s':'') + '</span>';
    }
  } catch(e) { console.warn('Sync health error', e); }
}

const ASSETS = ['XAUUSD','BTCUSD','EURUSD','GBPUSD','OIL','NAS100','US30','COPPER','COFFEE','COLTAN'];

function timeAgo(iso){
  if(!iso) return '—';
  const s=(Date.now()-new Date(iso).getTime())/1000;
  if(s<60) return Math.round(s)+'s ago';
  if(s<3600) return Math.round(s/60)+'m ago';
  return Math.round(s/3600)+'h ago';
}

// ── Safe Render — NEVER show [object Object] ──
function safeRender(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(safeRender).join(', ');
  if (typeof val === 'object') {
    // Known snapshot types
    if (val.regime && val.confidence) return val.regime + ' (' + val.confidence + '%)';
    if (val.final_action) return val.final_action + (val.total_score ? ' ' + val.total_score + '/100' : '');
    // Generic: key: value pairs
    return Object.entries(val).map(function(e) {
      var v = (typeof e[1] === 'object' && e[1] !== null) ? JSON.stringify(e[1]) : String(e[1] ?? '—');
      return e[0] + ': ' + v;
    }).join(' | ');
  }
  return String(val);
}

async function loadAll(){
  try{
    const [news,sigs,rwanda,perf,syncH]=await Promise.all([
      apiFetch('/api/news').then(r=>r.json()),
      apiFetch('/api/signals').then(r=>r.json()),
      apiFetch('/api/rwanda').then(r=>r.json()),
      apiFetch('/api/performance').then(r=>r.json()),
      apiFetch('/api/v4/sync-health').then(r=>r.json()).catch(function(){return null;})
    ]);

    // Stale badges from sync health
    var newsSnap = syncH && syncH.snapshots ? syncH.snapshots.find(function(s){return s.type==='NEWS';}) : null;
    var sigSnap = syncH && syncH.snapshots ? syncH.snapshots.find(function(s){return s.type==='SIGNAL';}) : null;

    // Stats
    document.getElementById('s-headlines').textContent=perf.totalHeadlines||news.length||'—';
    document.getElementById('s-signals').textContent=perf.sentToTelegram||0;
    document.getElementById('s-watchlist').textContent=sigs.filter(s=>s.status==='watchlist').length||0;
    document.getElementById('s-rwanda').textContent=rwanda.length||0;

    // Stale badges on panel headers
    var nfEl = document.getElementById('news-freshness');
    if (nfEl && newsSnap) nfEl.innerHTML = newsSnap.available ? staleBadge(newsSnap) : '';
    var sfEl = document.getElementById('signals-freshness');
    if (sfEl && sigSnap) sfEl.innerHTML = sigSnap.available ? staleBadge(sigSnap) : '';

    // News
    const nf=document.getElementById('news-feed');
    nf.innerHTML=news.slice(0,40).map(h=>\`
      <div class="news-item">
        <div class="news-title"><a href="\${h.url||'#'}" target="_blank">\${h.title}</a></div>
        <div class="news-meta">
          <span class="tag tag-source">\${h.source||'Unknown'}</span>
          \${h.isRwanda?'<span class="tag tag-rwanda">🇷🇼 Rwanda</span>':''}
          \${h.category==='crypto'?'<span class="tag tag-crypto">⚡ Crypto</span>':''}
          \${h.assets?.length?'<span class="tag tag-global">'+h.assets.slice(0,2).join(' ')+'</span>':''}
          <span class="ts">\${timeAgo(h.publishedAt||h.savedAt)}</span>
        </div>
      </div>
    \`).join('');

    // Signals — institutional states
    const sf=document.getElementById('signals-feed');
    if(!sigs.length){sf.innerHTML='<div style="padding:20px;color:var(--muted);text-align:center">No signals yet — run /signal from Telegram</div>';return;}
    document.getElementById('last-signal-ts').textContent=sigs[0]?timeAgo(sigs[0].createdAt):'';
    sf.innerHTML=sigs.slice(0,20).map(s=>{
      const act=s.final_action||s.direction||'UNKNOWN';
      const stateClass={BUY:'state-buy',SELL:'state-sell',WAIT:'state-wait',WATCHLIST:'state-watchlist',REJECTED:'state-rejected'}[act]||'';
      const dirClass={BUY:'dir-buy',SELL:'dir-sell',WAIT:'dir-wait',WATCHLIST:'dir-watchlist',REJECTED:'dir-rejected'}[act]||'dir-wait';
      const actIcon={BUY:'🟢 BUY',SELL:'🔴 SELL',WAIT:'⏳ WAIT',WATCHLIST:'📋 WATCHLIST',REJECTED:'🚫 REJECTED'}[act]||act;
      const setup=s.setup_type||s.setup_label||'';
      const score=s.institutional_score||s.score||s.confidence||0;
      const bd=s.score_breakdown||{};
      const scoreRows=Object.entries({Trend:bd.trend,Liq:bd.liquidity,FVG:bd.fvg,Mom:bd.momentum,Sess:bd.session,Macro:bd.macro,Risk:bd.risk})
        .filter(([,v])=>v!=null)
        .map(([k,v])=>{
          const max={Trend:20,Liq:20,FVG:20,Mom:10,Sess:10,Macro:10,Risk:10}[k]||10;
          const pct=Math.round(v/max*100);
          const col=pct>=70?'var(--green)':pct>=40?'var(--gold)':'var(--red)';
          return \`<div class="score-row"><span class="score-label">\${k}</span><div class="score-track"><div class="score-fill" style="width:\${pct}%;background:\${col}"></div></div><span style="font-size:9px;color:var(--muted)">\${v}/\${max}</span></div>\`;
        }).join('');
      const vetoNote=(s.veto_summary||[]).slice(0,1).map(function(v){return '<div class="veto-note">⛔ '+v+'</div>';}).join('');
      const whyNot=(s.why_not_trade||[]).slice(0,1).map(function(w){return '<div class="ts" style="color:var(--red);margin-top:3px">↳ '+w+'</div>';}).join('');
      return \`<div class="signal-item \${stateClass}">
        <div class="signal-header">
          <span class="signal-asset">\${s.asset||s.symbol||'—'}</span>
          <span class="\${dirClass}">\${actIcon}</span>
          \${setup?\`<span class="setup-badge">\${setup.replace(/_/g,' ').toUpperCase()}</span>\`:''}          
          <span class="ts" style="margin-left:auto">\${timeAgo(s.createdAt||s.created_at)}</span>
        </div>
        \${s.why_trade?\`<div class="signal-reason" style="color:var(--green);font-size:11px">✅ \${s.why_trade[0]||''}</div>\`:''}
        \${vetoNote}\${whyNot}
        \${scoreRows?\`<div class="score-bars">\${scoreRows}</div>\`:''}
        <div class="ts" style="margin-top:6px">Score: \${score}/100 | \${s.session||''} | \${s.rr_value?'R:R '+s.rr_value:''}</div>
      </div>\`;
    }).join('');

    // Rwanda
    const rf=document.getElementById('rwanda-feed');
    rf.innerHTML=rwanda.slice(0,20).map(h=>\`
      <div class="news-item">
        <div class="news-title">\${h.title}</div>
        <div class="news-meta">
          <span class="tag tag-rwanda">🇷🇼 \${h.source}</span>
          \${h.assets?.length?'<span class="tag tag-global">'+h.assets.join(' ')+'</span>':''}
          <span class="ts">\${timeAgo(h.savedAt)}</span>
        </div>
      </div>
    \`).join('') || '<div style="padding:20px;color:var(--muted);text-align:center">No Rwanda intel yet</div>';

    // Heatmap
    const assetCounts={};
    sigs.forEach(s=>{
      if(!assetCounts[s.asset]) assetCounts[s.asset]={buy:0,sell:0};
      if(s.direction==='BUY') assetCounts[s.asset].buy++;
      else assetCounts[s.asset].sell++;
    });
    document.getElementById('heatmap').innerHTML=ASSETS.map(a=>{
      const c=assetCounts[a]||{buy:0,sell:0};
      const cls=c.buy>c.sell?'heat-bull':c.sell>c.buy?'heat-bear':'heat-neutral';
      const arrow=c.buy>c.sell?'▲':c.sell>c.buy?'▼':'—';
      return \`<div class="heat-cell \${cls}">\${a}<br>\${arrow}</div>\`;
    }).join('');
    // Session banner highlight
    const utcH=new Date().getUTCHours();
    const sessMap=[{id:'s-asia',s:0,e:7},{id:'s-lon-open',s:7,e:8},{id:'s-london',s:8,e:12},{id:'s-overlap',s:12,e:16},{id:'s-ny',s:16,e:21},{id:'s-off',s:21,e:24}];
    sessMap.forEach(w=>{
      const el=document.getElementById(w.id);
      if(el){el.classList.toggle('sess-active',utcH>=w.s&&utcH<w.e);}
    });
    const curSess=sessMap.find(w=>utcH>=w.s&&utcH<w.e);
    document.getElementById('sess-quality').textContent=curSess?\`Current: \${document.getElementById(curSess.id)?.textContent||''} UTC\`:'—';
  }catch(e){console.error(e);}
}

// ── Live Price Ticker ──
async function loadPrices(){
  try{
    const data=await apiFetch('/api/prices').then(r=>r.json());
    if(!data.prices) return;
    document.getElementById('ticker-bar').innerHTML=data.prices.map(function(p){
      var chgCls=p.change>0?'ticker-up':p.change<0?'ticker-down':'ticker-flat';
      var arrow=p.change>0?'▲':p.change<0?'▼':'';
      return '<div class=\"ticker-item\"><span class=\"ticker-sym\">'+p.symbol+'</span><span class=\"ticker-price\">'+p.price+'</span><span class=\"ticker-chg '+chgCls+'\">'+arrow+(p.change!=null?p.change.toFixed(2)+'%':'')+'</span></div>';
    }).join('');
  }catch(e){console.warn('Ticker error',e);}
}

// ── Fear & Greed ──
async function loadFearGreed(){
  try{
    var data=await apiFetch('/api/feargreed').then(function(r){return r.json();});
    if(data.error && !data.value) { panelState('fg-gauge','error','Fear & Greed unavailable'); return; }
    var v=data.value||0;
    var label=data.classification||'Unknown';
    var col=v<=25?'var(--red)':v<=45?'#ff8c00':v<=55?'var(--gold)':v<=75?'var(--green)':'#00ff88';
    var desc=v<=25?'Extreme fear — potential buying opportunity':v<=45?'Fear in market — cautious sentiment':v<=55?'Neutral — no strong directional bias':v<=75?'Greed — momentum but watch for reversals':'Extreme greed — risk of correction';
    var isStale = data.stale === true;
    var staleCls = isStale ? 'fresh-stale' : 'fresh-live';
    var staleText = isStale ? '⚠ STALE' : '🟢 LIVE';
    var provTs = data.provider_timestamp ? 'Provider: '+timeAgo(data.provider_timestamp) : '';
    var fetchTs = data.fetch_timestamp ? 'Fetched: '+timeAgo(data.fetch_timestamp) : '';
    var ageText = data.cache_age_seconds != null ? data.cache_age_seconds+'s ago' : '';
    document.getElementById('fg-gauge').innerHTML='<div class=\"fg-circle\" style=\"border-color:'+col+';color:'+col+'\"><div class=\"fg-score\">'+v+'</div><div class=\"fg-label\">'+label+'</div></div><div class=\"fg-meta\"><div class=\"fg-title\" style=\"color:'+col+'\">'+label+'</div><div class=\"fg-desc\">'+desc+'</div><div class=\"fg-desc\" style=\"margin-top:6px\">'+provTs+(provTs&&fetchTs?' | ':'')+fetchTs+'</div></div>';
    document.getElementById('fg-updated').innerHTML='<span class=\"freshness '+staleCls+'\">'+staleText+'</span> '+ageText+' | Source: '+safeRender(data.source||'alternative.me');
  }catch(e){
    panelState('fg-gauge','error','Fear & Greed unavailable');
  }
}

// -- AI Analyses (snapshot-backed) --
async function loadAnalyses(){
  try{
    var data=await apiFetch('/api/analyses').then(function(r){return r.json();});
    var af=document.getElementById('analysis-feed');
    if(!data.analyses||!data.analyses.length){
      af.innerHTML='<div style="padding:20px;color:var(--muted);text-align:center"><div style="font-size:32px;margin-bottom:10px">🤖</div><div style="font-weight:600;margin-bottom:6px">No AI Analysis Available</div><div style="font-size:12px">Run <code>/analyze SYMBOL</code> from Telegram to populate this panel.</div><div style="font-size:11px;margin-top:8px;color:var(--gold)">Analysis snapshots expire after 1 hour.</div></div>';
      return;
    }
    af.innerHTML=data.analyses.map(function(a,i){
      var result = a.result || a.payload || '';
      if (typeof result === 'object') result = safeRender(result);
      var clean = String(result).replace(/\[object Object\]/g,'').replace(/\*\*/g,'');
      var preview=clean.substring(0,200).replace(/[*_#]/g,'');
      var full=clean.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var meta = '';
      if(a.model||a.model_used) meta += '<span style="color:var(--accent);font-size:10px">Model: '+(a.model||a.model_used)+'</span> ';
      if(a.run_id) meta += '<span style="color:var(--muted);font-size:10px">Run: '+a.run_id.substring(0,12)+'</span> ';
      if(a.confidence) meta += '<span style="color:var(--green);font-size:10px">Conf: '+a.confidence+'%</span> ';
      if(a.final_action) meta += '<span style="font-size:10px;font-weight:700;color:'+(a.final_action==='BUY'?'var(--green)':a.final_action==='SELL'?'var(--red)':'var(--gold)')+'">'+a.final_action+'</span>';
      // Stale badge
      var isStale = a.stale === true;
      var staleTxt = isStale ? '<span class="freshness fresh-stale">⚠ STALE</span>' : '<span class="freshness fresh-live">🟢 LIVE</span>';
      var ageText = a.cache_age_seconds != null ? ' ('+a.cache_age_seconds+'s ago)' : '';
      var metaRow = meta ? '<div style="margin:4px 0">'+meta+' '+staleTxt+ageText+'</div>' : '';
      return '<div class="analysis-item"><div class="analysis-header"><span class="analysis-ticker">'+(a.ticker||a.symbol||'—')+'</span><span class="ts" style="margin-left:auto">'+timeAgo(a.timestamp||a.created_at)+'</span></div>'+metaRow+'<div class="analysis-preview">'+preview+'</div><div class="analysis-full" id="af-'+i+'" style="display:none;white-space:pre-wrap;padding:10px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);margin-top:8px">'+full+'</div><span class="analysis-toggle" data-target="af-'+i+'" style="cursor:pointer;color:var(--cyan);font-size:11px;display:inline-block;margin-top:6px">&#9660; View Full</span></div>';
    }).join('');
    var latestTs = data.analyses[0] ? (data.analyses[0].timestamp||data.analyses[0].created_at) : null;
    document.getElementById('analysis-updated').innerHTML=latestTs ? 'Latest: '+timeAgo(latestTs) : '';
  }catch(e){console.warn('Analysis error',e);}
}
document.addEventListener('click', function(e){
  if(e.target.classList.contains('analysis-toggle')){
    var t=document.getElementById(e.target.getAttribute('data-target'));
    if(t){var open=t.style.display!=='none';t.style.display=open?'none':'block';e.target.innerHTML=open?'&#9660; View Full':'&#9650; Collapse';}
  }
});

// Clock with timezone
var TZ_OFFSETS={UTC:0,EAT:3,EST:-5,GMT:0,CET:1,JST:9};var currentTZ='UTC';
function updateTimezone(){currentTZ=document.getElementById('tz-select').value;}
setInterval(function(){var n=new Date();var o=TZ_OFFSETS[currentTZ]||0;var l=new Date(n.getTime()+o*3600000);document.getElementById('clock').textContent=currentTZ+' '+l.toISOString().replace('T',' ').substring(0,19);},1000);
// ── v5.1 System Health ──
async function loadHealth(){
  try{
    var d=await apiFetch('/api/v4/snapshots/system').then(function(r){return r.json();});
    var hp=document.getElementById('health-panel');
    var hSnap=null; try{hSnap=await apiFetch('/api/v4/snapshot/HEALTH').then(function(r){return r.json();});}catch(e){}
    hp.innerHTML='<div class="health-grid">'+
      '<div class="health-card"><div class="hc-val" style="color:var(--green)">'+Math.floor((d.uptime||0)/3600)+'h</div><div class="hc-lbl">Uptime</div></div>'+
      '<div class="health-card"><div class="hc-val">'+(d.memory_mb||0)+'</div><div class="hc-lbl">Memory MB</div></div>'+
      '<div class="health-card"><div class="hc-val">'+(d.heap_used_mb||0)+'</div><div class="hc-lbl">Heap MB</div></div>'+
      '<div class="health-card"><div class="hc-val" style="color:var(--accent)">'+(d.providers?.healthy||0)+'</div><div class="hc-lbl">Providers OK</div></div>'+
      '<div class="health-card"><div class="hc-val">'+(d.scheduler||'—')+'</div><div class="hc-lbl">Scheduler</div></div>'+
      '<div class="health-card"><div class="hc-val" style="color:var(--accent)">v5.1</div><div class="hc-lbl">Version</div></div>'+
      '</div>';
    // v5.1: Circuit breaker status
    try{
      var cb=await apiFetch('/api/v4/snapshot/HEALTH').then(function(r){return r.json();}).catch(function(){return null;});
      if(cb&&cb.data&&cb.data.circuit_breakers){
        var openCbs=cb.data.circuit_breakers.filter(function(c){return c.state==='OPEN';});
        if(openCbs.length>0){
          hp.innerHTML+='<div style="margin-top:8px;padding:8px;background:rgba(255,107,107,0.1);border:1px solid var(--red);border-radius:6px;font-size:11px">'+
            '<span style="color:var(--red)">🔌 Circuit Breakers OPEN: </span>'+openCbs.map(function(c){return c.type;}).join(', ')+'</div>';
        }
      }
    }catch(e){}
    document.getElementById('health-updated').innerHTML=(d.updated_at?'Updated '+timeAgo(d.updated_at):'') + ' ' + staleBadge(hSnap);
  }catch(e){panelState('health-panel','error','Health unavailable');}
}

// ── v4.0 Providers (Phase 9 - full metadata) ──
async function loadProviders(){
  try{
    var free=await apiFetch('/api/providers').then(function(r){return r.json();}).catch(function(){return{providers:[]};});
    var paid=await apiFetch('/api/v4/providers/paid').then(function(r){return r.json();});
    var pp=document.getElementById('providers-panel');
    var rows='';
    if(free.providers){free.providers.forEach(function(p){
      // v5.1: Use computed_status from API (authoritative)
      var hState=p.computed_status||p.status||'UNKNOWN';
      var statusColors={HEALTHY:'var(--green)',UNUSED:'var(--muted)',STALE:'var(--gold)',DEGRADED:'var(--gold)',FAILING:'var(--red)',DISABLED:'var(--muted)',UNKNOWN:'var(--muted)'};
      var hCol=statusColors[hState]||'var(--muted)';
      // Quota bar — always show (unlimited = full green bar)
      var qPct=p.quota_pct||0;
      var qCol=qPct>90?'var(--red)':qPct>70?'var(--gold)':'var(--green)';
      var qLabel=p.daily_limit?(qPct+'% of '+p.daily_limit+'/day'):'\\u221e unlimited';
      var qBar='<div style=\"margin-top:4px\"><div style=\"height:4px;background:var(--border);border-radius:2px;position:relative\"><div style=\"height:4px;width:'+(p.daily_limit?Math.min(100,qPct):100)+'%;background:'+qCol+';border-radius:2px;transition:width .6s ease\"></div></div><div style=\"font-size:8px;color:var(--muted);margin-top:2px\">'+qLabel+'</div></div>';
      // Latency
      var lat=p.latency_ms!=null?p.latency_ms+'ms latency':'';
      // Last error
      var errHtml=p.last_error?'<div style="font-size:9px;color:var(--red);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px" title="'+safeRender(p.last_error)+'">⚠ '+safeRender(p.last_error.substring(0,60))+'</div>':'';
      // Calls
      var calls=(p.totalCalls||p.calls_today||0);
      rows+='<div class="prov-row" style="flex-direction:column;align-items:flex-start;padding:8px 12px">'+
        '<div style="display:flex;align-items:center;gap:8px;width:100%">'+
        '<div class="prov-dot" style="background:'+hCol+'"></div>'+
        '<span style="font-weight:600;font-size:12px">'+safeRender(p.name)+'</span>'+
        '<span class="ts" style="color:'+hCol+';margin-left:auto;font-weight:700">'+hState+'</span>'+
        (calls?'<span class="ts">'+calls+' calls</span>':'')+
        (lat?'<span class="ts">'+lat+'</span>':'')+
        '</div>'+
        qBar+errHtml+
        '</div>';
    });}
    rows+='<div style="margin:10px 12px 6px;font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:600;letter-spacing:.5px">Paid Placeholders ('+paid.activated+'/'+paid.total+' active)</div>';
    if(paid.providers){paid.providers.forEach(function(p){
      var pState=p.activated?'ENABLED':'DISABLED';
      var pCol=p.activated?'var(--green)':'var(--muted)';
      var envKey=p.env_key||p.envKey||p.env_flag||'';
      var enableFlag=p.enable_flag||p.envFlag||'';
      rows+='<div class="prov-row" style="flex-direction:column;align-items:flex-start;padding:8px 12px">'+
        '<div style="display:flex;align-items:center;gap:8px;width:100%">'+
        '<div class="prov-dot" style="background:'+(p.activated?'var(--green)':'var(--border)')+'"></div>'+
        '<span style="color:'+(p.activated?'var(--text)':'var(--muted)')+';font-weight:600">'+safeRender(p.name)+'</span>'+
        '<span class="ts" style="margin-left:auto;color:'+pCol+';font-weight:700">'+pState+'</span>'+
        '</div>'+
        (!p.activated?'<div style="font-size:9px;color:var(--muted);margin-top:3px;padding-left:14px">Enable: <code style="color:var(--accent)">'+safeRender(enableFlag||'N/A')+'=true</code> | Key: <code style="color:var(--accent)">'+safeRender(envKey||'N/A')+'</code></div>':'')+
        '</div>';
    });}
    pp.innerHTML=rows||'<div style="color:var(--muted)">No providers</div>';
  }catch(e){panelState('providers-panel','error','Providers unavailable');}
}

// ── v4.0 Run Logs ──
async function loadLogs(){
  try{
    var d=await apiFetch('/api/v4/run-logs').then(function(r){return r.json();});
    var lp=document.getElementById('logs-panel');
    var stats='<div style="padding:10px 16px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--border)">Total: '+(d.stats.total||0)+' | Errors: '+(d.stats.withErrors||0)+' | Avg: '+(d.stats.avgDuration||0)+'ms</div>';
    if(!d.runs||!d.runs.length){lp.innerHTML=stats+'<div style="padding:16px;color:var(--muted);text-align:center">Runs populate as commands execute</div>';return;}
    var rows=d.runs.slice(0,12).map(function(r){
      var cls=r.errors&&r.errors.length>0?'log-err':'log-ok';
      var dur=r.duration_ms?r.duration_ms+'ms':'...';
      var errs=r.errors&&r.errors.length>0?' ⚠'+r.errors.length:'';
      return '<div class="log-item"><span class="log-cmd">'+(r.command||'?')+'</span> '+(r.asset||'')+' <span class="'+cls+'">'+dur+errs+'</span> <span class="ts" style="float:right">'+timeAgo(r.started_at)+'</span></div>';
    }).join('');
    lp.innerHTML=stats+rows;
    document.getElementById('logs-updated').textContent=d.timestamp?timeAgo(d.timestamp):'';
  }catch(e){console.warn('Logs error',e);}
}

// ── v4.0 Feature Flags ──
async function loadFlags(){
  try{
    var d=await apiFetch('/api/v4/features').then(function(r){return r.json();});
    var fp=document.getElementById('flags-panel');
    if(!d.flags){fp.innerHTML='<div style="color:var(--muted)">No flags</div>';return;}
    var rows=Object.entries(d.flags).map(function(e){
      var name=e[0],f=e[1];
      return '<div class="flag-row"><span class="flag-icon">'+(f.enabled?'✅':'⬛')+'</span><span style="font-family:JetBrains Mono,monospace;font-size:11px">'+(f.env||name)+'</span><span class="ts" style="margin-left:auto">'+f.description+'</span></div>';
    }).join('');
    fp.innerHTML=rows;
  }catch(e){console.warn('Flags error',e);}
}

// ── Dynamic Session Bar ──
function updateSession(){
  var h=new Date().getUTCHours();
  var map=[{id:'s-asia',s:0,e:7},{id:'s-lon-open',s:7,e:8},{id:'s-london',s:8,e:12},{id:'s-overlap',s:12,e:16},{id:'s-ny',s:16,e:21},{id:'s-off',s:21,e:24}];
  map.forEach(function(w){
    var el=document.getElementById(w.id);
    if(el){
      var active=h>=w.s&&h<w.e;
      el.classList.toggle('sess-active',active);
      if(active) el.style.boxShadow='0 0 12px currentColor';
      else el.style.boxShadow='none';
    }
  });
  var cur=map.find(function(w){return h>=w.s&&h<w.e;});
  var qEl=document.getElementById('sess-quality');
  if(qEl&&cur){
    var labels={0:'🌙 Asia (Low Vol)',7:'⭐ London Open (HIGH)',8:'🇬🇧 London (Medium)',12:'⭐ Overlap (PEAK)',16:'🇺🇸 New York (Medium)',21:'🌑 Off-Hours (Low)'};
    qEl.innerHTML='<span style="color:var(--accent)">'+(labels[cur.s]||'Unknown')+'</span> | UTC '+h+':00';
  }
}
setInterval(updateSession,10000); updateSession();

// ── Timeframe selector ──
var currentTF = '60';
function setTF(btn){
  document.querySelectorAll('.cfp-tf').forEach(function(b){b.classList.remove('cfp-active');});
  btn.classList.add('cfp-active');
  currentTF = btn.getAttribute('data-tf');
  loadChart();
}

// ── Chart Viewer with snapshot status ──
async function loadChart(){
  var sym=document.getElementById('chart-asset').value;
  var cp=document.getElementById('chart-panel');
  var cs=document.getElementById('chart-status');
  cp.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px">Loading '+sym+' chart...</div>';
  cs.innerHTML='<span class="cfp-dot cfp-dot-off"></span><span style="color:var(--muted)">Loading...</span>';
  try{
    var d=await apiFetch('/api/v4/chart/'+sym+'?tf='+currentTF).then(function(r){return r.json();});
    if(d.chartUrl){
      cp.innerHTML='<img class="chart-frame" src="'+d.chartUrl+'" alt="'+sym+' chart" style="min-height:300px;object-fit:contain">';
      var dotCls = d.stale ? 'cfp-dot-stale' : 'cfp-dot-live';
      var stText = d.stale ? '⚠ STALE' : '🟢 LIVE';
      cs.innerHTML='<span class="cfp-dot '+dotCls+'"></span><span>'+stText+'</span><span style="color:var(--muted);font-size:9px">'+d.candles+' candles | '+safeRender(d.source||'—')+'</span>';
      document.getElementById('chart-updated').innerHTML='<span class="freshness '+(d.stale?'fresh-stale':'fresh-live')+'">'+(d.stale?'⚠ STALE':'🟢 LIVE')+'</span> '+safeRender(d.source||'');
    } else {
      cp.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px">Chart unavailable: '+(d.error||'No data')+'</div>';
      cs.innerHTML='<span class="cfp-dot cfp-dot-off"></span><span style="color:var(--red)">No data</span>';
    }
  }catch(e){
    cp.innerHTML='<div style="color:var(--red);padding:20px;text-align:center">Chart error</div>';
    cs.innerHTML='<span class="cfp-dot cfp-dot-off"></span><span style="color:var(--red)">Error</span>';
  }
  loadIndicators(sym);
  loadStrategies(sym);
}

// ── Expert Indicators with full cards ──
async function loadIndicators(sym){
  if(!sym) sym=document.getElementById('chart-asset').value;
  try{
    var d=await apiFetch('/api/v4/indicators/'+sym).then(function(r){return r.json();});
    if(d.error){document.getElementById('ind-panel').innerHTML='<div style="padding:16px;color:var(--muted)">'+d.error+'</div>';return;}
    var sc=function(sig){return sig==='BULLISH'||sig==='OVERBOUGHT'||sig==='TRENDING'?'sig-bull':sig==='BEARISH'||sig==='OVERSOLD'||sig==='RANGING'?'sig-bear':'sig-neutral';};
    var bb=d.bollinger||{};
    var st=d.stochastic||{};
    var ao=d.awesome_oscillator||{};
    var sqCls=bb.squeeze_state==='SQUEEZE'?'sig-squeeze':bb.squeeze_state==='EXPANSION'?'sig-expansion':'sig-neutral';
    var stZoneCls=st.zone==='oversold'?'sig-bull':st.zone==='overbought'?'sig-bear':'sig-neutral';
    var aoCls=ao.color==='green'?'sig-bull':'sig-bear';
    // Stale badge for indicators
    var isStale=d.stale===true;
    var staleBdg=isStale?'<span class="freshness fresh-stale">⚠ STALE</span>':'<span class="freshness fresh-live">🟢 LIVE</span>';
    var ageInfo=d.candle_age_seconds!=null?' (candle: '+d.candle_age_seconds+'s ago)':'';
    document.getElementById('ind-panel').innerHTML=
      '<div class="ind-grid">'+
      '<div class="ind-card"><div class="ind-val">'+d.rsi+'</div><div class="ind-lbl">RSI(14)</div><div class="ind-sig '+sc(d.rsi_signal)+'">'+d.rsi_signal+'</div></div>'+
      '<div class="ind-card"><div class="ind-val">'+d.macd+'</div><div class="ind-lbl">MACD Hist</div><div class="ind-sig '+sc(d.macd_signal)+'">'+d.macd_signal+'</div></div>'+
      '<div class="ind-card"><div class="ind-val">'+d.adx+'</div><div class="ind-lbl">ADX</div><div class="ind-sig '+sc(d.adx_signal)+'">'+d.adx_signal+'</div><div class="ind-sub">DI+ '+((d.di_plus||0).toFixed?d.di_plus.toFixed(1):d.di_plus)+' / DI- '+((d.di_minus||0).toFixed?d.di_minus.toFixed(1):d.di_minus)+'</div></div>'+
      '<div class="ind-card '+(bb.squeeze_state==='SQUEEZE'?'ind-warn':bb.squeeze_state==='EXPANSION'?'ind-highlight':'')+'"><div class="ind-val">'+(bb.pct_b!=null?bb.pct_b.toFixed(3):'—')+'</div><div class="ind-lbl">BB %B</div><div class="ind-sig '+sqCls+'">'+(bb.squeeze_state||'—')+'</div><div class="ind-sub">BW: '+(bb.bandwidth||'—')+'</div></div>'+
      '<div class="ind-card '+(st.zone==='oversold'?'ind-highlight':st.zone==='overbought'?'ind-danger':'')+'"><div class="ind-val">'+(st.k!=null?st.k.toFixed(1):'—')+'</div><div class="ind-lbl">Stoch K/D</div><div class="ind-sig '+stZoneCls+'">'+(st.zone||'—').toUpperCase()+'</div><div class="ind-sub">D: '+(st.d!=null?st.d.toFixed(1):'—')+' '+(st.crossover||'')+'</div></div>'+
      '<div class="ind-card"><div class="ind-val">'+(ao.value!=null?ao.value.toFixed(2):'—')+'</div><div class="ind-lbl">Awesome Osc</div><div class="ind-sig '+aoCls+'">'+(ao.color||'—').toUpperCase()+'</div><div class="ind-sub">'+(ao.flip?'⚡ FLIP':'—')+'</div></div>'+
      '<div class="ind-card"><div class="ind-val">'+(d.atr!=null?d.atr.toFixed(4):'—')+'</div><div class="ind-lbl">ATR(14)</div><div class="ind-sub">0.5× '+(d.atr_05||'—')+' | 1× '+(d.atr_10||'—')+' | 1.5× '+(d.atr_15||'—')+'</div></div>'+
      '<div class="ind-card"><div class="ind-val">'+d.ema20+'</div><div class="ind-lbl">EMA 20</div></div>'+
      '<div class="ind-card"><div class="ind-val">'+d.ema50+'</div><div class="ind-lbl">EMA 50</div></div>'+
      '</div>'+
      '<div style="padding:8px 12px;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">'+
        '<span>Price: $'+d.price+' | Trend: <span style="color:'+(d.trend==='BULLISH'?'var(--green)':'var(--red)')+'">'+d.trend+'</span> | Source: '+safeRender(d.source||'—')+'</span>'+
        '<span>'+staleBdg+ageInfo+'</span>'+
      '</div>';
    document.getElementById('ind-updated').innerHTML=staleBdg+' '+timeAgo(d.timestamp);
  }catch(e){}
}

// ── Strategies ──
async function loadStrategies(sym){
  if(!sym) sym=document.getElementById('chart-asset').value;
  try{
    var d=await apiFetch('/api/v4/strategies/'+sym).then(function(r){return r.json();});
    var sp=document.getElementById('strat-panel');
    var regCol={TRENDING:'var(--green)',RANGING:'var(--gold)',VOLATILE:'var(--red)',BREAKOUT:'var(--accent)'};
    // Safely extract regime — could be string or {regime, confidence, description}
    var regimeStr = typeof d.regime === 'object' ? (d.regime.regime || safeRender(d.regime)) : (d.regime || 'UNKNOWN');
    var regimeConf = typeof d.regime === 'object' ? d.regime.confidence : null;
    var regimeDesc = typeof d.regime === 'object' ? d.regime.description : null;
    var html='<div style="margin-bottom:12px;font-size:14px;font-weight:700">'+sym+' — <span style="color:'+(regCol[regimeStr]||'var(--muted)')+'">'+regimeStr+'</span>'+(regimeConf?' <span style="font-size:11px;color:var(--muted)">('+regimeConf+'%)</span>':'')+'</div>';
    if(regimeDesc) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:8px">'+regimeDesc+'</div>';
    var s=d.strategies||{};
    if(s.active&&s.active.length){html+='<div class="strat-section"><div class="strat-label">✅ Active</div>'+s.active.map(function(t){return '<span class="strat-tag strat-active">'+safeRender(t).replace(/_/g,' ')+'</span>';}).join('')+'</div>';}
    if(s.watchlist&&s.watchlist.length){html+='<div class="strat-section"><div class="strat-label">👀 Watchlist</div>'+s.watchlist.map(function(t){return '<span class="strat-tag strat-watch">'+safeRender(t).replace(/_/g,' ')+'</span>';}).join('')+'</div>';}
    if(s.avoid&&s.avoid.length){html+='<div class="strat-section"><div class="strat-label">🚫 Avoid</div>'+s.avoid.map(function(t){return '<span class="strat-tag strat-avoid">'+safeRender(t).replace(/_/g,' ')+'</span>';}).join('')+'</div>';}
    if(s.confirmation) html+='<div style="font-size:11px;color:var(--muted);margin-top:8px">⚠️ '+safeRender(s.confirmation)+'</div>';
    if(s.indicators&&s.indicators.length) html+='<div style="font-size:10px;color:var(--accent);margin-top:6px">📐 '+s.indicators.join(', ')+'</div>';
    sp.innerHTML=html;
    document.getElementById('strat-updated').textContent=timeAgo(d.timestamp);
  }catch(e){}
}

// ── Crypto Trending (snapshot-backed) ──
async function loadTrending(){
  try{
    var d=await apiFetch('/api/v4/crypto/trending').then(function(r){return r.json();});
    var tp=document.getElementById('trending-panel');
    var isStale=d.stale===true;
    var badge=isStale?'<span class="freshness fresh-stale">⚠ STALE</span>':'<span class="freshness fresh-live">🟢 LIVE</span>';
    document.getElementById('trend-updated').innerHTML=badge+' '+(d.cache_age_seconds!=null?d.cache_age_seconds+'s ago':'');
    if(!d.trending||!d.trending.length){
      tp.innerHTML='<div style="padding:16px;color:var(--muted);text-align:center">'+(isStale?'⚠ No cached data':'No trending data')+'</div>';
      return;
    }
    tp.innerHTML=d.trending.map(function(c){
      return '<div class="crypto-row"><img class="crypto-img" src="'+c.thumb+'" alt=""><span class="crypto-name">'+safeRender(c.name)+' ('+safeRender(c.symbol)+')</span><span class="ts">#'+c.rank+'</span></div>';
    }).join('');
  }catch(e){}
}

// ── Crypto Top 10 (snapshot-backed) ──
async function loadTop(){
  try{
    var d=await apiFetch('/api/v4/crypto/top').then(function(r){return r.json();});
    var tp=document.getElementById('top-panel');
    var isStale=d.stale===true;
    var badge=isStale?'<span class="freshness fresh-stale">⚠ STALE</span>':'<span class="freshness fresh-live">🟢 LIVE</span>';
    document.getElementById('top-updated').innerHTML=badge+' '+(d.cache_age_seconds!=null?d.cache_age_seconds+'s ago':'');
    if(!d.coins||!d.coins.length){
      tp.innerHTML='<div style="padding:16px;color:var(--muted);text-align:center">'+(isStale?'⚠ Using last cached data':'No data available')+'</div>';
      return;
    }
    tp.innerHTML=d.coins.map(function(c){
      var chg=c.change24h||0;
      var chgCol=chg>0?'var(--green)':'var(--red)';
      return '<div class="crypto-row"><img class="crypto-img" src="'+c.image+'" alt=""><span class="crypto-name">'+safeRender(c.symbol)+'</span><span class="crypto-price">$'+(c.price>=1?c.price.toLocaleString():c.price.toFixed(4))+'</span><span style="color:'+chgCol+';font-size:11px;font-weight:600;min-width:60px;text-align:right">'+(chg>0?'+':'')+chg.toFixed(2)+'%</span></div>';
    }).join('');
  }catch(e){}
}

// ── Scrolling Signal Ticker (with freshness) ──
async function loadSignalTicker(){
  try{
    var sigs=await apiFetch('/api/signals').then(function(r){return r.json();});
    var st=document.getElementById('signal-ticker-inner');
    if(!sigs||!sigs.length){st.innerHTML='<span style="color:var(--muted)">No signals yet</span>';return;}
    // Check if all signals are >2h old
    var now=Date.now();
    var allStale=sigs.slice(0,10).every(function(s){
      var t=s.created_at||s.timestamp;
      return t && (now-new Date(t).getTime())>7200000;
    });
    if(allStale){
      var warn='<span class="st-item" style="background:rgba(255,193,7,.12);color:var(--gold);border:1px solid rgba(255,193,7,.3)">⚠ STALE &mdash; signals >2h old</span>';
      st.innerHTML=warn;
      return;
    }
    var items=sigs.slice(0,10).map(function(s){
      var act=s.final_action||s.direction||'WAIT';
      var cls={BUY:'st-buy',SELL:'st-sell'}[act]||'st-wait';
      var icon={BUY:'🟢',SELL:'🔴',WAIT:'⏳',WATCHLIST:'📋'}[act]||'ℹ️';
      var t=s.created_at||s.timestamp;
      var age=t?' · '+timeAgo(t):'';
      return '<span class="st-item '+cls+'">'+icon+' '+safeRender(s.asset||'?')+' '+act+' '+(s.institutional_score||s.score||0)+'/100'+age+'</span>';
    }).join('');
    st.innerHTML=items+items;
  }catch(e){}
}
// ── API Usage ──
async function loadApiUsage(){
  try{
    var d=await apiFetch('/api/api-usage').then(function(r){return r.json();});
    var ap=document.getElementById('api-usage-panel');
    if(!d||d.error){ap.innerHTML='<div style=\"color:var(--muted);text-align:center\">No data</div>';return;}
    var quotas=d.quotas||[];
    if(!quotas.length){var u=d.usage||d;var cards='';Object.entries(u).forEach(function(e){var v=typeof e[1]==='object'?JSON.stringify(e[1]):e[1];cards+='<div class=\"api-card\"><div class=\"api-ct\">'+v+'</div><div class=\"api-nm\">'+e[0]+'</div></div>';});ap.innerHTML='<div class=\"api-grid\">'+cards+'</div>';return;}
    var rows=quotas.map(function(q){
      var tierCol=q.tier==='free'?'var(--green)':q.tier==='local'?'var(--accent)':'var(--muted)';
      return '<div style=\"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)\">'
        +'<span style=\"width:110px;font-size:11px;font-weight:600;color:var(--text)\">'+q.name+'</span>'
        +'<span style=\"font-size:9px;padding:1px 5px;border-radius:6px;background:rgba(255,255,255,.06);color:'+tierCol+'\">'+q.tier+'</span>'
        +'<span style=\"font-size:11px;color:var(--accent);margin-left:auto\">'+q.total+' calls</span>'
        +(q.errors>0?'<span style=\"font-size:9px;color:var(--red)\">'+q.errors+' err</span>':'')
        +'</div>';
    }).join('');
    ap.innerHTML='<div style=\"font-size:10px;color:var(--muted);margin-bottom:8px\">'+quotas.length+' providers tracked | '+new Date(d.timestamp||Date.now()).toLocaleTimeString()+'</div>'+rows;
  }catch(e){}
}
// ── Signal History ──
async function loadSignalHistory(){
  try{
    var filter=(document.getElementById('sig-filter')||{}).value||'';
    var url='/api/signals/history'+(filter?'?asset='+filter:'');
    var d=await apiFetch(url).then(function(r){return r.json();});
    var hp=document.getElementById('signal-history-panel');
    var sigs=d.snapshots||d||[];
    if(!sigs.length){hp.innerHTML='<div style=\"padding:16px;color:var(--muted);text-align:center\">No history</div>';return;}
    hp.innerHTML=sigs.slice(0,25).map(function(s){
      var act=s.final_action||s.direction||'?';
      var col={BUY:'var(--green)',SELL:'var(--red)',WAIT:'var(--gold)',WATCHLIST:'var(--accent)',REJECTED:'#444'}[act]||'var(--muted)';
      var icon={BUY:'\ud83d\udfe2',SELL:'\ud83d\udd34',WAIT:'\u23f3',WATCHLIST:'\ud83d\udccb',REJECTED:'\ud83d\udeab'}[act]||'\u2139\ufe0f';
      var stCls={BUY:'state-buy',SELL:'state-sell',WAIT:'state-wait',WATCHLIST:'state-watchlist',REJECTED:'state-rejected'}[act]||'';
      var setup=s.setup_type||s.setup_label||'';
      var setupHtml=setup?'<span class=\"setup-badge\">'+safeRender(setup).replace(/_/g,' ').toUpperCase()+'</span>':'';
      var score=s.total_score||s.institutional_score||s.score||s.confidence||0;
      var sess=s.session||'';
      var rr=s.rr_value?'R:R '+s.rr_value:'';
      var snapAge=s.created_at?timeAgo(s.created_at):'';
      var vetoHtml='';
      if(s.veto_summary&&s.veto_summary.length){vetoHtml='<div class=\"veto-note\">\u26d4 '+s.veto_summary[0]+'</div>';}
      else if(s.why_not_trade&&s.why_not_trade.length&&(act==='WAIT'||act==='REJECTED')){vetoHtml='<div class=\"ts\" style=\"color:var(--red);margin-top:2px\">\u21b3 '+s.why_not_trade[0]+'</div>';}
      var whyHtml='';
      if(s.why_trade&&s.why_trade.length&&(act==='BUY'||act==='SELL')){whyHtml='<div class=\"signal-reason\" style=\"color:var(--green);font-size:11px\">\u2705 '+s.why_trade[0]+'</div>';}
      return '<div class=\"signal-item '+stCls+'\"><div class=\"signal-header\"><span class=\"signal-asset\">'+(s.asset||'?')+'</span><span style=\"color:'+col+';font-weight:700\">'+icon+' '+act+'</span>'+setupHtml+'<span class=\"ts\" style=\"margin-left:auto\">'+timeAgo(s.created_at||s.createdAt)+'</span></div>'+whyHtml+vetoHtml+'<div class=\"ts\" style=\"margin-top:4px\">Score: '+score+'/100'+(sess?' | '+sess:'')+(rr?' | '+rr:'')+'</div></div>';
    }).join('');
  }catch(e){}
}
// ── Journal ──
async function loadJournal(){
  try{
    var d=await apiFetch('/api/stats').then(function(r){return r.json();});
    var jp=document.getElementById('journal-panel');
    var m=d.monthly||{};
    jp.innerHTML='<table class=\"journal-table\"><tr><th>Metric</th><th>Value</th></tr>'+
      '<tr><td>Signals Sent</td><td>'+(d.sentToTelegram||0)+'</td></tr>'+
      '<tr><td>Watchlist Active</td><td>'+(d.watchlistActive||0)+'</td></tr>'+
      '<tr><td>Uptime</td><td>'+Math.floor((d.uptime||0)/3600)+'h</td></tr>'+
      (m.totalSignals?'<tr><td>Monthly Signals</td><td>'+m.totalSignals+'</td></tr>':'')+
      (m.avgScore?'<tr><td>Avg Score</td><td>'+m.avgScore+'/100</td></tr>':'')+
      '</table>';
  }catch(e){}
}

// ── v4.0: Veto Decomposition Panel ──
async function loadVetoPanel(){
  try{
    var d=await apiFetch('/api/signals/history').then(function(r){return r.json();});
    var vp=document.getElementById('veto-panel');
    var vu=document.getElementById('veto-updated');
    var sigs=d.snapshots||d||[];
    if(!sigs.length){vp.innerHTML='<div style=\"color:var(--muted);text-align:center\">No signal data to analyze</div>';return;}
    // Aggregate veto reasons from rejected/wait signals
    var vetoCounts={};
    var totalBlocked=0;
    var totalPassed=0;
    sigs.forEach(function(s){
      var act=s.final_action||s.direction||'';
      if(act==='REJECTED'||act==='WAIT'){
        totalBlocked++;
        var reasons=(s.veto_summary||[]).concat(s.why_not_trade||[]);
        reasons.forEach(function(r){
          if(!r)return;
          var key=r.length>60?r.substring(0,60)+'...':r;
          vetoCounts[key]=(vetoCounts[key]||0)+1;
        });
      } else {
        totalPassed++;
      }
    });
    var sorted=Object.entries(vetoCounts).sort(function(a,b){return b[1]-a[1];}).slice(0,8);
    var maxCount=sorted.length?sorted[0][1]:1;
    var passRate=sigs.length?Math.round(totalPassed/sigs.length*100):0;
    var passCol=passRate>=50?'var(--green)':passRate>=25?'var(--gold)':'var(--red)';
    var html='<div style=\"display:flex;gap:16px;margin-bottom:12px\">';
    html+='<div style=\"text-align:center;flex:1\"><div style=\"font-size:20px;font-weight:700;color:'+passCol+'\">'+passRate+'%</div><div style=\"font-size:9px;color:var(--muted)\">PASS RATE</div></div>';
    html+='<div style=\"text-align:center;flex:1\"><div style=\"font-size:20px;font-weight:700;color:var(--red)\">'+totalBlocked+'</div><div style=\"font-size:9px;color:var(--muted)\">BLOCKED</div></div>';
    html+='<div style=\"text-align:center;flex:1\"><div style=\"font-size:20px;font-weight:700;color:var(--green)\">'+totalPassed+'</div><div style=\"font-size:9px;color:var(--muted)\">PASSED</div></div>';
    html+='</div>';
    if(sorted.length){
      html+='<div style=\"font-size:10px;color:var(--muted);margin-bottom:8px;font-weight:600\">TOP REJECTION REASONS</div>';
      sorted.forEach(function(e){
        var pct=Math.round(e[1]/maxCount*100);
        html+='<div class=\"score-row\" style=\"margin-bottom:5px\"><span style=\"font-size:10px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\" title=\"'+e[0]+'\">'+e[0]+'</span><div style=\"width:60px;height:4px;background:var(--border);border-radius:2px;flex-shrink:0\"><div style=\"height:100%;width:'+pct+'%;background:var(--red);border-radius:2px\"></div></div><span style=\"font-size:9px;color:var(--muted);width:20px;text-align:right;flex-shrink:0\">'+e[1]+'</span></div>';
      });
    } else {
      html+='<div style=\"color:var(--green);text-align:center;font-size:12px\">\u2705 All signals passing — no vetoes triggered</div>';
    }
    vp.innerHTML=html;
    if(vu)vu.textContent=new Date().toLocaleTimeString();
  }catch(e){}
}

// ── v4.0: Event Risk Status Panel ──
async function loadEventRisk(){
  try{
    var d=await apiFetch('/api/news').then(function(r){return r.json();});
    var ep=document.getElementById('event-risk-panel');
    var eu=document.getElementById('event-updated');
    var headlines=d||[];
    if(!headlines.length){ep.innerHTML='<div style=\"color:var(--muted);text-align:center\">\ud83d\udfe2 No headlines — event risk LOW</div>';return;}
    // Scan for high-impact keywords
    var HIGH_EVENTS=['FOMC','CPI','NFP','GDP','rate decision','interest rate','Fed','ECB','BOJ','central bank','inflation','employment'];
    var MED_EVENTS=['PMI','earnings','oil','OPEC','tariff','sanctions','crisis','war','election'];
    var highHits=[];
    var medHits=[];
    headlines.slice(0,30).forEach(function(h){
      var t=(h.title||'').toLowerCase();
      HIGH_EVENTS.forEach(function(e){if(t.includes(e.toLowerCase()))highHits.push({event:e,headline:h.title,source:h.source,age:Math.round((Date.now()-new Date(h.savedAt).getTime())/60000)});});
      MED_EVENTS.forEach(function(e){if(t.includes(e.toLowerCase())&&!highHits.some(function(hh){return hh.headline===h.title;}))medHits.push({event:e,headline:h.title,source:h.source,age:Math.round((Date.now()-new Date(h.savedAt).getTime())/60000)});});
    });
    var level=highHits.length?'HIGH':medHits.length?'MEDIUM':'LOW';
    var levelCol={HIGH:'var(--red)',MEDIUM:'var(--gold)',LOW:'var(--green)'}[level];
    var levelIcon={HIGH:'\ud83d\udd34',MEDIUM:'\ud83d\udfe1',LOW:'\ud83d\udfe2'}[level];
    var html='<div style=\"display:flex;align-items:center;gap:12px;margin-bottom:12px\">';
    html+='<div style=\"font-size:28px\">'+levelIcon+'</div>';
    html+='<div><div style=\"font-size:16px;font-weight:700;color:'+levelCol+'\">'+level+' RISK</div>';
    html+='<div style=\"font-size:10px;color:var(--muted)\">'+highHits.length+' high-impact | '+medHits.length+' medium-impact events</div></div></div>';
    var allHits=highHits.concat(medHits).slice(0,4);
    if(allHits.length){
      allHits.forEach(function(h){
        var isHigh=highHits.includes(h);
        html+='<div style=\"padding:6px 0;border-bottom:1px solid var(--border);font-size:11px\">';
        html+='<span style=\"color:'+(isHigh?'var(--red)':'var(--gold)')+';font-weight:700\">'+(isHigh?'\u26a0\ufe0f':'\u2139\ufe0f')+' '+h.event.toUpperCase()+'</span>';
        html+=' <span style=\"color:var(--muted)\">'+h.age+'m ago</span>';
        html+='<div style=\"color:var(--text);font-size:10px;margin-top:2px;opacity:.8\">'+h.headline.substring(0,80)+'</div></div>';
      });
    }
    if(level==='HIGH'){html+='<div style=\"margin-top:8px;padding:8px;background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.2);border-radius:8px;font-size:10px;color:var(--red);font-weight:600\">\u26a0\ufe0f Position size should be 50% of normal during high event risk</div>';}
    ep.innerHTML=html;
    if(eu)eu.textContent=new Date().toLocaleTimeString();
  }catch(e){}
}

// ── v3.3: Strategy Router Panel ──
async function loadStrategyPanel(){
  try{
    var d=await apiFetch('/api/v4/strategy-router').then(function(r){return r.json();});
    var sp=document.getElementById('strat-route-panel');
    var su=document.getElementById('strat-updated');
    if(!d.strategies||!d.strategies.length){sp.innerHTML='<div style="color:var(--muted);text-align:center">No strategy data</div>';return;}
    var stateIcons={ACTIVE:'\ud83d\udfe2',WATCHLIST:'\ud83d\udfe1',AVOID:'\ud83d\udd34'};
    var stateCols={ACTIVE:'var(--green)',WATCHLIST:'var(--gold)',AVOID:'var(--red)'};
    var counts={ACTIVE:0,WATCHLIST:0,AVOID:0};
    d.strategies.forEach(function(s){counts[s.state]=(counts[s.state]||0)+1;});
    var html='<div style="display:flex;gap:12px;margin-bottom:12px">';
    html+='<div style="text-align:center;flex:1"><div style="font-size:18px;font-weight:700;color:var(--green)">'+counts.ACTIVE+'</div><div style="font-size:9px;color:var(--muted)">ACTIVE</div></div>';
    html+='<div style="text-align:center;flex:1"><div style="font-size:18px;font-weight:700;color:var(--gold)">'+counts.WATCHLIST+'</div><div style="font-size:9px;color:var(--muted)">WATCHLIST</div></div>';
    html+='<div style="text-align:center;flex:1"><div style="font-size:18px;font-weight:700;color:var(--red)">'+counts.AVOID+'</div><div style="font-size:9px;color:var(--muted)">AVOID</div></div>';
    html+='</div>';

    // v5.0 Dynamic Strategy Swapping UI
    var regimeColor = d.regime === 'TRENDING' ? 'var(--cyan)' : d.regime === 'RANGING' ? 'var(--gold)' : 'var(--muted)';
    html+='<div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:12px;border-left:3px solid '+regimeColor+'">';
    html+='<div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px">Current Market Context</div>';
    html+='<div style="font-size:12px;font-weight:600;color:var(--fg)">Session: <span style="color:var(--accent)">'+safeRender(d.session||'unknown')+'</span> | Regime: <span style="color:'+regimeColor+'">'+safeRender(d.regime||'unknown')+'</span></div>';
    
    // Strategy Rationale Sub-panel
    var rationale = d.regime === 'TRENDING' ? 'Momentum strategies active. Trend-following indicators (MACD/ADX) prioritized over mean-reversion.' 
                  : d.regime === 'RANGING' ? 'Mean-reversion strategies active. Boundary indicators (BB/RSI) prioritized over trend following.'
                  : 'Awaiting sufficient volatility expansion to classify regime.';
    html+='<div style="font-size:10px;color:var(--muted);margin-top:6px;font-style:italic">Rationale: '+rationale+'</div>';
    html+='</div>';

    d.strategies.forEach(function(s){
      var icon=stateIcons[s.state]||'\u26aa';
      var col=stateCols[s.state]||'var(--muted)';
      html+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px">';
      html+='<span>'+icon+'</span>';
      html+='<span style="font-weight:600;flex:1">'+safeRender(s.name)+'</span>';
      html+='<span style="color:'+col+';font-weight:700;font-size:10px">'+s.state+'</span>';
      html+='</div>';
      if(s.reason){html+='<div style="font-size:9px;color:var(--muted);padding:2px 0 4px 24px">'+safeRender(s.reason.substring(0,80))+'</div>';}
    });
    sp.innerHTML=html;
    if(su)su.textContent=new Date().toLocaleTimeString();
  }catch(e){}
}

// ── v3.4: Learning Panel ──
async function loadLearningPanel(){
  var lp=document.getElementById('learning-panel');
  var lu=document.getElementById('learning-updated');
  var lb=document.getElementById('learning-stale-badge');
  try{
    var d=await apiFetch('/api/v4/learning-status').then(function(r){return r.json();});
    if(lb)lb.innerHTML=d.mature?'<span style="background:rgba(52,211,153,.15);color:var(--green);padding:2px 7px;border-radius:4px;font-size:9px">✅ MATURE</span>':'<span style="background:rgba(255,193,7,.15);color:var(--gold);padding:2px 7px;border-radius:4px;font-size:9px">⚠ BUILDING</span>';
    var sl=d.safety_locks||{};
    var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">';
    html+='<div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--accent)">'+d.total_outcomes+'</div><div style="font-size:9px;color:var(--muted)">OUTCOMES</div></div>';
    html+='<div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--accent)">'+d.total_signals+'</div><div style="font-size:9px;color:var(--muted)">SIGNALS</div></div>';
    html+='</div>';
    html+='<div style="font-size:10px;color:var(--muted);margin-bottom:6px;font-weight:600">SAFETY LOCKS</div>';
    html+='<div style="font-size:10px;line-height:1.8">';
    html+='<div>🚫 Remove vetoes: <b style="color:var(--green)">LOCKED</b></div>';
    html+='<div>🚫 Activate broker: <b style="color:var(--green)">LOCKED</b></div>';
    html+='<div>🚫 Paid providers: <b style="color:var(--green)">LOCKED</b></div>';
    html+='<div>⚡ Max weight Δ/week: <b style="color:var(--accent)">±'+d.max_weekly_weight_change+'</b></div>';
    html+='</div>';
    if(!d.mature){html+='<div style="margin-top:8px;padding:6px;background:rgba(255,193,7,.1);border:1px solid rgba(255,193,7,.2);border-radius:6px;font-size:9px;color:var(--gold)">⚠ Need '+d.min_sample_size+' outcomes for recommendations (have '+d.total_outcomes+')</div>';}
    lp.innerHTML=html;
    if(lu)lu.textContent=new Date().toLocaleTimeString();
  }catch(e){
    if(lp)lp.innerHTML='<div style="color:var(--muted);text-align:center;padding:12px">Learning data unavailable</div>';
    if(lb)lb.innerHTML='<span style="background:rgba(255,69,69,.15);color:var(--red);padding:2px 7px;border-radius:4px;font-size:9px">❌ ERROR</span>';
  }
}

// ── v3.4: Replay/Backtest Panel ──
async function loadReplayPanel(){
  var rp=document.getElementById('replay-panel');
  var ru=document.getElementById('replay-updated');
  var rb=document.getElementById('replay-stale-badge');
  try{
    var d=await apiFetch('/api/v4/replay-results').then(function(r){return r.json();});
    var results=d.results||[];
    if(rb)rb.innerHTML='<span style="background:rgba(52,211,153,.15);color:var(--green);padding:2px 7px;border-radius:4px;font-size:9px">✅ LIVE</span>';
    if(!results.length){
      rp.innerHTML='<div style="color:var(--muted);text-align:center;padding:12px">No recent replays or backtests.<br><span style="font-size:10px">Use /replay or /backtest-recent in Telegram</span></div>';
      if(ru)ru.textContent=new Date().toLocaleTimeString();
      return;
    }
    var html=results.slice(0,5).map(function(r){
      var changed=r.decision_changed;
      var col=changed?'var(--gold)':'var(--green)';
      var type=r.type||'REPLAY';
      var sym=safeRender(r.symbol||'?');
      var ts=r.replay_timestamp?timeAgo(r.replay_timestamp):'';
      var diff=r.diff_summary||r.win_rate_pct!=null?'Win rate: '+r.win_rate_pct+'%':'';
      return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:11px">'
        +'<div style="display:flex;justify-content:space-between"><b>'+type+' — '+sym+'</b><span style="color:var(--muted);font-size:9px">'+ts+'</span></div>'
        +(changed?'<div style="color:'+col+';font-size:10px;margin-top:2px">⚡ '+safeRender(r.diff_summary||'Decision changed')+'</div>':'<div style="color:var(--green);font-size:10px">✅ No change</div>')
        +(diff&&!changed?'<div style="color:var(--accent);font-size:10px">'+safeRender(diff)+'</div>':'')+'</div>';
    }).join('');
    rp.innerHTML='<div style="font-size:9px;color:var(--muted);margin-bottom:6px;font-style:italic">⚠ Backtest results are APPROXIMATE — not live performance</div>'+html;
    if(ru)ru.textContent=new Date().toLocaleTimeString();
  }catch(e){
    if(rp)rp.innerHTML='<div style="color:var(--muted);text-align:center;padding:12px">No replay data yet</div>';
    if(rb)rb.innerHTML='<span style="background:rgba(100,100,100,.15);color:var(--muted);padding:2px 7px;border-radius:4px;font-size:9px">— N/A</span>';
  }
}

// ── v3.4: Indicator Intelligence Panel ──
async function loadIndicatorIntel(){
  var ip=document.getElementById('indic-intel-panel');
  var iu=document.getElementById('indic-updated');
  var ib=document.getElementById('indic-stale-badge');
  try{
    var d=await apiFetch('/api/v4/indicator-intelligence').then(function(r){return r.json();});
    if(ib)ib.innerHTML=d.stale?'<span style="background:rgba(255,193,7,.15);color:var(--gold);padding:2px 7px;border-radius:4px;font-size:9px">⚠ STALE</span>':'<span style="background:rgba(52,211,153,.15);color:var(--green);padding:2px 7px;border-radius:4px;font-size:9px">✅ LIVE</span>';
    var ind=d.indicators||{};
    var conf=ind.confluence||{};
    var html='';
    if(conf.timing_confirmation){
      var tcol={BULLISH_TIMING_CONFIRMED:'var(--green)',BULLISH_TIMING_PARTIAL:'var(--green)',BEARISH_TIMING_CONFIRMED:'var(--red)',BEARISH_TIMING_PARTIAL:'var(--red)',CONFLICT_WARNING:'var(--gold)',NEUTRAL_NO_EDGE:'var(--muted)'}[conf.timing_confirmation]||'var(--muted)';
      html+='<div style="margin-bottom:10px"><span style="font-size:12px;font-weight:700;color:'+tcol+'">'+conf.timing_confirmation.replace(/_/g,' ')+'</span></div>';
    }
    if(ind.bollinger){
      var bb=ind.bollinger;
      html+='<div style="font-size:10px;margin-bottom:4px"><b>BB:</b> %B='+bb.pct_b+' | '+bb.squeeze_state+' | '+(bb.upper_stretch?'🔴 UPPER STRETCH':bb.lower_stretch?'🟢 LOWER STRETCH':bb.interpretation||'mid')+'</div>';
    }
    if(ind.stochastic){
      var st=ind.stochastic;
      html+='<div style="font-size:10px;margin-bottom:4px"><b>Stoch:</b> K='+st.k+' D='+st.d+' | '+st.exhaustion_state+'</div>';
    }
    if(ind.awesome_oscillator){
      var ao=ind.awesome_oscillator;
      html+='<div style="font-size:10px;margin-bottom:4px"><b>AO:</b> '+ao.zero_line_state+' | '+ao.flip_state+' | '+ao.momentum_shift+'</div>';
    }
    if(ind.atr){
      html+='<div style="font-size:10px;margin-bottom:8px"><b>ATR:</b> '+ind.atr.volatility_regime+' (value: '+ind.atr.value+')</div>';
    }
    html+='<div style="font-size:9px;padding:5px;background:rgba(99,102,241,.08);border-radius:5px;color:var(--muted)">🔒 Indicators are timing filters only — BUY/SELL requires signal_verifier</div>';
    ip.innerHTML=html||'<div style="color:var(--muted);text-align:center">Run /scalp to populate</div>';
    if(iu)iu.textContent=new Date().toLocaleTimeString();
  }catch(e){
    if(ip)ip.innerHTML='<div style="color:var(--muted);text-align:center;padding:12px">No indicator data yet. Run a signal to populate.</div>';
  }
}

setInterval(function(){loadAll();loadPrices();loadFearGreed();loadAnalyses();loadHealth();loadProviders();loadLogs();loadFlags();updateSession();loadSignalTicker();loadApiUsage();loadSyncHealth();loadEventRisk();loadLearningPanel();loadIndicatorIntel();}, 20000);
setInterval(function(){loadTrending();loadTop();loadSignalHistory();loadJournal();loadVetoPanel();loadStrategyPanel();loadReplayPanel();}, 60000);
loadAll();loadPrices();loadFearGreed();loadAnalyses();loadHealth();loadProviders();loadLogs();loadFlags();loadTrending();loadTop();loadChart();loadSignalTicker();loadApiUsage();loadSignalHistory();loadJournal();loadSyncHealth();loadVetoPanel();loadEventRisk();loadStrategyPanel();loadLearningPanel();loadReplayPanel();loadIndicatorIntel();
</script>
</body></html>`;


// v3.4: Structured JSON log helper (Phase 11 ops)
const DASH_LOG_DIR = require('path').join(__dirname, 'logs');
if (!require('fs').existsSync(DASH_LOG_DIR)) { try { require('fs').mkdirSync(DASH_LOG_DIR, { recursive: true }); } catch {} }
function jsonLog(source, event, meta) {
    try {
        var entry = JSON.stringify(Object.assign({ ts: new Date().toISOString(), source: source, event: event }, meta || {})) + '\n';
        require('fs').appendFileSync(require('path').join(DASH_LOG_DIR, 'dashboard_structured.jsonl'), entry);
    } catch {}
}

// ─── API Routes ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send(HTML));

// v3.3: Strategy Router endpoint
app.get('/api/v4/strategy-router', (req, res) => {
    try {
        const { classifyStrategies, getStrategySnapshot } = require('./strategy_router.cjs');
        const { detectSession } = require('./strategy_engine.cjs');
        const session = detectSession();
        const sessionName = session.session || 'unknown';
        // Use latest indicator snapshot if available
        let indicators = { bollinger: {}, stochastic: {}, awesome_oscillator: {}, atr: null };
        try {
            const iSnap = snapStore.getLatest('INDICATOR');
            if (iSnap && iSnap.data) {
                indicators = {
                    bollinger: iSnap.data.bollinger || {},
                    stochastic: iSnap.data.stochastic || {},
                    awesome_oscillator: iSnap.data.awesome_oscillator || {},
                    atr: iSnap.data.atr || null
                };
            }
        } catch(e) {}
        // Use latest market snapshot for regime
        let regime = 'UNKNOWN';
        try {
            const mSnap = snapStore.getLatest('MARKET');
            if (mSnap && mSnap.data && mSnap.data.trend) regime = mSnap.data.trend;
        } catch(e) {}
        const snapshot = getStrategySnapshot(indicators, { session: sessionName, regime, structures: [], direction: null });
        // Write to snapshot store
        try { snapStore.put('STRATEGY_ROUTE', null, null, snapshot, { provider: 'strategy_router' }); } catch(e) {}
        res.json(snapshot);
    } catch(e) { res.json({ error: e.message, strategies: [] }); }
});

app.get('/api/news',    (req, res) => {
    const n = parseInt(req.query.n) || 50;
    res.json(getRecentHeadlines(n));
});

app.get('/api/macro', async (req, res) => {
    try {
        const { getGlobalMacro } = require('./lib/macro/global-macro.cjs');
        const macro = await getGlobalMacro();
        res.json(macro || { error: 'Macro data unavailable' });
    } catch (e) {
        res.json({ error: e.message });
    }
});

app.get('/api/signals', async (req, res) => {
    try {
        const { getRecentSnapshots } = require('./lib/storage/signal-store.cjs');
        const snapshots = await getRecentSnapshots('', 30);
        const institutional = snapshots.map(s => ({
            ...s,
            asset:              s.asset || s.symbol,
            direction:          s.final_action || s.direction,
            confidence:         s.confidence,
            score:              s.total_score,
            createdAt:          s.created_at,
            run_id:             s.run_id             || null,
            verification_state: s.verification_state || null,
            provider:           s.provider_meta?.primary || null,
            setup_type:         s.setup_type           || null,
            status:             'institutional'
        }));
        const legacy = getSignals(20).map(s => ({ ...s, status: s.status || 'legacy' }));
        const merged  = [...institutional, ...legacy].slice(0, 30);
        res.json(merged);
    } catch (e) {
        res.json(getSignals(30));
    }
});

app.get('/api/signals/history', async (req, res) => {
    try {
        const { getRecentSnapshots } = require('./lib/storage/signal-store.cjs');
        const days   = parseInt(req.query.days) || 7;
        const asset  = req.query.asset || '';
        const snaps  = await getRecentSnapshots(asset, 100);
        res.json({ snapshots: snaps, count: snaps.length, days });
    } catch (e) {
        res.json({ snapshots: [], count: 0, error: e.message });
    }
});

app.get('/api/stats', (req, res) => {
    try {
        const { getMonthlyStats } = require('./trading_engine.cjs');
        const stats = getMonthlyStats() || {};
        const perf  = getPerformance();
        res.json({
            monthly:          stats,
            sentToTelegram:   perf?.sentToTelegram || 0,
            watchlistActive:  perf?.watchlistActive || 0,
            uptime:           process.uptime(),
            timestamp:        new Date().toISOString()
        });
    } catch(e) {
        res.json({ error: e.message });
    }
});

app.get('/api/rwanda',  (req, res) => res.json(getRwandaIntel(30)));

app.get('/api/performance', (req, res) => {
    const p  = getPerformance();
    const hl = getRecentHeadlines(500);
    const since24h = Date.now() - 86400000;
    p.totalHeadlines = hl.filter(h => new Date(h.savedAt).getTime() > since24h).length;
    res.json(p);
});

app.get('/api/session', (req, res) => {
    try {
        const { detectSession } = require('./strategy_engine.cjs');
        res.json(detectSession());
    } catch(e) { res.json({ session: 'unknown', quality: 'low' }); }
});

app.get('/api/health', (req, res) => {
    try {
        const { getAllHealth } = require('./lib/providers/provider_registry.cjs');
        const providers = getAllHealth();
        const healthy   = providers.filter(p => p.healthy).length;
        res.json({
            status:    healthy > 0 ? 'ok' : 'degraded',
            providers: { total: providers.length, healthy, degraded: providers.length - healthy },
            uptime:    process.uptime(),
            memory:    process.memoryUsage().heapUsed,
            timestamp: new Date().toISOString()
        });
    } catch(e) {
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
    }
});

// ── Phase 5: New observability endpoints ─────────────────────────────────────
app.get('/api/providers', (req, res) => {
    try {
        const { getAllHealth, computeProviderStatus } = require('./lib/providers/provider_registry.cjs');
        const { getAllQuotas } = require('./api_counter.cjs');
        const quotas = getAllQuotas();
        const all = getAllHealth().map(p => {
            // Enrich with api_counter data
            const q = quotas.find(qq => qq.key === p.key || qq.key === p.name) || {};
            const calls_today = q.total || p.totalCalls || 0;
            const daily_limit = q.daily_limit || p.dailyLimit || null;
            const quota_pct   = daily_limit ? Math.round((calls_today / daily_limit) * 100) : null;
            const latency_ms  = q.avg_latency != null ? q.avg_latency : (p.avgLatencyMs || null);
            const last_error  = q.last_error_msg || p.lastError || null;
            // v5.1: Use computeProviderStatus for authoritative status label
            const computed_status = typeof computeProviderStatus === 'function'
                ? computeProviderStatus(p.name)
                : (!p.healthy && (p.failureCount || 0) >= 3 ? 'FAILING' :
                   !p.healthy ? 'DEGRADED' :
                   calls_today === 0 ? 'UNUSED' : 'HEALTHY');
            return {
                ...p,
                calls_today,
                daily_limit,
                quota_pct,
                latency_ms,
                last_error,
                status: computed_status,
                computed_status
            };
        });
        const result = {
            providers: all,
            summary: {
                total:    all.length,
                healthy:  all.filter(p => p.computed_status === 'HEALTHY').length,
                degraded: all.filter(p => p.computed_status === 'DEGRADED').length,
                failing:  all.filter(p => p.computed_status === 'FAILING').length,
                stale:    all.filter(p => p.computed_status === 'STALE').length,
                disabled: all.filter(p => p.computed_status === 'DISABLED').length,
                unused:   all.filter(p => p.computed_status === 'UNUSED').length,
                free:     all.filter(p => p.tier === 'free').length,
                paid:     all.filter(p => p.tier !== 'free').length
            },
            timestamp: new Date().toISOString()
        };
        // Write PROVIDER snapshot
        try {
            snapStore.put('PROVIDER', null, null, {
                providers: all.map(p => ({ name: p.name, key: p.key, tier: p.tier || 'free', healthy: !!p.healthy, status: p.computed_status, computed_status: p.computed_status, calls_today: p.calls_today, quota_pct: p.quota_pct, latency_ms: p.latency_ms, last_error: p.last_error })),
                total: all.length,
                healthy: result.summary.healthy,
                degraded: result.summary.degraded,
                failing: result.summary.failing
            }, { provider: 'registry' });
        } catch(snapErr) {}
        res.json(result);
    } catch(e) { res.json({ error: e.message, providers: [] }); }
});

app.get('/api/errors', (req, res) => {
    try {
        const { getRecentErrors } = require('./lib/errors/error_classifier.cjs');
        const n      = parseInt(req.query.n) || 20;
        const errors = getRecentErrors(n);
        res.json({
            errors,
            count:     errors.length,
            critical:  errors.filter(e => e.severity === 'CRITICAL').length,
            high:      errors.filter(e => e.severity === 'HIGH').length,
            timestamp: new Date().toISOString()
        });
    } catch(e) { res.json({ error: e.message, errors: [] }); }
});

app.get('/api/system', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        uptime_seconds: Math.round(process.uptime()),
        memory: {
            heapUsed:  Math.round(mem.heapUsed  / 1024 / 1024) + 'MB',
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
            rss:       Math.round(mem.rss       / 1024 / 1024) + 'MB'
        },
        node_version: process.version,
        phases_complete: ['Phase 1: Safety', 'Phase 2: Observability', 'Phase 3: Learning', 'Phase 4: Providers', 'Phase 5: v5.1 Institutional'],
        timestamp: new Date().toISOString()
    });
});

// ─── v5.1 Expert System API Endpoints ─────────────────────────────────────────

app.get('/api/health/smart', (req, res) => {
    try {
        const { runHealthCheck, detectErrorTrends, isBaselineMature } = require('./smart_health.cjs');
        const result = runHealthCheck();
        const trends = detectErrorTrends();
        res.json({ ...result, errorTrends: trends, baselineMature: isBaselineMature() });
    } catch(e) { res.json({ error: e.message, status: 'UNKNOWN' }); }
});

app.get('/api/regime/:symbol', async (req, res) => {
    try {
        const { classifyRegime, getRecommendedStrategies } = require('./lib/agents/pattern-detector.cjs');
        const { fetchCandles } = require('./market_fetcher.cjs');
        const sym = req.params.symbol.toUpperCase();
        const result = await fetchCandles(sym).catch(() => null);
        const candles = result?.candles;
        if (!candles || candles.length < 10) return res.json({ error: `No data for ${sym}` });
        const { calcADX, calcATR } = require('./strategy_engine.cjs');
        const indicators = {
            adx: calcADX?.(candles) || { adx: 20 },
            atrCurrent: calcATR?.(candles) || 1,
            atrAvg: 1, bbWidth: 0.05, bbWidthAvg: 0.05
        };
        const regime = classifyRegime(indicators);
        const strategies = getRecommendedStrategies(regime.regime);
        res.json({ symbol: sym, provider: result.provider, regime, strategies });
    } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/patterns/:symbol', async (req, res) => {
    try {
        const { runPatternScan } = require('./lib/agents/pattern-detector.cjs');
        const { fetchCandles } = require('./market_fetcher.cjs');
        const sym = req.params.symbol.toUpperCase();
        const result = await fetchCandles(sym).catch(() => null);
        const candles = result?.candles;
        if (!candles || candles.length < 10) return res.json({ error: `No data for ${sym}` });
        const scan = runPatternScan(candles, {});
        res.json({ symbol: sym, provider: result.provider, ...scan });
    } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/api-usage', (req, res) => {
    try {
        const { getAllQuotas } = require('./api_counter.cjs');
        const quotas = getAllQuotas();
        // Write APIUSAGE snapshot
        try {
            const totalCalls = quotas.reduce((s, q) => s + (q.total || 0), 0);
            const totalErrors = quotas.reduce((s, q) => s + (q.errors || 0), 0);
            snapStore.put('APIUSAGE', null, null, {
                providers: quotas.map(q => ({ key: q.key, name: q.name, calls: q.total || 0, errors: q.errors || 0, tier: q.tier })),
                total_calls: totalCalls,
                total_errors: totalErrors,
                budget_remaining: null
            }, { provider: 'api_counter' });
        } catch(snapErr) {}
        res.json({ quotas, timestamp: new Date().toISOString() });
    } catch(e) { res.json({ error: e.message, quotas: [] }); }
});

app.get('/api/version', (req, res) => {
    try {
        const { loadVersion } = require('./auto_update.cjs');
        res.json(loadVersion());
    } catch(e) { res.json({ error: e.message, version: '5.1.0' }); }
});

app.get('/api/updates', (req, res) => {
    try {
        const { checkForUpdates, getChangelog, loadVersion } = require('./auto_update.cjs');
        const ver = loadVersion();
        const updates = checkForUpdates();
        const changelog = getChangelog(20);
        res.json({ pending: ver.pendingUpdates, recommendations: updates.recommendations, changelog });
    } catch(e) { res.json({ error: e.message }); }
});

// ── v3.1 Dashboard Enhancement Endpoints ──────────────────────────────────────

app.get('/api/prices', async (req, res) => {
    try {
        const prices = [];
        // CoinGecko for crypto
        try {
            const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,ripple,solana&vs_currencies=usd&include_24hr_change=true', { signal: AbortSignal.timeout(8000) });
            if (cgRes.ok) {
                const cg = await cgRes.json();
                if (cg.bitcoin)  prices.push({ symbol: 'BTC',  price: '$' + (cg.bitcoin.usd||0).toLocaleString(),  change: cg.bitcoin.usd_24h_change });
                if (cg.ethereum) prices.push({ symbol: 'ETH',  price: '$' + (cg.ethereum.usd||0).toLocaleString(), change: cg.ethereum.usd_24h_change });
                if (cg.ripple)   prices.push({ symbol: 'XRP',  price: '$' + (cg.ripple.usd||0).toFixed(4),          change: cg.ripple.usd_24h_change });
                if (cg.solana)   prices.push({ symbol: 'SOL',  price: '$' + (cg.solana.usd||0).toFixed(2),          change: cg.solana.usd_24h_change });
            }
        } catch(e) { /* CoinGecko unavailable */ }
        // Yahoo for forex/commodities
        const yahooSyms = [{ sym: 'GC=F', label: 'GOLD' }, { sym: 'EURUSD=X', label: 'EUR/USD' }, { sym: 'DX-Y.NYB', label: 'DXY' }];
        for (const ys of yahooSyms) {
            try {
                const yr = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ys.sym}?range=1d&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
                if (yr.ok) {
                    const yd = await yr.json();
                    const meta = yd.chart?.result?.[0]?.meta;
                    if (meta) {
                        const price = meta.regularMarketPrice || 0;
                        const prev  = meta.chartPreviousClose || meta.previousClose || price;
                        const chg   = prev ? ((price - prev) / prev * 100) : 0;
                        prices.push({ symbol: ys.label, price: ys.label === 'GOLD' ? '$' + price.toFixed(2) : price.toFixed(4), change: chg });
                    }
                }
            } catch(e) { /* Yahoo unavailable for this symbol */ }
        }
        res.json({ prices, timestamp: new Date().toISOString() });
    } catch(e) { res.json({ prices: [], error: e.message }); }
});

app.get('/api/feargreed', async (req, res) => {
    try {
        // Check snapshot first
        const existing = snapStore.get('FEARGREED');
        if (existing && !existing.stale && existing.payload) {
            return res.json({
                value:              existing.payload.value,
                classification:     existing.payload.classification,
                provider_timestamp: existing.payload.provider_timestamp,
                fetch_timestamp:    existing.created_at,
                cache_age_seconds:  existing.cache_age_seconds,
                stale:              existing.stale,
                stale_level:        existing.stale_level,
                source:             existing.source_provider,
                fallback_used:      existing.fallback_used
            });
        }
        // Fetch fresh from provider
        const fgRes = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(8000) });
        if (fgRes.ok) {
            const fg = await fgRes.json();
            const d  = fg.data?.[0];
            if (d) {
                const provTs = new Date(parseInt(d.timestamp) * 1000).toISOString();
                const fetchTs = new Date().toISOString();
                const value = parseInt(d.value) || 0;
                const classification = d.value_classification || 'Unknown';
                // Write FEARGREED snapshot
                const snap = snapStore.put('FEARGREED', null, null, {
                    value, classification,
                    provider_timestamp: provTs,
                    raw: d
                }, {
                    provider: 'alternative.me',
                    source_timestamp: provTs
                });
                return res.json({
                    value, classification,
                    provider_timestamp: provTs,
                    fetch_timestamp:    fetchTs,
                    cache_age_seconds:  0,
                    stale:              false,
                    stale_level:        'FRESH',
                    source:             'alternative.me',
                    fallback_used:      false
                });
            }
        }
        res.json({ value: 0, classification: 'Unknown', stale: true, stale_level: 'EXPIRED', error: 'API unavailable' });
    } catch(e) { res.json({ value: 0, classification: 'Unknown', stale: true, stale_level: 'EXPIRED', error: e.message }); }
});

app.get('/api/analyses', (req, res) => {
    // Read from ANALYSIS snapshots (written by /analyze command)
    const snaps = snapStore.getAll('ANALYSIS');
    if (snaps.length > 0) {
        const analyses = snaps
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 10)
            .map(s => ({
                ticker: s.symbol,
                symbol: s.symbol,
                timestamp: s.created_at,
                created_at: s.created_at,
                run_id: s.run_id,
                stale: s.stale,
                stale_level: s.stale_level,
                cache_age_seconds: s.cache_age_seconds,
                model: s.payload?.model_used || null,
                model_used: s.payload?.model_used || null,
                confidence: s.payload?.confidence || null,
                final_action: s.payload?.final_action || null,
                result: s.payload?.synthesis || s.payload?.technical_summary || s.payload,
                payload: s.payload
            }));
        return res.json({ analyses, timestamp: new Date().toISOString(), source: 'snapshot_store' });
    }
    // Fallback to in-memory cache
    const legacy = getRecentAnalyses(10);
    res.json({ analyses: legacy, timestamp: new Date().toISOString(), source: 'legacy_cache' });
});

// ── v4.0 Dashboard API Endpoints ──────────────────────────────────────────────

app.get('/api/v4/run-logs', (req, res) => {
    try {
        const { getRecentRuns, getRunStats, getErrorRuns } = require('./lib/observability/run-context.cjs');
        const stats = getRunStats();
        const runs = getRecentRuns(parseInt(req.query.limit) || 20);
        const errors = getErrorRuns(10);
        res.json({ stats, runs, errors, timestamp: new Date().toISOString() });
    } catch(e) { res.json({ stats: {}, runs: [], errors: [], error: e.message }); }
});

app.get('/api/v4/features', (req, res) => {
    try {
        const { getAllFlags } = require('./lib/providers/feature_flags.cjs');
        res.json({ flags: getAllFlags(), timestamp: new Date().toISOString() });
    } catch(e) { res.json({ flags: {}, error: e.message }); }
});

app.get('/api/v4/providers/paid', (req, res) => {
    try {
        const { getAllProviders, getActivatedProviders } = require('./premium_api_adapters.cjs');
        const all = getAllProviders().map(p => ({
            name: p.name, category: p.category, tier: p.tier,
            activated: p.isActivated(), envFlag: p.envFlag, apiKeyEnv: p.apiKeyEnv
        }));
        res.json({ providers: all, activated: getActivatedProviders().length, total: all.length, timestamp: new Date().toISOString() });
    } catch(e) { res.json({ providers: [], error: e.message }); }
});

app.get('/api/v4/snapshots/system', (req, res) => {
    try {
        const { createSystemHealthSnapshot } = require('./lib/contracts/snapshots.cjs');
        const up = process.uptime();
        const mem = process.memoryUsage();
        let providerCount = 0;
        try { providerCount = require('./lib/providers/provider_registry.cjs').getAllHealth().filter(p => p.healthy).length; } catch {}
        const snapshot = createSystemHealthSnapshot({
            uptime: Math.floor(up),
            memory: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            providers: { healthy: providerCount },
            scheduler: 'active',
            database: 'supabase+sqlite',
            telegram: 'polling',
            dashboard: `http://localhost:${PORT}`,
            aiMode: process.env.AI_BASE_URL ? 'LM Studio' : 'rule-based'
        });
        // Write to snapshot store
        try {
            snapStore.put('HEALTH', null, null, {
                uptime_seconds: Math.floor(up),
                memory_mb: Math.round(mem.rss / 1024 / 1024),
                restarts: 0,
                scheduler: { status: 'active' },
                providers: { healthy: providerCount },
                sync_status: snapStore.getSyncHealth()
            }, { provider: 'system' });
        } catch(snapErr) {}
        res.json(snapshot);
    } catch(e) { res.json({ error: e.message }); }
});

// Helper: fetch candles with Binance direct fallback when CoinAPI quota exceeded
// ── v3.4: Test seed endpoint (admin-only) ────────────────────────────────────
app.get('/api/v4/snapshots/seed-test', (req, res) => {
    try {
        const { seedTestSnapshots, cleanTestSnapshots } = require('./test_seed.cjs');
        const count = seedTestSnapshots();
        setTimeout(() => { try { cleanTestSnapshots(); } catch {} }, 5 * 60 * 1000);
        res.json({ seeded: true, types: count, cleanup_after: '5min' });
    } catch(e) { res.json({ error: e.message }); }
});

// ── v3.4: Provider router status ─────────────────────────────────────────────
app.get('/api/v4/provider-router', (req, res) => {
    try {
        const pr = require('./lib/providers/provider_router.cjs');
        res.json({
            statuses: pr.getAllProviderStatuses(),
            fallback_log: pr.getFallbackLog(20),
            timestamp: new Date().toISOString()
        });
    } catch(e) { res.json({ error: e.message }); }
});


async function fetchCandlesSafe(sym) {
    try {
        const { fetchCandles } = require('./market_fetcher.cjs');
        const r = await Promise.race([fetchCandles(sym), new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
        if (r?.candles?.length > 10) return r;
    } catch {}
    // Binance direct fallback for crypto
    const binMap = { BTCUSD:'BTCUSDT',ETHUSD:'ETHUSDT',XRPUSD:'XRPUSDT',SOLUSD:'SOLUSDT',BTC:'BTCUSDT',ETH:'ETHUSDT',SOL:'SOLUSDT',XRP:'XRPUSDT',BNBUSD:'BNBUSDT',DOGEUSD:'DOGEUSDT',ADAUSD:'ADAUSDT' };
    const pair = binMap[sym] || sym + 'USDT';
    try {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=100`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
            const raw = await r.json();
            const candles = raw.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
            return { candles, display: sym, source: 'binance' };
        }
    } catch {}
    return { candles: [], display: sym, source: 'none' };
}

// ── v4.0 Dynamic Dashboard Endpoints ──────────────────────────────────────────

app.get('/api/v4/chart/:symbol', async (req, res) => {
    try {
        const sym = req.params.symbol.toUpperCase();
        // Check CANDLE snapshot first
        let candleSnap = snapStore.get('CANDLE', sym);
        let candles, display, source, snapStale;
        if (candleSnap && !candleSnap.stale && candleSnap.payload?.candles?.length) {
            candles = candleSnap.payload.candles;
            display = candleSnap.payload.display || sym;
            source = candleSnap.source_provider;
            snapStale = false;
        } else {
            // Fetch fresh candles and write CANDLE snapshot
            const result = await fetchCandlesSafe(sym);
            candles = result.candles;
            display = result.display;
            source = result.source;
            if (candles.length) {
                snapStore.put('CANDLE', sym, '1H', {
                    candles, display, candle_count: candles.length,
                    candle_close_time: candles[candles.length - 1]?.time || null
                }, { provider: source });
            }
            snapStale = false;
        }
        if (!candles.length) return res.json({ symbol: sym, chartUrl: null, stale: true, error: 'No candle data' });
        const { generateCandlestickChart } = require('./chart_engine.cjs');
        const chartUrl = await generateCandlestickChart(candles, display || sym, parseInt(req.query.tf || '60'));
        res.json({ symbol: sym, chartUrl, candles: candles.length, source, stale: snapStale, timestamp: new Date().toISOString() });
    } catch(e) { res.json({ symbol: req.params.symbol, chartUrl: null, error: e.message }); }
});

app.get('/api/v4/indicators/:symbol', async (req, res) => {
    try {
        const sym = req.params.symbol.toUpperCase();
        // Read from CANDLE snapshot (shared with chart)
        let candleSnap = snapStore.get('CANDLE', sym);
        let candles, source, snapStale, snapAge;
        if (candleSnap && candleSnap.payload?.candles?.length) {
            candles = candleSnap.payload.candles;
            source = candleSnap.source_provider;
            snapStale = candleSnap.stale;
            snapAge = candleSnap.cache_age_seconds;
        } else {
            // Fetch and write CANDLE snapshot if not available
            const result = await fetchCandlesSafe(sym);
            candles = result.candles;
            source = result.source;
            snapStale = false;
            snapAge = 0;
            if (candles.length) {
                snapStore.put('CANDLE', sym, '1H', {
                    candles, display: result.display, candle_count: candles.length,
                    candle_close_time: candles[candles.length - 1]?.time || null
                }, { provider: source });
            }
        }
        if (!candles || candles.length < 35) return res.json({ symbol: sym, error: 'Insufficient candle data', stale: true });
        // Use getIndicatorSnapshot from chart_engine for full expert indicators
        const { getIndicatorSnapshot } = require('./chart_engine.cjs');
        const snap = getIndicatorSnapshot(candles, sym);
        if (snap.error) return res.json({ symbol: sym, error: snap.error, stale: true });
        // Write INDICATOR snapshot
        snapStore.put('INDICATOR', sym, null, snap, { provider: source || 'chart_engine' });
        res.json({
            ...snap,
            candles: candles.length,
            source,
            stale: snapStale,
            candle_age_seconds: snapAge,
            timestamp: new Date().toISOString()
        });
    } catch(e) { res.json({ symbol: req.params.symbol, error: e.message }); }
});

app.get('/api/v4/strategies/:symbol', async (req, res) => {
    try {
        const sym = req.params.symbol.toUpperCase();
        const { classifyRegime, getRecommendedStrategies } = require('./lib/agents/pattern-detector.cjs');
        const { calcADX, calcATR } = require('./strategy_engine.cjs');
        const { calcBollingerBands: calcBB } = require('./chart_engine.cjs');
        const { candles } = await fetchCandlesSafe(sym);
        const closes = candles.map(c => c.close);
        const atrVals = calcATR(candles) || 1;
        const atrCurrent = typeof atrVals === 'number' ? atrVals : (Array.isArray(atrVals) ? atrVals[atrVals.length - 1] : 1);
        const bb = calcBB(closes, 20, 2);
        const bbWidth = bb && bb.length ? bb[bb.length - 1].upper - bb[bb.length - 1].lower : 0.05;
        const indicators = {
            adx: calcADX?.(candles) || { adx: 20 },
            atrCurrent: atrCurrent,
            atrAvg: atrCurrent,
            bbWidth: bbWidth,
            bbWidthAvg: bbWidth,
            closes: closes
        };
        const regime = classifyRegime(indicators);
        const strategies = getRecommendedStrategies(regime.regime);
        res.json({ symbol: sym, regime, strategies, timestamp: new Date().toISOString() });
    } catch(e) { res.json({ symbol: req.params.symbol, regime: 'UNKNOWN', strategies: { active: [], watchlist: [], avoid: [] }, error: e.message }); }
});

app.get('/api/v4/crypto/trending', async (req, res) => {
    try {
        // Serve from snapshot if fresh
        const cached = snapStore.get('CRYPTO_TRENDING', '_GLOBAL');
        if (cached && !cached.stale) {
            return res.json({ ...cached.payload, stale: false, stale_level: 'FRESH', cache_age_seconds: cached.cache_age, source: cached.source_provider });
        }
        // Fetch fresh from CoinGecko
        const r = await fetch('https://api.coingecko.com/api/v3/search/trending', { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('CoinGecko ' + r.status);
        const d = await r.json();
        const coins = (d.coins || []).slice(0, 7).map(c => ({
            name: c.item.name, symbol: c.item.symbol, rank: c.item.market_cap_rank,
            thumb: c.item.thumb, price_btc: c.item.price_btc, score: c.item.score
        }));
        const payload = { trending: coins, timestamp: new Date().toISOString() };
        snapStore.put('CRYPTO_TRENDING', '_GLOBAL', null, payload, { provider: 'coingecko' });
        res.json({ ...payload, stale: false, stale_level: 'FRESH', cache_age_seconds: 0, source: 'coingecko' });
    } catch(e) {
        // Serve stale from snapshot
        const staleSnap = snapStore.get('CRYPTO_TRENDING', '_GLOBAL');
        if (staleSnap) {
            return res.json({ ...staleSnap.payload, stale: true, stale_level: staleSnap.stale_level, cache_age_seconds: staleSnap.cache_age, source: staleSnap.source_provider, fallback_used: true, error: e.message });
        }
        res.json({ trending: [], stale: true, error: e.message });
    }
});

app.get('/api/v4/crypto/top', async (req, res) => {
    try {
        // Serve from snapshot if fresh
        const cached = snapStore.get('CRYPTO_TOP', '_GLOBAL');
        if (cached && !cached.stale) {
            return res.json({ ...cached.payload, stale: false, stale_level: 'FRESH', cache_age_seconds: cached.cache_age, source: cached.source_provider });
        }
        // Fetch fresh from CoinGecko
        const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h', { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('CoinGecko ' + r.status);
        const coins = (await r.json()).map(c => ({
            symbol: c.symbol.toUpperCase(), name: c.name, price: c.current_price,
            change24h: c.price_change_percentage_24h, marketCap: c.market_cap,
            volume: c.total_volume, image: c.image
        }));
        const payload = { coins, timestamp: new Date().toISOString() };
        snapStore.put('CRYPTO_TOP', '_GLOBAL', null, payload, { provider: 'coingecko' });
        res.json({ ...payload, stale: false, stale_level: 'FRESH', cache_age_seconds: 0, source: 'coingecko' });
    } catch(e) {
        // Serve stale from snapshot
        const staleSnap = snapStore.get('CRYPTO_TOP', '_GLOBAL');
        if (staleSnap) {
            return res.json({ ...staleSnap.payload, stale: true, stale_level: staleSnap.stale_level, cache_age_seconds: staleSnap.cache_age, source: staleSnap.source_provider, fallback_used: true, error: e.message });
        }
        res.json({ coins: [], stale: true, error: e.message });
    }
});

// ── Snapshot Sync Health Endpoint ─────────────────────────────────────────────
app.get('/api/v4/sync-health', (req, res) => {
    try {
        res.json(snapStore.getSyncHealth());
    } catch(e) { res.json({ sync_ok: false, error: e.message }); }
});

app.get('/api/v4/snapshot-stats', (req, res) => {
    try {
        res.json(snapStore.stats());
    } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/v4/snapshot/:type', (req, res) => {
    try {
        const snap = snapStore.getLatest(req.params.type.toUpperCase(), req.query.symbol || null);
        res.json(snap || { error: 'No snapshot', type: req.params.type });
    } catch(e) { res.json({ error: e.message }); }
});

// ── v4.0 M1 Gold Scalp API Endpoint ──────────────────────────────────────────
app.get('/api/v4/scalp/:symbol', async (req, res) => {
    try {
        const sym = req.params.symbol.toUpperCase();
        if (sym !== 'XAUUSD' && sym !== 'GOLD') {
            return res.json({ error: 'Scalping only supports XAUUSD', symbol: sym });
        }
        const { generateScalpSignal } = require('./lib/scalping/gold_scalper.cjs');

        // Attempt to fetch M1 candles
        let candles;
        try {
            const { fetchCandles } = require('./market_fetcher.cjs');
            const result = await Promise.race([
                fetchCandles('XAUUSD', '1MIN'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))
            ]);
            candles = result.candles || result;
        } catch(e) {
            // Fallback to 1H candles (less precise but still useful for indicator display)
            const result = await fetchCandlesSafe('XAUUSD');
            candles = result.candles;
        }

        if (!candles || candles.length < 50) {
            return res.json({ symbol: sym, action: 'WAIT', reason: 'Insufficient M1 data', candle_count: candles?.length || 0 });
        }

        const signal = generateScalpSignal(candles, { symbol: sym, spread: 0.3 });

        // Cache in snapshot store
        try { snapStore.put('SIGNAL', 'XAUUSD_SCALP', 'M1', signal, { provider: 'gold_scalper' }); } catch(e) {}

        res.json(signal);
    } catch(e) {
        res.json({ error: e.message, symbol: req.params.symbol });
    }
});

// ── v3.4 Learning Status Endpoint ─────────────────────────────────────────────
app.get('/api/v4/learning-status', (req, res) => {
    try {
        const { getLearningStatus, getModelScore } = require('./lib/learning/learning-engine.cjs');
        const status = getLearningStatus();
        const modelScore = getModelScore();
        jsonLog('dashboard', 'GET /api/v4/learning-status', { status: 'ok' });
        res.json({ ...status, model_score: modelScore, timestamp: new Date().toISOString() });
    } catch(e) {
        res.json({ error: e.message, total_outcomes: 0, total_signals: 0, mature: false, min_sample_size: 10,
            max_weekly_weight_change: 2, safety_locks: { never_remove_vetoes: true, never_activate_brokers: true, never_activate_paid_providers: true } });
    }
});

// ── v3.4 Replay/Backtest Results Endpoint ─────────────────────────────────────
app.get('/api/v4/replay-results', (req, res) => {
    try {
        const replaySnaps = snapStore.getAll('REPLAY_RESULT') || [];
        const backtestSnaps = snapStore.getAll('BACKTEST_RESULT') || [];
        const results = [
            ...replaySnaps.map(s => ({ type: 'REPLAY', ...s.payload, replay_timestamp: s.created_at })),
            ...backtestSnaps.map(s => ({ type: 'BACKTEST', ...s.payload, replay_timestamp: s.created_at }))
        ].sort((a, b) => new Date(b.replay_timestamp || 0) - new Date(a.replay_timestamp || 0));
        jsonLog('dashboard', 'GET /api/v4/replay-results', { count: results.length });
        res.json({ results, count: results.length, timestamp: new Date().toISOString() });
    } catch(e) {
        res.json({ results: [], count: 0, error: e.message });
    }
});

// ── v3.4 Indicator Intelligence Endpoint ──────────────────────────────────────
app.get('/api/v4/indicator-intelligence', (req, res) => {
    try {
        const { enrichAllIndicators } = require('./lib/indicators/indicator_intelligence.cjs');
        // Pull latest INDICATOR snapshot
        const iSnap = snapStore.getLatest('INDICATOR');
        const rawIndicators = (iSnap && iSnap.data) ? iSnap.data : {};
        const price = rawIndicators.price || 0;
        const enriched = enrichAllIndicators(rawIndicators, price);
        const stale = iSnap ? (iSnap.stale === true) : true;
        jsonLog('dashboard', 'GET /api/v4/indicator-intelligence', { stale });
        res.json({
            indicators: enriched,
            stale,
            cache_age_seconds: iSnap ? iSnap.cache_age_seconds : null,
            source_provider: iSnap ? iSnap.source_provider : 'none',
            timestamp: new Date().toISOString(),
            _note: 'Indicators are timing filters only — BUY/SELL requires signal_verifier'
        });
    } catch(e) {
        res.json({ indicators: {}, stale: true, error: e.message });
    }
});

// ── v3.4 Auto-Update Log Endpoint ─────────────────────────────────────────────
app.get('/api/v4/auto-update-log', (req, res) => {
    try {
        const { getUpdateLog, getPendingApprovals } = require('./lib/policy/auto_update_policy.cjs');
        const log = getUpdateLog(20);
        const pending = getPendingApprovals();
        res.json({ log, pending_count: pending.length, pending, timestamp: new Date().toISOString() });
    } catch(e) {
        res.json({ log: [], pending_count: 0, error: e.message });
    }
});



// ─── v5.0 API Routes ──────────────────────────────────────────────────────────

// Background reasoning results
app.get('/api/v5/reasoning', (req, res) => {
    try {
        const bg = snapStore.getLatest('BACKGROUND_REASONING');
        const cr = snapStore.getLatest('CRITICAL_REASONING');
        res.json({
            background: bg ? { data: bg.data, timestamp: bg.meta?.source_timestamp || bg.timestamp, stale: bg.stale } : null,
            critical: cr ? { data: cr.data, timestamp: cr.meta?.source_timestamp || cr.timestamp, stale: cr.stale } : null
        });
    } catch(e) { res.json({ error: e.message }); }
});

// Trigger critical reasoning for a symbol
app.get('/api/v5/reasoning/critical/:symbol', async (req, res) => {
    try {
        const sym = sanitizeSymbol(req.params.symbol);
        if (!sym) return res.json({ error: 'Invalid symbol' });
        const { requestCriticalReasoning } = require('./tradingagents_bridge.cjs');
        const result = await requestCriticalReasoning(sym);
        res.json(result);
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// Error trend summary for dashboard banner
app.get('/api/v5/error-trends', (req, res) => {
    try {
        const { getErrorTrendSummary } = require('./smart_health.cjs');
        res.json(getErrorTrendSummary());
    } catch(e) { res.json({ status: 'ERROR', message: e.message, trends: [] }); }
});

// Provider config (read-only)
app.get('/api/v5/providers', (req, res) => {
    try {
        const { getProvider } = require('./tradingagents_bridge.cjs');
        const providersCfg = require('./providers.json');
        // Mask API keys
        const safe = {};
        for (const [k, v] of Object.entries(providersCfg)) {
            safe[k] = { ...v, apiKey: v.apiKey ? '***' : null };
        }
        res.json(safe);
    } catch(e) { res.json({}); }
});

// System version & auto-update status
app.get('/api/v5/system-status', (req, res) => {
    try {
        const { loadVersion } = require('./auto_update.cjs');
        const ver = loadVersion();
        const { getErrorTrendSummary } = require('./smart_health.cjs');
        const trends = getErrorTrendSummary();
        res.json({ version: ver.version, codename: ver.codename, pendingUpdates: ver.pendingUpdates.length, errorTrends: trends });
    } catch(e) { res.json({ error: e.message }); }
});

// ── v5.1 Observability API Endpoints ─────────────────────────────────────────

// Health actions (recent self-healing, formatted as human-readable list)
app.get('/api/v5/health-actions', (req, res) => {
    try {
        const { runHealthCheck } = require('./smart_health.cjs');
        const health = runHealthCheck();
        const actions = (health.healingActions || []).map(h => ({
            action: h.action,
            target: h.provider || h.job || h.snapshot_type || h.reason || 'system',
            time: h.timestamp || new Date().toISOString(),
            result: h.result || 'executed'
        }));
        res.json({
            actions,
            total: actions.length,
            warnings: health.warnings || [],
            status: health.status,
            timestamp: new Date().toISOString()
        });
    } catch(e) { res.json({ actions: [], error: e.message }); }
});

// ─── v5.2 API Endpoints ───────────────────────────────────────────────────────

// Issue 3: Scheduler Health
app.get('/api/v5/scheduler-health', (req, res) => {
    try {
        const { getSchedulerHealth } = require('./scheduler.cjs');
        res.json({ jobs: getSchedulerHealth(), timestamp: new Date().toISOString() });
    } catch(e) { res.json({ jobs: [], error: e.message }); }
});

// Issue 2: Signal Freshness
app.get('/api/v5/signals-fresh', (req, res) => {
    try {
        const snapStore = require('./lib/snapshots/snapshot_store.cjs');
        const allSignals = snapStore.getAll ? snapStore.getAll('SIGNAL') : [];
        const now = Date.now();
        const current = [], archived = [];
        for (const s of allSignals) {
            const ageMs = now - new Date(s.updated_at || s.created_at || 0).getTime();
            const ageH = ageMs / (1000 * 60 * 60);
            const entry = { ...s, age_hours: Math.round(ageH * 10) / 10 };
            if (ageH < 2) current.push(entry);
            else archived.push(entry);
        }
        res.json({
            current, archived,
            freshness_status: current.length > 0 ? 'FRESH' : 'STALE',
            message: current.length === 0 ? 'No fresh signals — run /signal or wait for scheduler' : `${current.length} current signal(s)`,
            timestamp: new Date().toISOString()
        });
    } catch(e) { res.json({ current: [], archived: [], freshness_status: 'ERROR', error: e.message }); }
});

// Issue 5: Truthful Provider OK Count
app.get('/api/v5/providers-truth', (req, res) => {
    try {
        const { getAllWithStatus, getProviderErrorRate } = require('./lib/providers/provider_registry.cjs');
        const all = getAllWithStatus();
        const withRates = all.map(p => ({
            ...p,
            error_rate_pct: getProviderErrorRate ? getProviderErrorRate(p.name) : 0
        }));
        const healthy = withRates.filter(p => p.computed_status === 'HEALTHY').length;
        const total = withRates.length;
        res.json({
            providers: withRates,
            summary: { total, healthy_ok: healthy, degraded: withRates.filter(p => p.computed_status === 'DEGRADED').length, failing: withRates.filter(p => p.computed_status === 'FAILING').length, disabled: withRates.filter(p => p.computed_status === 'DISABLED').length },
            timestamp: new Date().toISOString()
        });
    } catch(e) { res.json({ providers: [], error: e.message }); }
});

// Issue 12: Paid-Provider Readiness Map
app.get('/api/v5/paid-readiness', (req, res) => {
    try {
        const { PAID_PLACEHOLDERS } = require('./lib/providers/provider_registry.cjs');
        const readiness = PAID_PLACEHOLDERS.map(p => ({
            name: p.name,
            type: p.type,
            env_flag: p.envFlag,
            env_set: !!process.env[p.envFlag],
            cost_hint: p.costHint,
            status: 'DISABLED',
            badge: process.env[p.envFlag] ? 'Ready but disabled' : 'Not configured'
        }));
        res.json({ providers: readiness, timestamp: new Date().toISOString() });
    } catch(e) { res.json({ providers: [], error: e.message }); }
});

let server = null;
function startDashboard() {
    if (server) return;
    const tryListen = (port) => {
        server = app.listen(port, () => {
            console.log(`[Dashboard] Live at http://localhost:${port}`);
        });
        server.on('error', e => {
            if (e.code === 'EADDRINUSE') {
                console.warn(`[Dashboard] Port ${port} busy — trying ${port + 1}...`);
                server = null;
                tryListen(port + 1);
            } else {
                console.error('[Dashboard] Error:', e.message);
            }
        });
    };
    tryListen(PORT);
}

function stopDashboard() { if (server) server.close(); }

module.exports = { startDashboard, stopDashboard, storeAnalysis, getCachedAnalysis, getRecentAnalyses, PORT };
