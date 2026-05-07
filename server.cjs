/**
 * server.cjs — OpenClaw v5.1 Unified Cloud Entry Point (Render/Railway/Fly)
 *
 * Bootstraps the entire system in a single process:
 *   1. Dashboard (Express HTTP on PORT)
 *   2. Telegram Bot (polling)
 *   3. Scheduler (all background jobs)
 *   4. Health check at GET /health
 *   5. Keepalive self-ping for free tier
 */
'use strict';

// ── Global Crash Protection ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('[CRASH-GUARD] Uncaught exception:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH-GUARD] Unhandled rejection:', reason?.message || reason);
});

const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── Load environment ─────────────────────────────────────────────────────────
const envPath = path.join(__dirname, 'telegram.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log('[Server] Loaded env from telegram.env');
} else {
    console.log('[Server] Using process.env (cloud mode)');
}

// ── Singleton guard ──────────────────────────────────────────────────────────
if (global.__OPENCLAW_STARTED) {
    console.warn('[Server] Already started — skipping duplicate init');
    module.exports = {};
    return;
}
global.__OPENCLAW_STARTED = true;

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3737;
process.env.DASHBOARD_PORT = PORT;

// ── Ensure logs directory ────────────────────────────────────────────────────
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

console.log('═══════════════════════════════════════════════');
console.log('  🔭 OpenClaw v5.1 — Institutional Alpha');
console.log(`  Mode: ${process.env.RENDER ? 'RENDER' : 'LOCAL'}`);
console.log(`  Port: ${PORT}`);
console.log(`  Time: ${new Date().toISOString()}`);
console.log('═══════════════════════════════════════════════');

// ═══ PHASE 1: Dashboard (Express — must bind PORT for Render) ════════════════
const { startDashboard } = require('./dashboard.cjs');
startDashboard();
console.log(`[Server] ✅ Dashboard on port ${PORT}`);

// ═══ PHASE 2: Telegram Bot + Scheduler ═══════════════════════════════════════
try {
    require('./telegram_bot.cjs');
    console.log('[Server] ✅ Telegram bot started (polling)');
} catch (e) {
    console.error('[Server] ❌ Bot failed:', e.message);
}

// ═══ PHASE 3: Keepalive (Render free tier spins down after 15min) ════════════
if (process.env.RENDER || process.env.RENDER_EXTERNAL_URL) {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(() => {
        http.get(`${url}/health`, (r) => {
            console.log(`[Keepalive] /health → ${r.statusCode}`);
        }).on('error', () => {});
    }, 14 * 60 * 1000);
    console.log('[Server] ✅ Keepalive enabled (14min self-ping)');
}

// ═══ PHASE 4: Verify health ══════════════════════════════════════════════════
setTimeout(() => {
    http.get(`http://localhost:${PORT}/health`, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => console.log(`[Server] ✅ /health verified: ${d.substring(0, 100)}`));
    }).on('error', () => console.warn('[Server] ⚠️ /health not yet reachable'));
}, 3000);

// ═══ PHASE 5: Graceful Shutdown ══════════════════════════════════════════════
process.on('SIGTERM', () => { console.log('[Server] SIGTERM → shutting down'); setTimeout(() => process.exit(0), 3000); });
process.on('SIGINT',  () => { console.log('[Server] SIGINT → shutting down');  setTimeout(() => process.exit(0), 3000); });

console.log('[Server] 🚀 All systems online.');
