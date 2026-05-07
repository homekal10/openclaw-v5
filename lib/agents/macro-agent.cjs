/**
 * macro-agent.cjs — OpenClaw Macro Agent
 *
 * Role: Assess asset-relevant macro context and event risk.
 * Sentiment is CONTEXT only — never a direct execution trigger.
 *
 * Hard blockers:
 *   - HIGH event risk within 6h → trade_restriction = true
 *   - Sentiment-only signal → rejected
 *   - Weak headline relevance → macro score capped
 */

'use strict';

// ─── Asset Relevance Filter Rules ─────────────────────────────────────────────
const ASSET_RELEVANCE_RULES = {
    XAUUSD: {
        keywords: ['gold','usd','dollar','fed','federal reserve','inflation','cpi','fomc',
                   'interest rate','yields','bond','geopolit','war','safe haven',
                   'dxy','dollar index','nonfarm','nfp','rate hike','rate cut'],
        blockedKeywords: ['bitcoin','crypto','ethereum','tech stock','nasdaq','s&p'],
        regime: ['risk_off', 'usd_weak', 'inflation_rising']
    },
    BTCUSD: {
        keywords: ['bitcoin','btc','crypto','ethereum','blockchain','defi','regulation',
                   'sec','etf','coinbase','binance','halving','dominance','altcoin',
                   'risk appetite','risk on','macro risk'],
        blockedKeywords: ['gold','xau','forex','eurusd','gbpusd'],
        regime: ['risk_on', 'crypto_bull', 'macro_stable']
    },
    EURUSD: {
        keywords: ['ecb','euro','european','eu','fed','usd','dollar','inflation','cpi',
                   'interest rate','gdp','pmi','draghi','lagarde','powell'],
        blockedKeywords: ['bitcoin','crypto','gold','xau','oil'],
        regime: ['usd_weak', 'ecb_hawkish', 'eu_stable']
    },
    GBPUSD: {
        keywords: ['boe','bank of england','gbp','pound','sterling','uk','inflation',
                   'cpi','bailey','usd','dollar','rate'],
        blockedKeywords: ['bitcoin','crypto','gold','xau'],
        regime: ['usd_weak', 'boe_hawkish']
    },
    DEFAULT: {
        keywords: ['inflation','gdp','pmi','interest rate','central bank','employment',
                   'nonfarm','recession','rate','usd','dollar'],
        blockedKeywords: [],
        regime: []
    }
};

// ─── Major Event Detection ────────────────────────────────────────────────────
const HIGH_RISK_EVENTS = [
    { pattern: /\b(fomc|federal reserve decision|rate decision)\b/i, risk: 'HIGH', asset: 'ALL' },
    { pattern: /\b(cpi|consumer price index)\b/i,                    risk: 'HIGH', asset: 'ALL' },
    { pattern: /\b(nonfarm|nfp|payroll)\b/i,                         risk: 'HIGH', asset: 'ALL' },
    { pattern: /\b(ecb decision|ecb rate)\b/i,                       risk: 'HIGH', asset: 'EURUSD' },
    { pattern: /\b(boe decision|bank of england rate)\b/i,           risk: 'HIGH', asset: 'GBPUSD' },
    { pattern: /\b(sec ruling|bitcoin etf|crypto ban)\b/i,           risk: 'HIGH', asset: 'BTCUSD' },
    { pattern: /\b(gdp|pce|ppi)\b/i,                                 risk: 'MEDIUM', asset: 'ALL' },
    { pattern: /\b(pmi|ism|retail sales)\b/i,                        risk: 'MEDIUM', asset: 'ALL' }
];

/**
 * scoreHeadlineRelevance(headline, asset) → { relevance: 0-1, blocked: bool, reason }
 */
function scoreHeadlineRelevance(headline, asset) {
    const text = `${headline.title || ''} ${headline.summary || ''}`.toLowerCase();
    const rules = ASSET_RELEVANCE_RULES[asset] || ASSET_RELEVANCE_RULES.DEFAULT;

    // Check blocked keywords first
    const blocked = rules.blockedKeywords.some(k => text.includes(k));
    if (blocked) return { relevance: 0, blocked: true, reason: 'Off-topic for asset' };

    // Count keyword matches
    const matches = rules.keywords.filter(k => text.includes(k));
    const relevance = Math.min(1, matches.length / 3); // 3 keyword hits = full relevance

    return {
        relevance: parseFloat(relevance.toFixed(2)),
        blocked: false,
        matchedKeywords: matches,
        reason: matches.length > 0 ? `Matched: ${matches.slice(0, 3).join(', ')}` : 'No keyword match'
    };
}

/**
 * detectEventRisk(headlines, asset) → { level, events, timerHours }
 */
function detectEventRisk(headlines, asset) {
    const events = [];
    const assetUpper = (asset || '').toUpperCase();

    for (const h of headlines) {
        const text = `${h.title || ''} ${h.summary || ''}`.toLowerCase();
        for (const ev of HIGH_RISK_EVENTS) {
            if (ev.pattern.test(text) && (ev.asset === 'ALL' || ev.asset === assetUpper)) {
                events.push({
                    type:      ev.risk,
                    event:     text.substring(0, 60),
                    asset:     ev.asset,
                    publishedAt: h.publishedAt
                });
            }
        }
    }

    // De-duplicate
    const uniqueEvents = events.filter((e, i, arr) =>
        arr.findIndex(x => x.event === e.event) === i
    );

    const highRisk   = uniqueEvents.some(e => e.type === 'HIGH');
    const mediumRisk = uniqueEvents.some(e => e.type === 'MEDIUM');

    return {
        level:    highRisk ? 'HIGH' : mediumRisk ? 'MEDIUM' : 'LOW',
        events:   uniqueEvents,
        count:    uniqueEvents.length
    };
}

/**
 * classifyRegime(validHeadlines, asset) → { label, bias, confidence }
 */
function classifyRegime(validHeadlines, asset) {
    if (!validHeadlines.length) return { label: 'UNKNOWN', bias: 'NEUTRAL', confidence: 0 };

    const text = validHeadlines.map(h => h.title || '').join(' ').toLowerCase();
    const rules = ASSET_RELEVANCE_RULES[asset] || ASSET_RELEVANCE_RULES.DEFAULT;

    // Simple regime classification
    const bullishSignals = ['rate cut','dovish','stimulus','easing','risk on','rally',
                            'growth','recovery','halving','etf approval'].filter(k => text.includes(k));
    const bearishSignals = ['rate hike','hawkish','recession','tightening','risk off',
                            'inflation','war','ban','default','crash'].filter(k => text.includes(k));

    const bullCount = bullishSignals.length;
    const bearCount = bearishSignals.length;

    let label, bias;
    if (bullCount > bearCount + 1)      { label = 'RISK_ON';    bias = 'BULLISH'; }
    else if (bearCount > bullCount + 1)  { label = 'RISK_OFF';   bias = 'BEARISH'; }
    else                                  { label = 'MIXED';      bias = 'NEUTRAL'; }

    return {
        label,
        bias,
        confidence: Math.min(100, (Math.max(bullCount, bearCount) * 20)),
        bullishSignals,
        bearishSignals
    };
}

/**
 * runMacroAgent(symbol, headlines, options) → MacroOutput
 */
async function runMacroAgent(symbol, headlines = [], options = {}) {
    const startTime = Date.now();
    const asset = symbol.toUpperCase();

    try {
        // ── Step 1: Filter headlines by asset relevance ────────────────────────
        const validHeadlines    = [];
        const ignoredHeadlines  = [];

        for (const h of headlines) {
            const rel = scoreHeadlineRelevance(h, asset);
            if (rel.blocked || rel.relevance < 0.2) {
                ignoredHeadlines.push({ ...h, relevance: rel.relevance, reason: rel.reason });
            } else {
                validHeadlines.push({ ...h, relevance: rel.relevance, matchedKeywords: rel.matchedKeywords });
            }
        }

        // Cluster duplicates (same story from multiple sources)
        const clusteredHeadlines = clusterDuplicates(validHeadlines);

        // ── Step 2: Event risk detection ──────────────────────────────────────
        const eventRisk = detectEventRisk(headlines, asset);

        // ── Step 3: Regime classification (Headlines) ─────────────────────────
        const regime = classifyRegime(clusteredHeadlines, asset);

        // ── Step 3.5: Global Macro (DXY, VIX, Crypto) ─────────────────────────
        let globalMacro = null;
        try {
            const { getGlobalMacro } = require('../macro/global-macro.cjs');
            globalMacro = await getGlobalMacro();
        } catch (e) {
            console.warn('[MacroAgent] Global macro fetch failed', e.message);
        }

        // ── Step 4: Macro score (0-10) ────────────────────────────────────────
        let macroScore = 7; // start with neutral-good
        if (eventRisk.level === 'HIGH')   macroScore -= 7;
        if (eventRisk.level === 'MEDIUM') macroScore -= 3;
        if (regime.bias === options.expectedBias) macroScore += 2;
        if (clusteredHeadlines.length === 0) macroScore -= 2;

        // Apply Global Macro modifiers
        if (globalMacro) {
            if (globalMacro.riskAppetite === 'HIGH' && options.expectedBias === 'BULLISH') macroScore += 2;
            if (globalMacro.riskAppetite === 'LOW' && options.expectedBias === 'BULLISH') macroScore -= 2;
            if (globalMacro.riskAppetite === 'LOW' && options.expectedBias === 'BEARISH') macroScore += 2;
        }

        macroScore = Math.max(0, Math.min(10, macroScore));

        // ── Step 5: Trade restriction? ────────────────────────────────────────
        const tradeRestriction = eventRisk.level === 'HIGH';
        const sentimentOnlySignal = clusteredHeadlines.length > 0 &&
            clusteredHeadlines.every(h => !h.matchedKeywords?.some(k =>
                ['rate','inflation','cpi','fomc','nfp','ecb','boe','gdp'].includes(k)
            ));

        // ── Step 6: Average relevance ──────────────────────────────────────────
        const avgRelevance = clusteredHeadlines.length
            ? parseFloat((clusteredHeadlines.reduce((s, h) => s + h.relevance, 0) / clusteredHeadlines.length).toFixed(2))
            : 0;

        // ── Step 7: Build macro decision ──────────────────────────────────────
        const macroConflict = regime.bias !== 'NEUTRAL' && regime.bias !== options.expectedBias;
        let macroBias = regime.bias;
        if (tradeRestriction) macroBias = 'RESTRICTED';

        const macroDecision = tradeRestriction ? 'WAIT'
            : macroScore >= 7 ? 'PROCEED'
            : macroScore >= 4 ? 'CAUTION'
            : 'WAIT';

        // ── Build why_trade / why_not_trade ───────────────────────────────────
        const whyTrade    = [];
        const whyNotTrade = [];

        if (tradeRestriction) whyNotTrade.push(`HIGH event risk: ${eventRisk.events[0]?.event}`);
        if (sentimentOnlySignal) whyNotTrade.push('Headlines are sentiment-only — no structural macro trigger');
        if (macroConflict) whyNotTrade.push(`Regime bias (${regime.bias}) conflicts with expected direction`);
        if (clusteredHeadlines.length === 0) whyNotTrade.push('No relevant headlines for this asset');
        if (avgRelevance < 0.3) whyNotTrade.push('Headline relevance score too low for this asset');

        if (!tradeRestriction && macroScore >= 7) whyTrade.push('No major event risk in window');
        if (regime.bias !== 'NEUTRAL' && !macroConflict) whyTrade.push(`Macro regime: ${regime.label}`);
        if (clusteredHeadlines.length > 0) whyTrade.push(`${clusteredHeadlines.length} relevant headlines confirmed for ${asset}`);

        return {
            symbol,
            macro_bias:         macroBias,
            regime_label:       regime.label,
            regime_confidence:  regime.confidence,
            event_risk_level:   eventRisk.level,
            event_risk_events:  eventRisk.events,
            headline_relevance_score: avgRelevance,
            headline_relevance_summary: `${clusteredHeadlines.length} relevant / ${ignoredHeadlines.length} ignored of ${headlines.length} total`,
            valid_headlines:    clusteredHeadlines.slice(0, 5),
            ignored_headlines:  ignoredHeadlines.slice(0, 3),
            macro_score:        macroScore,
            macro_conflicts:    macroConflict ? [`Regime ${regime.bias} vs expected ${options.expectedBias || 'N/A'}`] : [],
            trade_restriction:  tradeRestriction,
            sentiment_only:     sentimentOnlySignal,
            macro_decision:     macroDecision,
            why_trade:          whyTrade,
            why_not_trade:      whyNotTrade,
            needed_confirmation: buildMacroConfirmation(eventRisk, tradeRestriction),
            run_duration_ms:    Date.now() - startTime
        };

    } catch (err) {
        return {
            symbol,
            macro_decision:    'ERROR',
            trade_restriction: false,
            macro_score:       5,
            event_risk_level:  'UNKNOWN',
            error_message:     `Macro agent failed: ${err.message}`,
            why_not_trade:     ['Macro analysis unavailable — using neutral assumption'],
            run_duration_ms:   Date.now() - startTime
        };
    }
}

function clusterDuplicates(headlines) {
    const seen = new Set();
    return headlines.filter(h => {
        const key = (h.title || '').substring(0, 40).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildMacroConfirmation(eventRisk, tradeRestriction) {
    if (tradeRestriction) {
        const events = eventRisk.events.map(e => e.event).join(', ');
        return [`Wait for high-risk event to pass: ${events}`];
    }
    if (eventRisk.level === 'MEDIUM') {
        return ['Monitor event outcome before entry — reduce size during event window'];
    }
    return ['No macro confirmation required — proceed with technical validation'];
}

module.exports = { runMacroAgent, scoreHeadlineRelevance, detectEventRisk };
