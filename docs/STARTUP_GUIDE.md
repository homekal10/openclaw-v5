# STARTUP_GUIDE.md — OpenClaw Bot Startup & Recovery

## Option A: PM2 (Recommended — Auto-restart on crash)

### One-Time Setup
```powershell
# Install PM2 globally
npm install -g pm2

# Start the bot
cd C:\Users\Homekal\.antigravity\extensions\OpenClaw
pm2 start ecosystem.config.js

# Save process list (survives reboots)
pm2 save

# Auto-start on Windows login
pm2 startup
# → Follow the output instructions to register the startup task
```

### Daily Commands
```powershell
pm2 status          # ← See bot status (online/stopped/errored)
pm2 logs openclaw   # ← Live log tail
pm2 restart openclaw  # ← Restart after code changes
pm2 stop openclaw     # ← Graceful stop
pm2 monit             # ← Full process monitor (CPU, memory, logs)
```

### After Any Code Change
```powershell
pm2 restart openclaw
```

---

## Option B: Manual (Current)
```powershell
cd C:\Users\Homekal\.antigravity\extensions\OpenClaw
node telegram_bot.cjs
```
Bot stops when terminal closes. Use PM2 for persistence.

---

## Log Files

| Log | Path |
|-----|------|
| PM2 output | `logs/pm2_out.log` |
| PM2 errors | `logs/pm2_error.log` |
| Scheduler | `logs/scheduler_log.txt` |
| System errors | `logs/system_errors.jsonl` |
| Signal queue | `logs/signal_queue.json` |
| Bot log | `logs/bot.log` |

---

## Telegram Commands (Quick Reference)

| Command | What it does |
|---------|-------------|
| `/signal XAUUSD` | Full 8-layer institutional signal |
| `/signal XAUUSD debug` | Admin: full run_id + gate + veto breakdown |
| `/health` | Provider health + error count + AI mode |
| `/status` | Uptime + memory + module status |
| `/providers` | Per-provider health + paid placeholder list |
| `/features` | All feature flag states |
| `/logs` | Structured error log (admin) |
| `/schema` | Supabase schema check (admin) |
| `/weeklyreview` | Learning report (admin) |
| `/journal win XAUUSD 2.1` | Log realized trade |

---

## Required: Run Supabase Schema Upgrade

To unlock full Phase 1 tracking (run_id, verification_state, etc.):

1. Open [Supabase SQL Editor](https://supabase.com/dashboard)
2. Select your project
3. Paste and run: `SUPABASE_SCHEMA_UPGRADE.sql`

Until done, bot auto-falls back to base columns — no data lost.

---

## Dashboard

Live at: `http://localhost:3737`

| Endpoint | Data |
|----------|------|
| `/api/health` | Provider health summary |
| `/api/providers` | Per-provider health + tier |
| `/api/signals` | Recent signals with run_id |
| `/api/errors` | Recent system errors |
| `/api/system` | Uptime + memory + phases |
| `/api/stats` | Signal generation stats |
| `/api/session` | Current trading session |

---

## Environment Flags (telegram.env)

```env
ENABLE_PAID_MARKET_DATA=false    # Set true + add API key for Polygon, Bloomberg etc.
ENABLE_PAID_NEWS=false           # Benzinga, RavenPack
ENABLE_PAID_CALENDAR=false       # Trading Economics
ENABLE_BROKER_EXECUTION=false    # Oanda, Alpaca, IBKR
ENABLE_CLOUD_LLM=false           # Grok xAI
ENABLE_TELEMETRY=false           # Sentry, Datadog
ENABLE_WEBHOOK_MODE=false        # Switch from polling to webhook
ENABLE_LEARNING_AUTO_APPLY=false # Auto-apply learning (keep false = admin approval)
ENABLE_DEBUG_MODE=false          # Extra console logs
```
