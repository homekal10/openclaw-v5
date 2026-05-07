/**
 * watchdog.cjs - Auto-restart guardian for the Telegram bot
 * Monitors the bot process and restarts it on crashes or network failures.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

// Live data seeder — starts alongside the bot to populate the dashboard
// with real CoinGecko data every 5 minutes
setTimeout(() => {
    try { require('./live_seeder.cjs'); }
    catch(e) { console.error('[WATCHDOG] Seeder init error:', e.message); }
}, 3000); // 3s delay to let env load

const BOT_SCRIPT  = path.join(__dirname, 'telegram_bot.cjs');
const LOG_FILE    = path.join(__dirname, 'logs', 'watchdog_log.txt');
const MAX_RETRIES = 99;  // always try to reconnect
const BASE_DELAY  = 5000; // 5s initial retry
const MAX_DELAY   = 60000; // max 60s between retries

let retryCount  = 0;
let totalRestarts = 0;

function writeLog(msg) {
    const line = `[${new Date().toISOString()}] [WATCHDOG] ${msg}`;
    fs.appendFileSync(LOG_FILE, line + '\n');
    console.log(line);
}

function getDelay() {
    // Exponential backoff: 5s, 10s, 20s, ... up to 60s
    return Math.min(BASE_DELAY * Math.pow(2, Math.min(retryCount, 4)), MAX_DELAY);
}

function startBot() {
    writeLog(`Starting PM2 manager...`);
    
    // Start PM2 and tail logs so the console window stays open and useful
    const child = spawn('npx.cmd', ['pm2', 'start', 'ecosystem.config.cjs'], { cwd: __dirname });
    
    child.on('exit', () => {
        writeLog('PM2 started. Tailing logs...');
        const tail = spawn('npx.cmd', ['pm2', 'logs', 'openclaw'], { cwd: __dirname });
        tail.stdout.on('data', d => process.stdout.write(d));
        tail.stderr.on('data', d => process.stderr.write(d));
    });
}

if (!fs.existsSync(path.join(__dirname, 'logs'))) {
    fs.mkdirSync(path.join(__dirname, 'logs'));
}

writeLog('=== OpenClaw Watchdog + Live Seeder Started ===');
writeLog(`Guarding via PM2 ecosystem`);
startBot();

// Handle watchdog own exit signals gracefully
process.on('SIGINT',  () => { writeLog('Watchdog shutting down (SIGINT).');  process.exit(0); });
process.on('SIGTERM', () => { writeLog('Watchdog shutting down (SIGTERM).'); process.exit(0); });
