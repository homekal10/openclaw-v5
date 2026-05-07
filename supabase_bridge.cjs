/**
 * supabase_bridge.cjs — OpenClaw → Dashboard Integration Layer
 * Pushes structured data to the hktradingbot frontend via HMAC-secured ingest endpoints.
 *
 * Design philosophy:
 *   - FIRE AND FORGET: Never blocks Telegram response. All pushes are async.
 *   - SILENT FAIL:     If the dashboard is down, the bot continues normally.
 *   - SCHEMA STRICT:   All payloads are mapped exactly to frontend Zod schemas.
 *   - NO DEPS:         Uses only Node.js built-in https + crypto modules.
 */

'use strict';
const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

// ─── Config ───────────────────────────────────────────────────────────────────
const DASHBOARD_URL = (process.env.DASHBOARD_URL || '').replace(/\/$/, '');
const INGEST_SECRET = process.env.BOT_INGEST_SECRET || '';
const BOT_VERSION   = 'v2.5-expert';
const LOG_PATH      = path.join(__dirname, 'logs', 'bridge_log.txt');

function bridgeLog(msg) {
    const line = `[${new Date().toISOString()}] [BRIDGE] ${msg}`;
    try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch(e) {}
    // Only log bridge errors in development/debug
    if (process.env.BRIDGE_DEBUG === 'true') console.log(line);
}

// ─── HMAC Signing (mirrors ingest-auth.ts exactly) ───────────────────────────
function signRequest(body) {
    const ts  = String(Math.floor(Date.now() / 1000));
    const sig = crypto
        .createHmac('sha256', INGEST_SECRET)
        .update(`${ts}.${body}`)
        .digest('hex');
    return { ts, sig: `sha256=${sig}` };
}

// ─── HTTP POST helper (no axios needed) ──────────────────────────────────────
function postToEndpoint(path, payload) {
    if (!DASHBOARD_URL || !INGEST_SECRET) {
        bridgeLog(`Skipping ${path} — DASHBOARD_URL or BOT_INGEST_SECRET not configured.`);
        return Promise.resolve(null);
    }

    const body = JSON.stringify(payload);
    const { ts, sig } = signRequest(body);

    return new Promise((resolve) => {
        try {
            const url = new URL(DASHBOARD_URL + path);
            const mod = url.protocol === 'https:' ? https : http;

            const opts = {
                hostname: url.hostname,
                port:     url.port || (url.protocol === 'https:' ? 443 : 80),
                path:     url.pathname + url.search,
                method:   'POST',
                headers: {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'X-Timestamp':    ts,
                    'X-Signature':    sig,
                    'User-Agent':     `OpenClaw-Bot/${BOT_VERSION}`,
                },
                timeout: 8000
            };

            const req = mod.request(opts, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    bridgeLog(`POST ${path} → ${res.statusCode}`);
                    resolve({ status: res.statusCode, body: data });
                });
            });

            req.on('error', e => {
                bridgeLog(`POST ${path} error: ${e.message}`);
                resolve(null);
            });
            req.on('timeout', () => {
                req.destroy();
                bridgeLog(`POST ${path} timed out`);
                resolve(null);
            });

            req.write(body);
            req.end();
        } catch(e) {
            bridgeLog(`POST ${path} exception: ${e.message}`);
            resolve(null);
        }
    });
}

// ─── Schema Mappers ───────────────────────────────────────────────────────────

/**
 * Map from trading_engine generateSignal() output → signals table schema
 * @param {object} raw - raw signal result from trading_engine
 * @returns {object} - clean dashboard payload
 */
function mapSignal(raw) {
    const direction = (raw.direction || raw.signal || '').toLowerCase();
    return {
        asset:              String(raw.symbol  || raw.asset || '').toUpperCase(),
        direction:          direction === 'buy' || direction === 'long' ? 'buy' : 'sell',
        entry:              Number(raw.entry   || raw.currentPrice || 0),
        stop_loss:          raw.stopLoss    ? Number(raw.stopLoss)    : undefined,
        take_profit:        raw.takeProfit  ? Number(raw.takeProfit)  : undefined,
        confidence:         Number(raw.confidence || 70),
        timeframe:          raw.timeframe   || '1H',
        status:             'open',
        source:             raw.source      || 'openclaw-bot',
        score:              raw.score       ? Number(raw.score)       : undefined,
        rr_ratio:           raw.rewardRisk  ? Number(raw.rewardRisk) : undefined,
        atr:                raw.atr         ? Number(raw.atr)         : undefined,
        adx:                raw.adx?.adx    ? Number(raw.adx.adx)    : (raw.adx ? Number(raw.adx) : undefined),
        rsi:                raw.rsi         ? Number(raw.rsi)         : undefined,
        macd:               raw.macd?.histogram ? Number(raw.macd.histogram) : undefined,
        ema20:              raw.ema20       ? Number(raw.ema20)       : undefined,
        ema50:              raw.ema50       ? Number(raw.ema50)       : undefined,
        ema200:             raw.ema200      ? Number(raw.ema200)      : undefined,
        trend:              ['bullish','bearish','neutral'].includes(raw.trend?.toLowerCase())
                            ? raw.trend.toLowerCase() : undefined,
        support:            raw.support     ? Number(raw.support)     : undefined,
        resistance:         raw.resistance  ? Number(raw.resistance)  : undefined,
        sentiment_label:    ['bullish','bearish','neutral'].includes(raw.sentiment?.label?.toLowerCase())
                            ? raw.sentiment.label.toLowerCase() : undefined,
        sentiment_strength: ['low','medium','high'].includes(raw.sentiment?.strength?.toLowerCase())
                            ? raw.sentiment.strength.toLowerCase() : undefined,
        sentiment_source:   raw.sentiment?.source || undefined,
        volume_state:       ['increasing','decreasing','stable'].includes(raw.volumeState?.toLowerCase())
                            ? raw.volumeState.toLowerCase() : undefined,
        reasoning:          Array.isArray(raw.reasoning) ? raw.reasoning.slice(0, 10) : undefined,
        price_now:          raw.currentPrice ? Number(raw.currentPrice) : undefined,
        chart_url:          raw.chartUrl    || undefined,
        notes:              raw.notes       || undefined,
    };
}

/**
 * Map from news headline objects → news_events table schema
 * @param {object|object[]} items - headline(s) from news_collector
 * @returns {object[]} - clean news array for dashboard
 */
function mapNews(items) {
    const list = Array.isArray(items) ? items : [items];
    return list.slice(0, 100).map(h => ({
        headline:     String(h.title  || h.headline || '').substring(0, 512),
        source:       String(h.source || '').substring(0, 128) || undefined,
        url:          h.url           || undefined,
        published_at: h.publishedAt   || h.time || new Date().toISOString(),
        impact:       h.urgency === 'high' ? 'high' : h.isRwanda ? 'medium' : 'low',
        region:       h.region        || (h.isRwanda ? 'africa' : 'global'),
        sentiment:    h.sentimentScore !== undefined ? Number(h.sentimentScore) : undefined,
        summary:      h.description   ? String(h.description).substring(0, 500) : undefined,
    }));
}

/**
 * Map from CoinGecko/market data → crypto_data table schema
 * @param {object|object[]} coins
 * @returns {object[]}
 */
function mapCrypto(coins) {
    const list = Array.isArray(coins) ? coins : [coins];
    return list.slice(0, 200).map(c => ({
        symbol:        String(c.symbol || c.ticker || '').toUpperCase(),
        name:          String(c.name   || c.symbol || ''),
        price:         Number(c.price  || c.current_price || 0),
        change_24h:    c.change24h   !== undefined ? Number(c.change24h)   : undefined,
        market_cap:    c.marketCap   !== undefined ? Number(c.marketCap)   : undefined,
        volume:        c.volume      !== undefined ? Number(c.volume)      : undefined,
        fear_greed:    c.fearGreed   !== undefined ? Number(c.fearGreed)   : undefined,
        trending_rank: c.rank        !== undefined ? Number(c.rank)        : undefined,
    }));
}

/**
 * Build heartbeat payload from live process state
 * @param {object} extras - additional fields (signals_today, active_users)
 * @returns {object}
 */
function mapHeartbeat(extras = {}) {
    return {
        online:         true,
        version:        BOT_VERSION,
        uptime_seconds: Math.floor(process.uptime()),
        signals_today:  extras.signals_today  || 0,
        active_users:   extras.active_users   || 0,
    };
}

/**
 * Map Rwanda intel items → rwanda_intel table schema
 * @param {object|object[]} items
 * @returns {object[]}
 */
function mapRwanda(items) {
    const list = Array.isArray(items) ? items : [items];
    return list.slice(0, 50).map(r => ({
        asset:           String(r.asset       || 'GENERAL').toUpperCase(),
        direction:       r.direction          || 'neutral',
        rationale:       String(r.rationale   || r.title || r.summary || '').substring(0, 1000),
        source:          r.source             || 'NBR Rwanda',
        published_at:    r.publishedAt        || new Date().toISOString(),
        headlines_count: r.headlinesCount     ? Number(r.headlinesCount) : undefined,
    }));
}

// ─── Public API (Fire-and-Forget) ─────────────────────────────────────────────

/** Push a trading signal row. Non-blocking. */
function pushSignal(rawSignal) {
    const payload = mapSignal(rawSignal);
    if (!payload.asset || payload.entry === 0) return;
    setImmediate(() => postToEndpoint('/api/ingest/signal', payload));
}

/** Push one or many news headlines. Non-blocking. */
function pushNews(items) {
    if (!items?.length && !items?.title) return;
    const payload = mapNews(items);
    setImmediate(() => postToEndpoint('/api/ingest/news', payload));
}

/** Push one or many crypto market snapshots. Non-blocking. */
function pushCrypto(coins) {
    if (!coins) return;
    const payload = mapCrypto(coins);
    setImmediate(() => postToEndpoint('/api/ingest/crypto', payload));
}

/** Push bot heartbeat (uptime, user count, signals today). Non-blocking. */
function pushHeartbeat(extras = {}) {
    const payload = mapHeartbeat(extras);
    setImmediate(() => postToEndpoint('/api/ingest/heartbeat', payload));
}

/** Push Rwanda intelligence items. Non-blocking. */
function pushRwanda(items) {
    if (!items) return;
    const payload = mapRwanda(items);
    setImmediate(() => postToEndpoint('/api/ingest/rwanda', payload));
}

module.exports = {
    pushSignal,
    pushNews,
    pushHeartbeat,
    pushCrypto,
    pushRwanda,
    // Expose mappers for unit testing or custom usage
    mapSignal, mapNews, mapCrypto, mapHeartbeat, mapRwanda,
};
