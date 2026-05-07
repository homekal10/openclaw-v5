/**
 * test_seed.cjs — OpenClaw v5.1 Test Snapshot Seeder
 *
 * Seeds realistic snapshots for types that are normally on-demand only.
 * ONLY used during test runs — never pollutes production.
 *
 * Seeded types: MARKET, INDICATOR, SIGNAL, ANALYSIS, CANDLE, CRYPTO_TOP, CRYPTO_TRENDING
 */
'use strict';

const snapStore = require('./lib/snapshots/snapshot_store.cjs');

const TEST_PROVIDER = 'test_seed';
const SEED_TAG = '__TEST_SEED__';

// ── Seed data factories ─────────────────────────────────────────────────────

function makeMarketSeed() {
    return {
        symbol: 'XAUUSD',
        price: 2345.67,
        bid: 2345.50,
        ask: 2345.84,
        spread: 0.34,
        change_24h: 12.45,
        change_pct: 0.53,
        volume: 184520,
        high_24h: 2358.90,
        low_24h: 2331.10,
        timestamp: new Date().toISOString(),
        _seed: SEED_TAG
    };
}

function makeIndicatorSeed() {
    return {
        symbol: 'XAUUSD',
        timeframe: '1H',
        rsi: 55.2,
        macd: { value: 1.23, signal: 0.89, histogram: 0.34, trend: 'BULLISH' },
        adx: { adx: 28.5, pdi: 22.1, mdi: 14.3 },
        atr: 22.5,
        ema20: 2340.0,
        ema50: 2335.0,
        bollinger: {
            upper: 2360.0, middle: 2342.5, lower: 2325.0,
            pct_b: 0.65, bandwidth: 1.49, squeeze_state: 'NORMAL'
        },
        stochastic: { k: 62.3, d: 58.7, zone: 'neutral', cross_state: 'NONE' },
        awesome_oscillator: { value: 4.56, color: 'green', zero_line_state: 'ABOVE' },
        vwap: 2341.80,
        _seed: SEED_TAG
    };
}

function makeSignalSeed() {
    return {
        symbol: 'XAUUSD',
        direction: 'WAIT',
        setup_type: 'london_sweep_reversal',
        score: 45,
        confidence: 40,
        trend: 'BULLISH',
        entry: null,
        stopLoss: null,
        takeProfit: null,
        rr: 0,
        veto_passed: false,
        veto_summary: 'Score below threshold',
        session: 'london',
        final_action: 'WAIT',
        why_trade: 'Trend bullish with sweep detected',
        why_not_trade: 'Score 45 < 60 threshold, no clean entry',
        invalidation_level: 2320.0,
        needed_confirmation: ['FVG fill', 'Stoch reset to neutral'],
        layers: {
            trend: 'BULLISH', structure: 'HH/HL', liquidity: 'sweep_detected',
            fvg: 'pending', momentum: 'neutral', session: 'london',
            macro: 'low_risk', risk: 'acceptable'
        },
        _seed: SEED_TAG
    };
}

function makeAnalysisSeed() {
    return {
        symbol: 'XAUUSD',
        model_used: 'test-model',
        provider_used: TEST_PROVIDER,
        fallback_depth: 0,
        technical_summary: 'Bullish trend with RSI neutral at 55. MACD histogram positive.',
        sentiment_summary: 'Market sentiment neutral-to-bullish. Fear & Greed at 52.',
        news_macro_summary: 'No high-impact events in next 4h. USD stable.',
        risk_summary: 'Acceptable risk. ATR-based SL within normal bounds.',
        cio_synthesis: 'WAIT — setup forming but needs confirmation via FVG fill.',
        final_action: 'WAIT',
        confidence: 55,
        why_trade: 'Bullish structure intact, sweep detected at London open',
        why_not_trade: 'No FVG confirmation yet, score below execution threshold',
        needed_confirmation: ['FVG fill at 2338-2342', 'Stoch reset'],
        source_snapshots_used: ['INDICATOR', 'NEWS', 'FEARGREED'],
        stale_inputs: [],
        warnings: [],
        agent_runs: [
            { agent: 'technical', model: 'test-model', latency_ms: 120, success: true },
            { agent: 'sentiment', model: 'test-model', latency_ms: 95, success: true },
            { agent: 'news_macro', model: 'test-model', latency_ms: 110, success: true },
            { agent: 'risk', model: 'test-model', latency_ms: 88, success: true },
            { agent: 'cio_synthesis', model: 'test-model', latency_ms: 150, success: true }
        ],
        _seed: SEED_TAG
    };
}

function makeCandleSeed() {
    const now = Date.now();
    const candles = [];
    for (let i = 29; i >= 0; i--) {
        const t = now - i * 3600000;
        const o = 2340 + Math.sin(i * 0.5) * 10;
        candles.push({
            time: new Date(t).toISOString(),
            open: parseFloat(o.toFixed(2)),
            high: parseFloat((o + 5 + Math.random() * 5).toFixed(2)),
            low: parseFloat((o - 5 - Math.random() * 5).toFixed(2)),
            close: parseFloat((o + (Math.random() - 0.5) * 8).toFixed(2)),
            volume: Math.floor(1000 + Math.random() * 5000)
        });
    }
    return { symbol: 'XAUUSD', timeframe: '1H', candles, count: candles.length, _seed: SEED_TAG };
}

function makeCryptoTopSeed() {
    return {
        coins: [
            { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 67234.56, market_cap: 1320000000000, change_24h: 2.1, rank: 1 },
            { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3456.78, market_cap: 415000000000, change_24h: 1.8, rank: 2 },
            { id: 'solana', symbol: 'SOL', name: 'Solana', price: 178.90, market_cap: 82000000000, change_24h: -0.5, rank: 5 }
        ],
        source: 'coingecko',
        _seed: SEED_TAG
    };
}

function makeCryptoTrendingSeed() {
    return {
        trending: [
            { id: 'pepe', symbol: 'PEPE', name: 'Pepe', price_btc: 0.0000001, score: 95, rank: 1 },
            { id: 'bonk', symbol: 'BONK', name: 'Bonk', price_btc: 0.0000002, score: 88, rank: 2 },
            { id: 'wif', symbol: 'WIF', name: 'dogwifhat', price_btc: 0.00004, score: 82, rank: 3 }
        ],
        source: 'coingecko',
        _seed: SEED_TAG
    };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Seed all 7 on-demand snapshot types into the snapshot store.
 * Returns count of seeded snapshots.
 */
function seedTestSnapshots() {
    const seeds = [
        { type: 'MARKET',          symbol: 'XAUUSD', tf: null,  data: makeMarketSeed() },
        { type: 'INDICATOR',       symbol: 'XAUUSD', tf: '1H',  data: makeIndicatorSeed() },
        { type: 'SIGNAL',          symbol: 'XAUUSD', tf: null,  data: makeSignalSeed() },
        { type: 'ANALYSIS',        symbol: 'XAUUSD', tf: null,  data: makeAnalysisSeed() },
        { type: 'CANDLE',          symbol: 'XAUUSD', tf: '1H',  data: makeCandleSeed() },
        { type: 'CRYPTO_TOP',      symbol: null,      tf: null,  data: makeCryptoTopSeed() },
        { type: 'CRYPTO_TRENDING', symbol: null,      tf: null,  data: makeCryptoTrendingSeed() }
    ];

    let count = 0;
    for (const s of seeds) {
        snapStore.put(s.type, s.symbol, s.tf, s.data, {
            provider: TEST_PROVIDER,
            warnings: ['test_seed_data'],
            source_timestamp: new Date().toISOString()
        });
        count++;
    }
    console.log(`[TestSeed] Seeded ${count} snapshot types`);
    return count;
}

/**
 * Clean up seeded snapshots by overwriting with expired markers.
 */
function cleanTestSnapshots() {
    const types = ['MARKET', 'INDICATOR', 'SIGNAL', 'ANALYSIS', 'CANDLE', 'CRYPTO_TOP', 'CRYPTO_TRENDING'];
    let cleaned = 0;
    for (const type of types) {
        const snaps = snapStore.getAll(type);
        for (const s of snaps) {
            if (s.payload?._seed === SEED_TAG || s.source_provider === TEST_PROVIDER) {
                // Overwrite with empty expired payload
                snapStore.put(type, s.symbol, s.timeframe, { _cleaned: true, _seed: SEED_TAG }, {
                    provider: 'cleanup',
                    source_timestamp: new Date(0).toISOString()
                });
                cleaned++;
            }
        }
    }
    console.log(`[TestSeed] Cleaned ${cleaned} seeded snapshots`);
    return cleaned;
}

/** All mandatory snapshot fields */
const MANDATORY_FIELDS = [
    'id', 'run_id', 'symbol', 'timeframe', 'source_provider',
    'source_timestamp', 'created_at', 'updated_at', 'cache_age_seconds',
    'stale', 'stale_level', 'fallback_used', 'warnings', 'payload'
];

module.exports = {
    seedTestSnapshots,
    cleanTestSnapshots,
    MANDATORY_FIELDS,
    TEST_PROVIDER,
    SEED_TAG
};
