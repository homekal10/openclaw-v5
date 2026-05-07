/**
 * ecosystem.config.js — PM2 Process Manager Config
 * OpenClaw Institutional Intelligence Terminal
 *
 * Commands:
 *   pm2 start ecosystem.config.js       ← start bot
 *   pm2 restart openclaw                ← restart
 *   pm2 stop openclaw                   ← stop
 *   pm2 logs openclaw                   ← live logs
 *   pm2 monit                           ← process monitor
 *   pm2 startup                         ← auto-start on Windows boot
 *   pm2 save                            ← save process list
 */

module.exports = {
  apps: [{
    name:         'openclaw',
    script:       'telegram_bot.cjs',
    interpreter:  'node',
    cwd:          __dirname,

    // ── Auto-restart settings ─────────────────────────────────────────────────
    watch:        false,          // Don't restart on file change (use pm2 restart)
    autorestart:  true,           // Restart on crash
    max_restarts: 10,             // Max 10 restarts before giving up
    min_uptime:   '10s',          // Must be up 10s to count as successful start
    restart_delay: 5000,          // Wait 5s before restarting after crash

    // ── Logging ───────────────────────────────────────────────────────────────
    log_file:     './logs/pm2_combined.log',
    out_file:     './logs/pm2_out.log',
    error_file:   './logs/pm2_error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:   true,

    // ── Environment ───────────────────────────────────────────────────────────
    env: {
      NODE_ENV: 'production'
    },

    // ── Memory guard (restart if > 512MB) ────────────────────────────────────
    max_memory_restart: '512M',

    // ── Node.js flags ─────────────────────────────────────────────────────────
    node_args: '--max-old-space-size=256'
  }]
};
