/**
 * expert_news_filter.cjs — Institutional News Relevance Engine
 * Prevents false-positive signal generation from irrelevant headlines.
 * 
 * Every headline gets scored 0-100 for asset relevance.
 * Only headlines scoring ≥70 can become SIGNAL_CANDIDATE.
 * Below that: CONTEXT_ONLY or IGNORE.
 */

// ── Asset Synonym Map ─────────────────────────────────────────────────────────
const ASSET_SYNONYMS = {
    XAUUSD: ['gold', 'xau', 'precious metal', 'bullion', 'safe haven gold', 'gold price'],
    BTCUSD: ['bitcoin', 'btc', 'crypto', 'digital gold', 'satoshi'],
    ETHUSD: ['ethereum', 'eth', 'ether'],
    EURUSD: ['euro', 'eur', 'eur/usd', 'eurozone', 'ecb'],
    GBPUSD: ['pound', 'gbp', 'sterling', 'bank of england', 'boe'],
    USDJPY: ['yen', 'jpy', 'boj', 'bank of japan'],
    OIL:    ['crude', 'oil', 'wti', 'brent', 'opec', 'petroleum', 'energy prices'],
    NAS100: ['nasdaq', 'tech stocks', 'tech sector', 'big tech'],
    US30:   ['dow jones', 'dow', 'djia', 'us30'],
    DXY:    ['dollar index', 'dxy', 'usd index', 'greenback'],
    COFFEE: ['coffee', 'arabica', 'robusta', 'coffee price'],
    COPPER: ['copper', 'dr copper'],
    COLTAN: ['coltan', 'tantalum', 'niobium']
};

// ── Macro Transmission Paths ──────────────────────────────────────────────────
// Maps macro events to legitimately affected assets
const MACRO_PATHS = {
    CPI:   { direct: ['XAUUSD', 'DXY', 'US30'], indirect: ['EURUSD', 'BTCUSD'] },
    FOMC:  { direct: ['XAUUSD', 'DXY', 'US30', 'NAS100'], indirect: ['EURUSD', 'BTCUSD', 'OIL'] },
    NFP:   { direct: ['DXY', 'XAUUSD', 'EURUSD'], indirect: ['GBPUSD', 'US30'] },
    PMI:   { direct: ['EURUSD', 'GBPUSD', 'DXY'], indirect: [] },
    ECB:   { direct: ['EURUSD'], indirect: ['DXY', 'XAUUSD'] },
    BOE:   { direct: ['GBPUSD'], indirect: ['EURUSD'] },
    BOJ:   { direct: ['USDJPY'], indirect: ['DXY'] },
    OPEC:  { direct: ['OIL'], indirect: ['XAUUSD'] },
    // v4.0: WAR requires actual geopolitical conflict evidence, not just the word
    WAR:   { direct: ['XAUUSD', 'OIL'], indirect: ['DXY', 'BTCUSD'], requiresEvidence: true },
    TARIFF:{ direct: ['DXY', 'US30', 'NAS100'], indirect: ['XAUUSD', 'EURUSD', 'OIL'] },
    ETF:   { direct: ['BTCUSD', 'ETHUSD'], indirect: [] },
    REGULATION: { direct: ['BTCUSD', 'ETHUSD'], indirect: [] },
    FED_SPEECH: { direct: ['DXY', 'XAUUSD'], indirect: ['US30', 'EURUSD'] }
};

// ── False-Positive Blacklist ──────────────────────────────────────────────────
// Topics that should NEVER trigger commodity/FX signals
const FP_BLACKLIST = [
    'office leasing', 'real estate', 'housing market', 'mortgage',
    'sports', 'entertainment', 'celebrity', 'movie', 'tv show',
    'restaurant', 'food review', 'recipe', 'lifestyle',
    'local crime', 'obituary', 'wedding', 'weather forecast',
    'car review', 'phone review', 'gadget', 'gaming',
    'fashion', 'beauty', 'fitness', 'diet',
    'pet', 'animal', 'zoo', 'travel tips'
];

// ── Source Category Weights ───────────────────────────────────────────────────
const SOURCE_WEIGHTS = {
    'Reuters': 15, 'Bloomberg': 15, 'Financial Times': 14, 'WSJ': 14,
    'CNBC': 12, 'MarketWatch': 12, 'Investing.com': 12, 'ForexLive': 13,
    'CoinDesk': 11, 'CoinTelegraph': 10, 'Decrypt': 10,
    'Yahoo Finance': 10, 'Benzinga': 9, '24/7 Wall St.': 8,
    'Reddit': 5, 'Twitter': 4, 'Unknown': 3
};

// ── Macro Event Keywords ──────────────────────────────────────────────────────
const EVENT_KEYWORDS = {
    CPI:   ['cpi', 'inflation', 'consumer price', 'price index'],
    FOMC:  ['fomc', 'federal reserve', 'fed rate', 'interest rate', 'fed meeting', 'powell'],
    NFP:   ['nonfarm', 'non-farm', 'payroll', 'jobs report', 'employment'],
    PMI:   ['pmi', 'purchasing manager', 'manufacturing index', 'services index'],
    ECB:   ['ecb', 'european central bank', 'lagarde'],
    BOE:   ['bank of england', 'boe', 'bailey'],
    BOJ:   ['bank of japan', 'boj', 'ueda'],
    OPEC:  ['opec', 'oil cartel', 'oil output', 'production cut'],
    WAR:   ['war', 'military', 'invasion', 'missile', 'conflict', 'geopolitical', 'sanctions', 'troops'],
    TARIFF:['tariff', 'trade war', 'import duty', 'trade restriction', 'trade deal'],
    ETF:   ['etf', 'exchange traded fund', 'spot etf'],
    REGULATION: ['regulation', 'sec', 'cftc', 'crypto ban', 'crypto regulation'],
    FED_SPEECH: ['fed speak', 'fed official', 'fed governor', 'fed president']
};

/**
 * Score a headline for relevance to a specific asset.
 * @param {string} headline - The headline text
 * @param {string} targetAsset - e.g. 'XAUUSD', 'BTCUSD'
 * @param {object} meta - { source, category, publishedAt, assets }
 * @returns {{ score: number, action: string, reasons: string[], macroEvent: string|null }}
 */
function scoreHeadlineRelevance(headline, targetAsset, meta = {}) {
    const text = (headline || '').toLowerCase();
    const reasons = [];
    let score = 0;
    let macroEvent = null;

    // ── 1. False-positive blacklist check (-30) ──
    for (const fp of FP_BLACKLIST) {
        if (text.includes(fp)) {
            return { score: 0, action: 'IGNORE', reasons: [`Blacklisted topic: "${fp}"`], macroEvent: null };
        }
    }

    // ── 1b. v5.1 Cross-asset contamination guard (STRICT) ──
    // If headline primarily mentions a specific FX pair, block unrelated commodity scoring
    // unless explicit asset-specific keywords are present
    const FX_PAIRS = { GBPUSD: ['gbp', 'pound', 'sterling', 'bank of england', 'boe'], EURUSD: ['eur', 'euro', 'eurozone', 'ecb'], USDJPY: ['jpy', 'yen', 'boj'] };
    
    // v5.1: Asset-specific keyword requirements for cross-relevance
    const CROSS_RELEVANCE_KEYWORDS = {
        OIL:    ['oil', 'crude', 'petroleum', 'opec', 'energy', 'supply', 'hormuz', 'shipping', 'production', 'barrel', 'wti', 'brent', 'refinery'],
        XAUUSD: ['gold', 'bullion', 'xau', 'safe haven', 'inflation', 'rates', 'central bank', 'geopolitical risk', 'commodity shock', 'precious metal'],
        BTCUSD: ['bitcoin', 'btc', 'crypto', 'etf', 'blockchain', 'mining', 'exchange', 'regulation', 'liquidity', 'risk asset', 'digital'],
        COFFEE: ['coffee', 'arabica', 'robusta', 'bean'],
        COPPER: ['copper', 'metal', 'infrastructure'],
        COLTAN: ['coltan', 'tantalum', 'mineral']
    };
    
    for (const [pair, keywords] of Object.entries(FX_PAIRS)) {
        if (pair !== targetAsset && keywords.some(k => text.includes(k))) {
            const crossKeywords = CROSS_RELEVANCE_KEYWORDS[targetAsset];
            if (crossKeywords) {
                const hasCrossEvidence = crossKeywords.some(k => text.includes(k));
                if (!hasCrossEvidence) {
                    return { score: 0, action: 'IGNORE', reasons: [`v5.1 Cross-asset guard: ${pair} headline → ${targetAsset} blocked (no ${targetAsset}-specific keywords)`], macroEvent: null };
                }
            }
        }
    }
    
    // v5.1: "WAR" must mean actual military conflict, not "trade war" unless commodity-relevant
    if (text.includes('trade war') && !text.includes('military') && !text.includes('armed') && !text.includes('missile')) {
        // "trade war" is NOT military war — reclassify as TARIFF
        // Only allow commodity relevance if explicitly commodity-related
        if (['OIL', 'XAUUSD'].includes(targetAsset)) {
            const commodityEvidence = (CROSS_RELEVANCE_KEYWORDS[targetAsset] || []).some(k => text.includes(k));
            if (!commodityEvidence) {
                // trade war with no commodity keywords → treat as TARIFF for this asset
                reasons.push('v5.1: "trade war" reclassified as TARIFF (not military conflict)');
            }
        }
    }

    // ── 1c. v4.0 Rwanda headlines = CONTEXT_ONLY max ──
    const RWANDA_KEYWORDS = ['rwanda', 'kigali', 'bnr', 'minecofin', 'rdb', 'eac'];
    const isRwandaHeadline = RWANDA_KEYWORDS.some(k => text.includes(k));
    const rwandaCap = isRwandaHeadline ? 65 : Infinity; // Below 70 = never SIGNAL_CANDIDATE

    // ── 2. Direct asset/ticker mention (+40) ──
    const synonyms = ASSET_SYNONYMS[targetAsset] || [];
    const assetLower = targetAsset.toLowerCase();
    let directMention = false;
    if (text.includes(assetLower)) {
        score += 40;
        directMention = true;
        reasons.push(`Direct ticker mention: ${targetAsset}`);
    } else {
        for (const syn of synonyms) {
            if (text.includes(syn.toLowerCase())) {
                score += 35;
                directMention = true;
                reasons.push(`Synonym match: "${syn}"`);
                break;
            }
        }
    }

    // ── 3. Macro event detection + transmission path (+20) ──
    for (const [event, keywords] of Object.entries(EVENT_KEYWORDS)) {
        for (const kw of keywords) {
            if (text.includes(kw)) {
                macroEvent = event;
                const paths = MACRO_PATHS[event];
                if (paths) {
                    // v4.0: WAR requires actual conflict evidence (multiple war keywords)
                    if (paths.requiresEvidence && event === 'WAR') {
                        const warEvidence = ['invasion', 'missile', 'troops', 'military strike', 'armed conflict', 'sanctions'];
                        const evidenceCount = warEvidence.filter(w => text.includes(w)).length;
                        if (evidenceCount < 1) {
                            reasons.push(`WAR keyword found but no conflict evidence — treated as general news`);
                            macroEvent = null;
                            break;
                        }
                    }
                    if (paths.direct.includes(targetAsset)) {
                        score += 20;
                        reasons.push(`Direct macro path: ${event} → ${targetAsset}`);
                    } else if (paths.indirect.includes(targetAsset)) {
                        score += 10;
                        reasons.push(`Indirect macro path: ${event} → ${targetAsset}`);
                    } else if (!directMention) {
                        reasons.push(`No valid transmission: ${event} ✗ ${targetAsset}`);
                    }
                }
                break;
            }
        }
        if (macroEvent) break;
    }

    // ── 4. Source category weight (+3 to +15) ──
    const sourceScore = SOURCE_WEIGHTS[meta.source] || SOURCE_WEIGHTS['Unknown'];
    score += Math.min(sourceScore, 15);
    reasons.push(`Source: ${meta.source || 'Unknown'} (+${sourceScore})`);

    // ── 5. Tagged asset match (+15) ──
    if (meta.assets && Array.isArray(meta.assets)) {
        if (meta.assets.includes(targetAsset)) {
            score += 15;
            reasons.push('Tagged asset match');
        }
    }

    // ── 6. Recency decay ──
    if (meta.publishedAt) {
        const ageHours = (Date.now() - new Date(meta.publishedAt).getTime()) / 3600000;
        if (ageHours > 6) {
            const penalty = Math.min(Math.floor(ageHours - 6) * 2, 20);
            score -= penalty;
            reasons.push(`Recency decay: -${penalty} (${Math.round(ageHours)}h old)`);
        }
    }

    // ── 7a. Keyword proximity bonus (+5) ──
    // Adjacent financial keywords boost relevance
    const PROXIMITY_KEYWORDS = ['price', 'rate', 'yield', 'surge', 'crash', 'rally', 'plunge', 'soar', 'tumble', 'spike', 'drop', 'jump', 'fall', 'rise', 'gain', 'loss', 'cut', 'hike', 'record', 'low', 'high'];
    let proximityHits = 0;
    for (const pk of PROXIMITY_KEYWORDS) {
        if (text.includes(pk)) proximityHits++;
    }
    if (proximityHits >= 2) {
        score += 5;
        reasons.push(`Keyword proximity: ${proximityHits} financial keywords`);
    }

    // ── 7b. No path + no mention = hard cap at 15 ──
    if (!directMention && !macroEvent) {
        score = Math.min(score, 15);
        reasons.push('No asset mention or macro path — capped');
    }

    // ── Clamp + Rwanda cap ──
    score = Math.max(0, Math.min(100, score));
    if (typeof rwandaCap !== 'undefined' && rwandaCap < Infinity) {
        score = Math.min(score, rwandaCap);
        if (score >= 40) reasons.push('Rwanda headline capped at CONTEXT_ONLY (v4.0 rule)');
    }

    // ── Determine action state (5-tier) ──
    // v4.0 HARD RULE: News alone CANNOT create BUY/SELL. Only signal_verifier can.
    let action;
    const isTier1 = ['Reuters', 'Bloomberg', 'Financial Times', 'WSJ', 'CNBC'].includes(meta.source);
    if (score >= 85 && directMention && macroEvent && isTier1) action = 'VERIFIED_SIGNAL';
    else if (score >= 70) action = 'SIGNAL_CANDIDATE';
    else if (score >= 40) action = 'WATCHLIST_CANDIDATE';
    else if (score >= 15) action = 'CONTEXT_ONLY';
    else action = 'IGNORE';

    // ── Noise score (inverse of quality) ──
    const noiseScore = Math.max(0, 100 - score);

    // ── Transmission path string ──
    let transmissionPath = null;
    if (macroEvent && MACRO_PATHS[macroEvent]) {
        const mp = MACRO_PATHS[macroEvent];
        if (mp.direct.includes(targetAsset)) transmissionPath = macroEvent + '→direct→' + targetAsset;
        else if (mp.indirect.includes(targetAsset)) transmissionPath = macroEvent + '→indirect→' + targetAsset;
    }

    return { score, action, reasons, macroEvent, noiseScore, transmissionPath };
}

/**
 * Filter an array of headlines for a target asset.
 * Returns only actionable headlines sorted by relevance.
 */
function filterHeadlinesForAsset(headlines, targetAsset) {
    return headlines
        .map(h => ({
            ...h,
            relevance: scoreHeadlineRelevance(
                h.title,
                targetAsset,
                { source: h.source, publishedAt: h.publishedAt || h.savedAt, assets: h.assets }
            )
        }))
        .filter(h => h.relevance.action !== 'IGNORE')
        .sort((a, b) => b.relevance.score - a.relevance.score);
}

/**
 * Check if a headline can generate a BUY/SELL signal for an asset.
 * Returns false unless relevance ≥ 70 AND has valid macro path or direct mention.
 */
function canGenerateSignal(headline, targetAsset, meta = {}) {
    const { score, action } = scoreHeadlineRelevance(headline, targetAsset, meta);
    return action === 'SIGNAL_CANDIDATE' && score >= 70;
}

/**
 * Classify a headline with full snapshot-compatible output.
 * Includes asset_relevance map, duplicate check, and noise score.
 * @param {object} headline - { title, source, publishedAt }
 * @param {object[]} existingHeadlines - for duplicate detection
 * @returns {object}
 */
function classifyHeadline(headline, existingHeadlines = []) {
    const text = (headline.title || headline.headline || '').toLowerCase();
    const result = {
        title: headline.title || headline.headline,
        source: headline.source || 'unknown',
        published_at: headline.publishedAt || headline.timestamp || new Date().toISOString(),
        classification: 'IGNORE',
        asset_relevance: {},
        transmission_path: null,
        duplicate_of: null,
        noise_score: 100,
        reasons: []
    };

    // Duplicate check: if >70% word overlap with recent headline
    const words = new Set(text.split(/\s+/).filter(w => w.length > 3));
    for (const existing of existingHeadlines) {
        const eText = (existing.title || existing.headline || '').toLowerCase();
        const eWords = new Set(eText.split(/\s+/).filter(w => w.length > 3));
        if (eWords.size === 0) continue;
        let overlap = 0;
        for (const w of words) { if (eWords.has(w)) overlap++; }
        const similarity = overlap / Math.max(words.size, eWords.size);
        if (similarity > 0.7) {
            result.duplicate_of = existing.id || eText.substring(0, 50);
            result.classification = 'IGNORE';
            result.reasons.push('Duplicate detected: ' + Math.round(similarity * 100) + '% overlap');
            return result;
        }
    }

    // Score for all known assets
    const assets = Object.keys(ASSET_SYNONYMS);
    let maxScore = 0;
    let bestAction = 'IGNORE';
    for (const asset of assets) {
        const rel = scoreHeadlineRelevance(headline.title || headline.headline, asset, {
            source: headline.source,
            publishedAt: headline.publishedAt || headline.timestamp
        });
        if (rel.score > 0) {
            result.asset_relevance[asset] = rel.score;
        }
        if (rel.score > maxScore) {
            maxScore = rel.score;
            bestAction = rel.action;
            result.transmission_path = rel.transmissionPath;
            result.reasons = rel.reasons;
            result.noise_score = rel.noiseScore;
        }
    }

    result.classification = bestAction;
    return result;
}

// ─── v5.0 Semantic Hook ────────────────────────────────────────────────────────
// Prepares the filter for embedding-based similarity rather than just keyword regex
async function semanticScoreHeadline(headlineText, targetAsset) {
    try {
        const { callLLM } = require('../llm_router.cjs');
        const prompt = `Evaluate if this headline is a major catalyst for ${targetAsset} using second-order logic. Output JSON: { "relevance_score": 0-100, "transmission_path": "string", "reasoning": "string" }\nHeadline: "${headlineText}"`;
        const res = await callLLM([{ role: 'user', content: prompt }], 'REASONING_LOOP');
        if (res && res.text) {
            try {
                const parsed = JSON.parse(res.text.replace(/```json/g, '').replace(/```/g, ''));
                return { score: parsed.relevance_score || 0, reasoning: parsed.reasoning || '', path: parsed.transmission_path || '' };
            } catch (e) {
                return { score: 0, reasoning: 'Failed to parse semantic response', path: '' };
            }
        }
        return { score: 0, reasoning: '', path: '' };
    } catch (e) {
        return { score: 0, reasoning: '', path: '' };
    }
}

module.exports = {
    scoreHeadlineRelevance,
    filterHeadlinesForAsset,
    canGenerateSignal,
    classifyHeadline,
    semanticScoreHeadline,
    ASSET_SYNONYMS,
    MACRO_PATHS
};
