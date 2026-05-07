/**
 * premium_api_adapters.cjs — OpenClaw Paid Provider Placeholder Registry
 * 
 * 16 paid provider placeholders — ALL disabled by default.
 * Enabled via env vars (ENABLE_PAID_MARKET_DATA, etc.) + individual API keys.
 * Each placeholder returns typed disabled response — never crashes the pipeline.
 */
'use strict';
const { isEnabled } = require('./lib/providers/feature_flags.cjs');

// ── Provider Interface Template ───────────────────────────────────────────────
function createPlaceholder(name, tier, category, envFlag, setupNotes) {
    return {
        name,
        tier: 'paid_placeholder',
        category,
        enabled: false,
        envFlag,
        setupNotes,
        apiKeyEnv: `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`,

        healthcheck() {
            if (!this.isActivated()) return { healthy: false, reason: 'Provider disabled (placeholder)' };
            return { healthy: true, reason: 'Activated — not yet validated' };
        },

        isActivated() {
            return isEnabled(envFlag) && !!process.env[this.apiKeyEnv];
        },

        async fetch(params = {}) {
            if (!this.isActivated()) {
                return {
                    success: false,
                    provider: name,
                    tier: 'paid_placeholder',
                    reason: `${name} is disabled. Set ${envFlag}=true and provide ${this.apiKeyEnv} to activate.`,
                    data: null
                };
            }
            // When activated, implement actual API call here
            return { success: false, provider: name, reason: 'Integration pending — placeholder activated but not implemented', data: null };
        },

        normalize(raw) { return raw; },

        rateLimitProfile: { requestsPerMinute: 0, dailyLimit: 0 },
        costHint: 'See provider pricing page',
        fallbackPriority: 99,
        lastSuccessAt: null,
        lastError: null
    };
}

// ── 16 Paid Provider Placeholders ─────────────────────────────────────────────

const PAID_PROVIDERS = {
    // ── Market Data (6) ──
    bloomberg: createPlaceholder(
        'Bloomberg', 'paid', 'market_data', 'ENABLE_PAID_MARKET_DATA',
        'Bloomberg Terminal API: Professional-grade market data. Requires Bloomberg Anywhere license. Set BLOOMBERG_API_KEY.'
    ),
    refinitiv: createPlaceholder(
        'Refinitiv', 'paid', 'market_data', 'ENABLE_PAID_MARKET_DATA',
        'Refinitiv Eikon/Workspace: Real-time FX, commodities, equities. Set REFINITIV_API_KEY.'
    ),
    tradingview: createPlaceholder(
        'TradingView', 'paid', 'market_data', 'ENABLE_PAID_MARKET_DATA',
        'TradingView webhook receiver + Pine Script data. Set TRADINGVIEW_API_KEY. Configure webhook URL in TV alerts.'
    ),
    polygon: createPlaceholder(
        'Polygon.io', 'paid', 'market_data', 'ENABLE_PAID_MARKET_DATA',
        'Polygon.io: US stocks, options, forex, crypto. Free tier: 5 calls/min. Paid: unlimited. Set POLYGON_IO_API_KEY.'
    ),
    twelvedata: createPlaceholder(
        'Twelve Data', 'paid', 'market_data', 'ENABLE_PAID_MARKET_DATA',
        'Twelve Data Premium: Real-time + 30yr historical. Free: 800/day. Paid: 100k/day. Set TWELVE_DATA_API_KEY.'
    ),
    fmp: createPlaceholder(
        'Financial Modeling Prep', 'paid', 'market_data', 'ENABLE_PAID_MARKET_DATA',
        'FMP: Fundamentals, SEC filings, earnings. Free: 250/day. Paid: unlimited. Set FINANCIAL_MODELING_PREP_API_KEY.'
    ),

    // ── News & Calendar (3) ──
    benzinga: createPlaceholder(
        'Benzinga', 'paid', 'news', 'ENABLE_PAID_NEWS',
        'Benzinga Pro: Real-time news feed, analyst ratings, SEC filings. Set BENZINGA_API_KEY.'
    ),
    tradingeconomics: createPlaceholder(
        'TradingEconomics', 'paid', 'calendar', 'ENABLE_PAID_CALENDAR',
        'TradingEconomics: Economic calendar, forecasts, indicators for 196 countries. Set TRADINGECONOMICS_API_KEY.'
    ),
    ravenpack: createPlaceholder(
        'RavenPack', 'paid', 'sentiment', 'ENABLE_PAID_NEWS',
        'RavenPack: NLP-powered news sentiment analytics. Institutional grade. Set RAVENPACK_API_KEY.'
    ),

    // ── Broker Execution (5) ──
    oanda: createPlaceholder(
        'Oanda', 'paid', 'broker', 'ENABLE_BROKER_EXECUTION',
        'Oanda v20 REST API: FX/CFD execution. Practice + Live accounts. Set OANDA_API_KEY and OANDA_ACCOUNT_ID.'
    ),
    exness: createPlaceholder(
        'Exness', 'paid', 'broker', 'ENABLE_BROKER_EXECUTION',
        'Exness: FX/metals/indices/crypto execution via MT5 API. Set EXNESS_API_KEY.'
    ),
    binance_trading: createPlaceholder(
        'Binance Trading', 'paid', 'broker', 'ENABLE_BROKER_EXECUTION',
        'Binance Spot/Futures trading API. Set BINANCE_TRADING_API_KEY and BINANCE_TRADING_SECRET.'
    ),
    alpaca: createPlaceholder(
        'Alpaca', 'paid', 'broker', 'ENABLE_BROKER_EXECUTION',
        'Alpaca: Commission-free US equities + crypto. Paper + Live. Set ALPACA_API_KEY and ALPACA_SECRET.'
    ),
    ibkr: createPlaceholder(
        'Interactive Brokers', 'paid', 'broker', 'ENABLE_BROKER_EXECUTION',
        'IBKR Client Portal API: Multi-asset global execution. Set IBKR_API_KEY.'
    ),

    // ── Telemetry (2) ──
    sentry: createPlaceholder(
        'Sentry', 'paid', 'telemetry', 'ENABLE_TELEMETRY',
        'Sentry: Error tracking and performance monitoring. Set SENTRY_API_KEY and SENTRY_DSN.'
    ),
    datadog: createPlaceholder(
        'Datadog', 'paid', 'telemetry', 'ENABLE_TELEMETRY',
        'Datadog/Better Stack/PostHog: Full-stack observability. Set DATADOG_API_KEY.'
    )
};

// ── Registry Functions ────────────────────────────────────────────────────────

function getProvider(name) {
    return PAID_PROVIDERS[name.toLowerCase()] || null;
}

function getAllProviders() {
    return Object.values(PAID_PROVIDERS);
}

function getActivatedProviders() {
    return Object.values(PAID_PROVIDERS).filter(p => p.isActivated());
}

function getProvidersByCategory(category) {
    return Object.values(PAID_PROVIDERS).filter(p => p.category === category);
}

function formatProvidersTelegram() {
    const lines = ['💰 *Paid Provider Placeholders*\n'];
    const categories = { market_data: '📊 Market Data', news: '📰 News', calendar: '📅 Calendar', sentiment: '💭 Sentiment', broker: '🏦 Broker', telemetry: '📡 Telemetry' };

    for (const [cat, label] of Object.entries(categories)) {
        const providers = getProvidersByCategory(cat);
        if (!providers.length) continue;
        lines.push(`\n*${label}*`);
        for (const p of providers) {
            const status = p.isActivated() ? '✅ ACTIVE' : '⬛ Disabled';
            lines.push(`${status} \`${p.name}\``);
        }
    }
    lines.push('\n_Set env flags + API keys to activate._');
    return lines.join('\n');
}

module.exports = {
    PAID_PROVIDERS,
    getProvider,
    getAllProviders,
    getActivatedProviders,
    getProvidersByCategory,
    formatProvidersTelegram,
    createPlaceholder
};
