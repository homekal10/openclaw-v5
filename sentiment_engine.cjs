/**
 * sentiment_engine.cjs — Keyword-based sentiment scoring
 * Scores headlines +1 (bullish), 0 (neutral), -1 (bearish)
 * Returns asset-specific sentiment + macro bias
 */

const BULLISH = [
    'surge', 'rally', 'soar', 'jump', 'rise', 'gain', 'climb', 'bull',
    'breakout', 'strong', 'high', 'pump', 'buy', 'long', 'support',
    'recovery', 'optimism', 'positive', 'beat', 'growth', 'expansion',
    'rate cut', 'dovish', 'stimulus', 'safe haven', 'demand', 'inflow',
    'record', 'boom', 'outperform', 'upgrade', 'upside', 'buying'
];

const BEARISH = [
    'drop', 'fall', 'crash', 'collapse', 'decline', 'bear', 'plunge',
    'breakdown', 'weak', 'low', 'dump', 'sell', 'short', 'resistance',
    'correction', 'pessimism', 'negative', 'miss', 'contraction',
    'rate hike', 'hawkish', 'tighten', 'risk-off', 'outflow', 'fear',
    'concern', 'loss', 'underperform', 'downgrade', 'downside', 'selling',
    'recession', 'slowdown', 'crisis', 'warning', 'risk'
];

// High-impact macro event keywords
const MACRO_EVENTS = {
    'cpi':           { name: 'CPI (Inflation Data)',    impact: 'HIGH' },
    'consumer price':'{ name: "Consumer Price Index",    impact: "HIGH" }',
    'nfp':           { name: 'Non-Farm Payrolls',        impact: 'HIGH' },
    'non-farm':      { name: 'Non-Farm Payrolls',        impact: 'HIGH' },
    'fomc':          { name: 'FOMC Meeting',             impact: 'HIGH' },
    'fed meeting':   { name: 'Federal Reserve Meeting',  impact: 'HIGH' },
    'rate decision': { name: 'Interest Rate Decision',   impact: 'HIGH' },
    'rate hike':     { name: 'Rate Hike',                impact: 'HIGH' },
    'rate cut':      { name: 'Rate Cut',                 impact: 'HIGH' },
    'gdp':           { name: 'GDP Data',                 impact: 'MEDIUM' },
    'pmi':           { name: 'PMI Data',                 impact: 'MEDIUM' },
    'inflation':     { name: 'Inflation Report',         impact: 'MEDIUM' },
    'jobs report':   { name: 'Jobs Report',              impact: 'HIGH' },
    'payroll':       { name: 'Payroll Data',             impact: 'HIGH' },
    'unemployment':  { name: 'Unemployment Data',        impact: 'MEDIUM' },
    'ecb':           { name: 'ECB Decision',             impact: 'HIGH' },
    'bank of england':{ name: 'BOE Decision',            impact: 'HIGH' },
};

function scoreHeadline(title) {
    const txt = title.toLowerCase();
    let score = 0;
    BULLISH.forEach(w => { if (txt.includes(w)) score += 1; });
    BEARISH.forEach(w => { if (txt.includes(w)) score -= 1; });
    // Cap to -2 / +2
    return Math.max(-2, Math.min(2, score));
}

function detectMacroEvents(articles) {
    const events = [];
    for (const a of articles) {
        const txt = (a.title || '').toLowerCase();
        for (const [keyword, event] of Object.entries(MACRO_EVENTS)) {
            if (txt.includes(keyword)) {
                events.push({ ...event, headline: a.title, source: a.source });
            }
        }
    }
    // Deduplicate events
    const seen = new Set();
    return events.filter(e => {
        if (seen.has(e.name)) return false;
        seen.add(e.name);
        return true;
    });
}

function analyzeSentiment(newsData, assetKey = 'all') {
    const articles = newsData[assetKey] || newsData.all || [];
    if (!articles.length) {
        return { score: 0, label: 'NEUTRAL', confidence: 'LOW', breakdown: [], macroEvents: [] };
    }

    const scores = articles.map(a => ({ title: a.title, score: scoreHeadline(a.title), source: a.source }));
    const total  = scores.reduce((sum, s) => sum + s.score, 0);
    const avg    = total / scores.length;

    let label, confidence;
    if (avg >= 0.5)       { label = 'BULLISH';  confidence = avg >= 1.0 ? 'HIGH' : 'MEDIUM'; }
    else if (avg <= -0.5) { label = 'BEARISH';  confidence = avg <= -1.0 ? 'HIGH' : 'MEDIUM'; }
    else                   { label = 'NEUTRAL';  confidence = 'LOW'; }

    const macroEvents = detectMacroEvents(articles);

    return {
        score:       parseFloat(avg.toFixed(2)),
        label,
        confidence,
        breakdown:   scores.slice(0, 5),
        macroEvents,
        articleCount: articles.length
    };
}

function sentimentToEmoji(label) {
    return { BULLISH: '🟢', BEARISH: '🔴', NEUTRAL: '🟡' }[label] || '⚪';
}

function formatSentimentSummary(assetKey, sentiment) {
    const icon = sentimentToEmoji(sentiment.label);
    let text = `${icon} *${assetKey} Sentiment: ${sentiment.label}*\n`;
    text += `Score: \`${sentiment.score > 0 ? '+' : ''}${sentiment.score}\` | Confidence: ${sentiment.confidence}\n`;
    text += `Based on ${sentiment.articleCount} headlines\n`;
    if (sentiment.macroEvents.length > 0) {
        text += `\n⚡ *Macro Events Detected:*\n`;
        sentiment.macroEvents.slice(0, 3).forEach(e => {
            text += `• ${e.impact === 'HIGH' ? '🔴' : '🟡'} ${e.name}\n`;
        });
    }
    return text;
}

module.exports = { analyzeSentiment, scoreHeadline, detectMacroEvents, sentimentToEmoji, formatSentimentSummary };
