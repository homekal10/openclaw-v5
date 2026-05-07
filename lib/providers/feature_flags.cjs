/**
 * feature_flags.cjs — OpenClaw Feature Flag System
 * 
 * Manages paid provider activation and system feature toggles.
 * All paid features disabled by default — enabled via env vars.
 */
'use strict';

const FLAGS = {
    // ── Paid Provider Activation ──
    ENABLE_PAID_MARKET_DATA:  { env: 'ENABLE_PAID_MARKET_DATA',  default: false, description: 'Bloomberg, Refinitiv, Polygon.io, TradingView' },
    ENABLE_PAID_NEWS:         { env: 'ENABLE_PAID_NEWS',         default: false, description: 'Benzinga, TradingEconomics, RavenPack' },
    ENABLE_PAID_CALENDAR:     { env: 'ENABLE_PAID_CALENDAR',     default: false, description: 'TradingEconomics economic calendar' },
    ENABLE_BROKER_EXECUTION:  { env: 'ENABLE_BROKER_EXECUTION',  default: false, description: 'Oanda, Exness, Binance, Alpaca, IBKR' },
    ENABLE_CLOUD_LLM:        { env: 'ENABLE_CLOUD_LLM',         default: false, description: 'Cloud AI providers (Grok/xAI)' },
    ENABLE_TELEMETRY:         { env: 'ENABLE_TELEMETRY',         default: false, description: 'Sentry, Datadog, PostHog' },

    // ── System Features ──
    ENABLE_AUTO_APPLY:        { env: 'ENABLE_AUTO_APPLY',        default: false, description: 'Auto-apply safe scoring updates' },
    ENABLE_WEBHOOK_MODE:      { env: 'ENABLE_WEBHOOK_MODE',      default: false, description: 'Telegram webhook (vs polling)' },
    ENABLE_DEBUG_MODE:        { env: 'ENABLE_DEBUG_MODE',         default: false, description: 'Verbose debug output in commands' },
    ENABLE_LEARNING_AUTO:     { env: 'ENABLE_LEARNING_AUTO',     default: false, description: 'Auto-apply learning weight adjustments' },
};

function isEnabled(flagName) {
    const flag = FLAGS[flagName];
    if (!flag) return false;
    const envVal = process.env[flag.env];
    if (envVal === undefined || envVal === '') return flag.default;
    return envVal === 'true' || envVal === '1';
}

function getAllFlags() {
    const result = {};
    for (const [name, flag] of Object.entries(FLAGS)) {
        result[name] = {
            enabled: isEnabled(name),
            env: flag.env,
            description: flag.description
        };
    }
    return result;
}

function formatFlagsTelegram() {
    const lines = ['🏳️ *Feature Flags*\n'];
    for (const [name, flag] of Object.entries(FLAGS)) {
        const status = isEnabled(name) ? '✅' : '⬛';
        lines.push(`${status} \`${flag.env}\`\n   _${flag.description}_`);
    }
    return lines.join('\n');
}

module.exports = { isEnabled, getAllFlags, formatFlagsTelegram, FLAGS };
