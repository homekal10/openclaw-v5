/**
 * rwanda_engine.cjs — Rwanda Macro Intelligence Engine v5.1
 * Converts Rwanda/East Africa headlines into MACRO CONTEXT (never trade signals)
 * Rule: Rwanda intelligence outputs CONTEXT, not BUY/SELL
 */

const path = require('path');

// ─── Rwanda Output States ─────────────────────────────────────────────────────
const RWANDA_OUTPUT_STATES = {
    MACRO_CONTEXT: 'MACRO_CONTEXT',
    WATCHLIST_CONTEXT: 'WATCHLIST_CONTEXT',
    NO_TRADE_SIGNAL: 'NO_TRADE_SIGNAL',
    NEEDS_TECHNICAL_CONFIRMATION: 'NEEDS_TECHNICAL_CONFIRMATION'
};

// ─── Allowed Rwanda Sources ───────────────────────────────────────────────────
const ALLOWED_SOURCES = [
    'rwanda', 'eac', 'bnr', 'minecofin', 'rdb', 'rwanda finance',
    'imf rwanda', 'world bank rwanda', 'national bank of rwanda',
    'east africa', 'african development bank', 'rwanda intelligence'
];

function isAllowedSource(source) {
    if (!source) return true; // Default Rwanda Intelligence
    const s = source.toLowerCase();
    return ALLOWED_SOURCES.some(allowed => s.includes(allowed));
}

// ─── Rwanda Signal Logic Map (Context Only — No BUY/SELL) ─────────────────────
const RWANDA_SIGNAL_RULES = [
    {
        patterns: ['coffee export', 'coffee production', 'coffee demand', 'arabica', 'coffee price'],
        signal: {
            asset: 'COFFEE', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT,
            reason: 'Rwanda coffee export activity — commodity supply context',
            confidence_boost: 15
        }
    },
    {
        patterns: ['mining export', 'coltan', 'cassiterite', 'tin export', 'mineral export'],
        signal: {
            asset: 'COLTAN', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT,
            reason: 'Rwanda mineral export momentum — commodity context',
            confidence_boost: 12
        }
    },
    {
        patterns: ['instability', 'conflict', 'security', 'unrest', 'tension', 'violence', 'rebel'],
        signal: {
            asset: 'XAUUSD', direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT,
            reason: 'Regional instability — potential risk-off context for Gold',
            confidence_boost: 20
        },
        also: [
            { asset: 'DXY',    direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT,  reason: 'Potential risk-off dollar context' },
            { asset: 'OIL',    direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT,  reason: 'Potential supply chain pressure context' }
        ]
    },
    {
        patterns: ['tech investment', 'data center', 'digital hub', 'startup', 'fintech', 'technology deal'],
        signal: {
            asset: 'BTCUSD', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT,
            reason: 'Africa tech investment — risk-on sentiment context',
            confidence_boost: 10
        },
        also: [
            { asset: 'NAS100', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT, reason: 'Tech optimism context' }
        ]
    },
    {
        patterns: ['tourism', 'gorilla', 'wildlife', 'visitor', 'travel', 'aviation', 'hotel'],
        signal: {
            asset: 'EURUSD', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT,
            reason: 'Rwanda tourism growth — EM risk-on sentiment context',
            confidence_boost: 8
        }
    },
    {
        patterns: ['imf loan', 'world bank', 'afdb grant', 'infrastructure funding', 'development loan'],
        signal: {
            asset: 'XAUUSD', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT,
            reason: 'Multilateral funding — USD outflows context',
            confidence_boost: 8
        },
        also: [
            { asset: 'EURUSD', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT, reason: 'EM positive sentiment context' }
        ]
    },
    {
        patterns: ['central bank rate', 'bnr rate', 'inflation', 'monetary policy', 'interest rate'],
        signal: {
            asset: 'DXY', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT,
            reason: 'Rwanda monetary policy — monitor USD/RWF and EM Forex',
            confidence_boost: 5
        }
    },
    {
        patterns: ['china investment', 'china deal', 'china trade', 'belt and road'],
        signal: {
            asset: 'COPPER', direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT,
            reason: 'China-Africa deals — infrastructure demand context',
            confidence_boost: 12
        },
        also: [
            { asset: 'BTCUSD', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT, reason: 'Risk-on from China activity context' }
        ]
    },
    {
        patterns: ['uae investment', 'gulf investment', 'saudi deal', 'middle east'],
        signal: {
            asset: 'OIL', direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT,
            reason: 'Gulf-Africa deals — oil market relationship context',
            confidence_boost: 10
        }
    },
    {
        patterns: ['drought', 'flood', 'climate', 'food shortage', 'crop failure', 'harvest'],
        signal: {
            asset: 'COFFEE', direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT,
            reason: 'East Africa climate risk — supply constraint context',
            confidence_boost: 15
        },
        also: [
            { asset: 'XAUUSD', direction: RWANDA_OUTPUT_STATES.MACRO_CONTEXT, reason: 'Commodity supply shock — inflation hedge context' }
        ]
    },
    {
        patterns: ['trade route', 'border closure', 'import ban', 'export ban', 'sanction'],
        signal: {
            asset: 'OIL', direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT,
            reason: 'Trade disruption — supply chain pressure context',
            confidence_boost: 12
        },
        also: [
            { asset: 'XAUUSD', direction: RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT, reason: 'Trade disruption — risk-off context' }
        ]
    }
];

// ─── Global News Signal Rules (v5.1: Context-Only — No BUY/SELL) ─────────────
// Direction uses bias labels (BULLISH_CONTEXT / BEARISH_CONTEXT) to inform analysis
// without ever creating executable trade signals.
const GLOBAL_SIGNAL_RULES = [
    // Fed / Monetary Policy
    { patterns: ['fed rate hike', 'hawkish fed', 'rate hike', 'tightening'],     asset: 'DXY',    direction: 'BULLISH_CONTEXT',  confidence: 80 },
    { patterns: ['fed rate cut', 'dovish fed', 'rate cut', 'easing', 'pivot'],   asset: 'XAUUSD', direction: 'BULLISH_CONTEXT',  confidence: 82 },
    { patterns: ['fed rate cut', 'dovish', 'rate cut'],                           asset: 'BTCUSD', direction: 'BULLISH_CONTEXT',  confidence: 75 },
    { patterns: ['fed rate cut', 'dovish', 'rate cut'],                           asset: 'NAS100', direction: 'BULLISH_CONTEXT',  confidence: 78 },
    // Inflation
    { patterns: ['inflation rises', 'inflation surge', 'cpi hot', 'core cpi'],   asset: 'XAUUSD', direction: 'BULLISH_CONTEXT',  confidence: 78 },
    { patterns: ['inflation cooling', 'cpi falls', 'disinflation', 'deflation'], asset: 'NAS100', direction: 'BULLISH_CONTEXT',  confidence: 76 },
    { patterns: ['inflation cooling', 'cpi falls', 'deflation'],                  asset: 'BTCUSD', direction: 'BULLISH_CONTEXT',  confidence: 72 },
    // Geopolitics
    { patterns: ['war', 'military strike', 'nato', 'conflict escalat', 'missile'],asset: 'XAUUSD', direction: 'BULLISH_CONTEXT',  confidence: 85 },
    { patterns: ['war', 'military strike', 'conflict escalat'],                   asset: 'OIL',    direction: 'BULLISH_CONTEXT',  confidence: 80 },
    { patterns: ['ceasefire', 'peace deal', 'de-escalat'],                        asset: 'XAUUSD', direction: 'BEARISH_CONTEXT',  confidence: 73 },
    // China
    { patterns: ['china stimulus', 'pboc stimulus', 'china easing'],              asset: 'COPPER', direction: 'BULLISH_CONTEXT',  confidence: 80 },
    { patterns: ['china stimulus', 'pboc'],                                        asset: 'BTCUSD', direction: 'BULLISH_CONTEXT',  confidence: 73 },
    { patterns: ['china slowdown', 'china weakness', 'china gdp miss'],           asset: 'COPPER', direction: 'BEARISH_CONTEXT',  confidence: 77 },
    // ECB / EUR
    { patterns: ['ecb rate hike', 'ecb hawkish'],                                 asset: 'EURUSD', direction: 'BULLISH_CONTEXT',  confidence: 78 },
    { patterns: ['ecb rate cut', 'ecb dovish'],                                   asset: 'EURUSD', direction: 'BEARISH_CONTEXT',  confidence: 75 },
    // Tech / Risk
    { patterns: ['earnings beat', 'strong earnings', 'revenue beat'],             asset: 'NAS100', direction: 'BULLISH_CONTEXT',  confidence: 72 },
    { patterns: ['recession fear', 'recession risk', 'gdp contraction'],         asset: 'XAUUSD', direction: 'BULLISH_CONTEXT',  confidence: 79 },
    { patterns: ['recession fear', 'recession risk'],                              asset: 'DXY',    direction: 'BULLISH_CONTEXT',  confidence: 72 },
    // Bitcoin specific
    { patterns: ['bitcoin etf', 'crypto etf', 'sec approve', 'etf approval'],    asset: 'BTCUSD', direction: 'BULLISH_CONTEXT',  confidence: 85 },
    { patterns: ['crypto ban', 'bitcoin ban', 'crackdown crypto'],                asset: 'BTCUSD', direction: 'BEARISH_CONTEXT',  confidence: 82 },
    { patterns: ['bitcoin halving', 'halving'],                                    asset: 'BTCUSD', direction: 'BULLISH_CONTEXT',  confidence: 78 },
    // Gold specific
    { patterns: ['central bank gold', 'gold reserve', 'gold buying'],             asset: 'XAUUSD', direction: 'BULLISH_CONTEXT',  confidence: 80 },
    // Oil
    { patterns: ['opec cut', 'production cut', 'supply cut'],                     asset: 'OIL',    direction: 'BULLISH_CONTEXT',  confidence: 82 },
    { patterns: ['opec increase', 'supply increase', 'shale boom'],               asset: 'OIL',    direction: 'BEARISH_CONTEXT',  confidence: 77 },
];

// ─── Rwanda Signal Analyzer (Context Only) ────────────────────────────────────
function analyzeRwandaHeadline(headline) {
    const text = `${headline.title} ${headline.description || ''}`.toLowerCase();
    const signals = [];

    // Reject non-Rwanda sources
    if (headline.source && !isAllowedSource(headline.source)) {
        return signals;
    }

    for (const rule of RWANDA_SIGNAL_RULES) {
        if (rule.patterns.some(p => text.includes(p))) {
            signals.push({
                ...rule.signal,
                headline:    headline.title,
                source:      headline.source || 'Rwanda Intelligence',
                category:    'rwanda',
                timeframe:   'intraday',
                rwandaBoost: true,
                is_trade_signal: false,
                disclaimer:  'Not a trade signal — macro context only'
            });
            if (rule.also) {
                for (const extra of rule.also) {
                    signals.push({
                        ...extra,
                        headline:    headline.title,
                        source:      headline.source || 'Rwanda Intelligence',
                        category:    'rwanda',
                        confidence_boost: 8,
                        timeframe:   'intraday',
                        rwandaBoost: true,
                        is_trade_signal: false,
                        disclaimer:  'Not a trade signal — macro context only'
                    });
                }
            }
        }
    }
    return signals;
}

// ─── Global News Analyzer (v5.1: Context Only — No BUY/SELL) ──────────────────
function analyzeGlobalHeadline(headline) {
    const text = `${headline.title} ${headline.description || ''}`.toLowerCase();
    const signals = [];

    for (const rule of GLOBAL_SIGNAL_RULES) {
        if (rule.patterns.some(p => text.includes(p))) {
            signals.push({
                asset:       rule.asset,
                direction:   rule.direction,
                confidence:  rule.confidence,
                headline:    headline.title,
                source:      headline.source,
                category:    headline.category || 'global',
                timeframe:   'intraday',
                reason:      `${rule.patterns[0].toUpperCase()} detected — ${rule.direction} on ${rule.asset}`,
                is_trade_signal: false,
                disclaimer:  'Macro context only — requires /signal confirmation'
            });
        }
    }
    return signals;
}

// ─── Rwanda Daily Macro Report (Context Only — No BUY/SELL) ───────────────────
function generateRwandaMacroReport(rwandaItems) {
    if (!rwandaItems.length) return null;

    const categories = {};
    for (const item of rwandaItems) {
        const signals = analyzeRwandaHeadline(item);
        for (const sig of signals) {
            const key = sig.asset;
            if (!categories[key]) categories[key] = { asset: key, signals: [], count: 0 };
            categories[key].signals.push(sig);
            categories[key].count++;
        }
    }

    const reportLines = [
        `🇷🇼 *RWANDA MACRO INTELLIGENCE REPORT*`,
        `_${new Date().toUTCString()}_\n`,
        `📊 Headlines analyzed: *${rwandaItems.length}*`,
        `⚠️ _This is macro context only — not a trade signal._`
    ];

    for (const [asset, data] of Object.entries(categories)) {
        const dominant = data.signals[0];
        const icon = dominant.direction === RWANDA_OUTPUT_STATES.WATCHLIST_CONTEXT ? '🔍' : '📊';
        reportLines.push(`\n${icon} *${asset}* — ${dominant.direction}\n_${dominant.reason}_`);
    }

    if (!Object.keys(categories).length) {
        reportLines.push(`\n📰 No high-conviction Rwanda context today.`);
    }

    reportLines.push(`\n_Source: National Bank of Rwanda, RDB, East Africa Regional Intel_`);
    reportLines.push(`_⚠️ Requires /signal SYMBOL for technical confirmation_`);
    return reportLines.join('\n');
}

module.exports = { analyzeRwandaHeadline, analyzeGlobalHeadline, generateRwandaMacroReport, RWANDA_OUTPUT_STATES };
