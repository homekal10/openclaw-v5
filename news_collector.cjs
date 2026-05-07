/**
 * news_collector.cjs — Bloomberg-equivalent multi-source news collector
 * Sources: Yahoo Finance, Reuters, CNBC, MarketWatch, CoinDesk, FXStreet,
 *          CryptoPanic, Rwanda NBR, Rwanda Finance, RDB, EAC, IMF Africa
 * Schedule: Every 5 minutes
 */

const https    = require('https');
const http     = require('http');
const path     = require('path');
const { saveHeadline, saveRwandaIntel } = require('./database.cjs');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

// ─── RSS Sources ──────────────────────────────────────────────────────────────
const RSS_SOURCES = [
    // Global Financial
    { name: 'Yahoo Finance',  url: 'https://finance.yahoo.com/rss/topfinstories',        category: 'global',  region: 'global' },
    { name: 'Reuters Biz',    url: 'https://feeds.reuters.com/reuters/businessNews',      category: 'global',  region: 'global' },
    { name: 'CNBC',           url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'global', region: 'global' },
    { name: 'MarketWatch',    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'global', region: 'global' },
    { name: 'Investing.com',  url: 'https://www.investing.com/rss/news.rss',              category: 'global',  region: 'global' },
    { name: 'FXStreet',       url: 'https://www.fxstreet.com/rss',                       category: 'forex',   region: 'global' },
    // Crypto
    { name: 'CoinDesk',       url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',    category: 'crypto',  region: 'global' },
    { name: 'CryptoPanic',    url: 'https://cryptopanic.com/news/rss/',                  category: 'crypto',  region: 'global' },
    // Commodities / Macro
    { name: 'Reuters Commodities', url: 'https://feeds.reuters.com/reuters/commoditiesNews', category: 'commodities', region: 'global' },
    // Africa / Rwanda
    { name: 'Africa Reuters', url: 'https://feeds.reuters.com/reuters/AFRICATopNews',    category: 'africa',  region: 'africa' },
    { name: 'IMF News',       url: 'https://www.imf.org/en/News/rss?RSSType=pressrelease', category: 'macro', region: 'global' },
    { name: 'World Bank',     url: 'https://www.worldbank.org/en/news/rss',              category: 'macro',   region: 'global' },
];

// ─── Rwanda-Specific URLs (HTML scrape) ───────────────────────────────────────
const RWANDA_SOURCES = [
    { name: 'NBR Rwanda',       url: 'https://www.bnr.rw/news/',               selectors: ['h2', 'h3', '.title'] },
    { name: 'Rwanda Finance',   url: 'https://www.minecofin.gov.rw/news/',     selectors: ['h2', 'h3'] },
    { name: 'RDB Rwanda',       url: 'https://rdb.rw/news/',                   selectors: ['h2', 'h3'] },
    { name: 'EAC',              url: 'https://www.eac.int/press-releases',      selectors: ['h2', 'h3'] },
];

// ─── RSS Keywords for Rwanda / Africa detection ───────────────────────────────
const RWANDA_KEYWORDS = [
    'rwanda', 'kigali', 'rwandan', 'rdb',
    'national bank of rwanda', 'bnr', 'minecofin', 'rwf',
    'kagame'
];

// Strict Rwanda keywords — must match for the Rwanda Intelligence panel
const STRICT_RWANDA_KEYWORDS = [
    'rwanda', 'kigali', 'rwandan', 'rdb rwanda', 'bnr rwanda',
    'minecofin', 'rwf', 'kagame', 'rwanda credit', 'rwanda rating',
    'rwanda fiscal', 'rwanda gdp', 'rwanda inflation', 'rwanda trade',
    'rwanda investment', 'rwanda export', 'rwanda import'
];

// EAC keywords only count if paired with Rwanda context
const EAC_KEYWORDS = ['eac', 'east african community', 'east africa'];

// False-positive blocklist for Rwanda panel
const RWANDA_FP_BLOCKLIST = [
    'fedex', 'starbucks', 'walmart', 'amazon earnings', 'apple earnings',
    'tesla earnings', 'netflix', 'google earnings', 'meta earnings',
    'microsoft earnings', 'nvidia earnings', 'form 144', 'form s-3',
    'form 10-k', 'form 10-q', 'form 8-k', 'proxy statement',
    'target\'s', 'costco', 'home depot', 'kohls', 'macy\'s',
    'best buy', 'dollar general', 'analog devices', 'mohawk industries',
    'huron consulting', 'ares record'
];

const AFRICA_KEYWORDS = [
    'africa', 'african', 'nairobi', 'kenya', 'ethiopia', 'tanzania',
    'uganda', 'congo', 'drc', 'sub-saharan', 'frontier market'
];

// ─── Asset mention detection ──────────────────────────────────────────────────
const ASSET_PATTERNS = {
    'XAUUSD': ['gold', 'xau', 'precious metal'],
    'BTCUSD': ['bitcoin', 'btc', 'crypto', 'cryptocurrency'],
    'ETHUSD': ['ethereum', 'eth', 'ether'],
    'EURUSD': ['euro', 'eur', 'ecb', 'eurozone'],
    'GBPUSD': ['pound', 'gbp', 'sterling', 'boe', 'bank of england'],
    'USDJPY': ['yen', 'jpy', 'bank of japan', 'boj'],
    'DXY':    ['dollar index', 'usd', 'federal reserve', 'fed', 'fomc'],
    'OIL':    ['oil', 'crude', 'brent', 'wti', 'opec'],
    'COFFEE': ['coffee', 'arabica', 'robusta'],
    'US30':   ['dow jones', 'us30', 'djia'],
    'NAS100': ['nasdaq', 'nas100', 'tech stocks'],
    'COPPER': ['copper', 'base metal'],
    'COLTAN': ['coltan', 'cobalt', 'tantalum'],
    'TIN':    ['tin', 'cassiterite'],
};

function detectAssets(text) {
    const lower = text.toLowerCase();
    return Object.entries(ASSET_PATTERNS)
        .filter(([, keywords]) => keywords.some(kw => lower.includes(kw)))
        .map(([asset]) => asset);
}

function isRwandaRelated(text) {
    const lower = text.toLowerCase();
    return RWANDA_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Strict Rwanda filter — for the Rwanda Intelligence panel.
 * Rejects generic global/equity headlines unless directly Rwanda-connected.
 */
function isStrictRwanda(text) {
    const lower = text.toLowerCase();
    // Block known false-positives first
    if (RWANDA_FP_BLOCKLIST.some(fp => lower.includes(fp))) return false;
    // Must match a strict Rwanda keyword
    if (STRICT_RWANDA_KEYWORDS.some(kw => lower.includes(kw))) return true;
    // EAC only counts if Rwanda is also mentioned
    if (EAC_KEYWORDS.some(kw => lower.includes(kw)) && lower.includes('rwanda')) return true;
    return false;
}

function isAfricaRelated(text) {
    const lower = text.toLowerCase();
    return AFRICA_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Yahoo Finance & Reddit Scraper ───
async function fetchYahooNews(query, limit = 5) {
    try {
        const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${limit}&quotesCount=0`;
        const res = await fetchUrl(url, 12000);
        if (!res) return [];
        const data = JSON.parse(res);
        return (data.news || []).map(n => {
            const title = (n.title || '').replace(/<[^>]+>/g, '').trim();
            return {
                title,
                url:         n.link || '',
                source:      n.publisher || 'Yahoo Finance',
                category:    'global',
                region:      'global',
                publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : new Date().toISOString(),
                assets:      detectAssets(title),
                isRwanda:    isRwandaRelated(title),
                isAfrica:    isAfricaRelated(title),
                urgency:     'normal'
            };
        });
    } catch (e) { return []; }
}

async function fetchRedditNews(subreddit, limit = 5) {
    try {
        const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
        const res = await fetchUrl(url, 12000);
        if (!res) return [];
        const data = JSON.parse(res);
        return (data.data?.children || [])
            .filter(p => !p.data.stickied)
            .map(p => {
                const title = (p.data.title || '').replace(/<[^>]+>/g, '').trim();
                return {
                    title,
                    url:         `https://reddit.com${p.data.permalink}`,
                    source:      `r/${subreddit}`,
                    category:    'crypto',
                    region:      'global',
                    publishedAt: new Date(p.data.created_utc * 1000).toISOString(),
                    assets:      detectAssets(title),
                    isRwanda:    isRwandaRelated(title),
                    isAfrica:    isAfricaRelated(title),
                    urgency:     'normal'
                };
            });
    } catch (e) { return []; }
}

// ─── HTTP fetch helper ────────────────────────────────────────────────────────
function fetchUrl(url, timeoutMs = 15000) {
    return new Promise((resolve) => {
        const mod = url.startsWith('https') ? https : http;
        let data  = '';
        const req = mod.get(url, {
            timeout: timeoutMs,
            headers: {
                'User-Agent':  'Mozilla/5.0 (compatible; OpenClaw/2.0)',
                'Accept':      'application/rss+xml, text/xml, application/xml, text/html, */*',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        }, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchUrl(res.headers.location, timeoutMs).then(resolve);
            }
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

// ─── RSS Parser ───────────────────────────────────────────────────────────────
function parseRSS(xml, sourceName, category, region) {
    if (!xml) return [];
    try {
        const items = [];
        const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
        let match;
        while ((match = itemRegex.exec(xml)) !== null) {
            const block = match[1];
            const title = (block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
                           block.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1];
            const link  = (block.match(/<link[^>]*>(.*?)<\/link>/i) ||
                           block.match(/<link[^>]*href="([^"]+)"/i) || [])[1];
            const pub   = (block.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i) ||
                           block.match(/<published[^>]*>(.*?)<\/published>/i) || [])[1];
            const desc  = (block.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/si) ||
                           block.match(/<description[^>]*>(.*?)<\/description>/si) || [])[1];

            if (!title) continue;
            const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
            const cleanDesc  = desc ? desc.replace(/<[^>]+>/g, '').trim().substring(0, 200) : '';
            const fullText   = `${cleanTitle} ${cleanDesc}`;

            items.push({
                title:       cleanTitle,
                url:         (link || '').trim(),
                description: cleanDesc,
                source:      sourceName,
                category,
                region,
                publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
                assets:      detectAssets(fullText),
                isRwanda:    isRwandaRelated(fullText),
                isAfrica:    isAfricaRelated(fullText),
                urgency:     'normal'
            });
        }
        return items;
    } catch(e) { return []; }
}

// ─── HTML Rwanda Scraper ──────────────────────────────────────────────────────
function extractTitlesFromHTML(html, sourceName) {
    if (!html) return [];
    const items = [];
    // Extract h2/h3 tags
    const tagRegex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
        const text = match[1].replace(/<[^>]+>/g, '').trim();
        if (text.length > 20 && text.length < 200) {
            items.push({
                title:       text,
                source:      sourceName,
                category:    'rwanda',
                region:      'rwanda',
                publishedAt: new Date().toISOString(),
                assets:      detectAssets(text),
                isRwanda:    true,
                isAfrica:    true,
                urgency:     'high'
            });
        }
    }
    return items.slice(0, 10);
}

// ─── Main Collector ───────────────────────────────────────────────────────────
let isRunning = false;

async function collectAll() {
    if (isRunning) return;
    isRunning = true;
    const results = { new: 0, rwanda: 0, total: 0 };

    try {
        // Collect RSS sources
        for (const src of RSS_SOURCES) {
            try {
                const xml   = await fetchUrl(src.url, 12000);
                const items = parseRSS(xml, src.name, src.category, src.region);
                results.total += items.length;

                for (const item of items) {
                    if (saveHeadline(item)) results.new++;
                    // Only save to Rwanda DB if strict Rwanda filter passes
                    if (item.isRwanda && isStrictRwanda(item.title + ' ' + (item.description || '')) && saveRwandaIntel(item)) results.rwanda++;
                }
            } catch(e) {
                // Silent fail per source
            }
            // Small delay between sources to be respectful
            await new Promise(r => setTimeout(r, 500));
        }

        // Rwanda-specific HTML sources
        for (const src of RWANDA_SOURCES) {
            try {
                const html  = await fetchUrl(src.url, 12000);
                const items = extractTitlesFromHTML(html, src.name);
                for (const item of items) {
                    if (saveRwandaIntel(item)) results.rwanda++;
                    saveHeadline(item);
                }
            } catch(e) {}
        }

        // Yahoo / Reddit JSON endpoints
        const extraNewsPromises = [
            fetchYahooNews('gold XAUUSD', 5),
            fetchYahooNews('bitcoin crypto', 5),
            fetchYahooNews('USD forex interest rate', 5),
            fetchRedditNews('Forex', 5),
            fetchRedditNews('CryptoCurrency', 5)
        ];
        
        const extraResults = await Promise.allSettled(extraNewsPromises);
        for (const res of extraResults) {
            if (res.status === 'fulfilled' && res.value?.length) {
                for (const item of res.value) {
                    if (saveHeadline(item)) results.new++;
                }
            }
        }

        console.log(`[Collector] Done: ${results.new} new of ${results.total} total | Rwanda: ${results.rwanda}`);
    } finally {
        isRunning = false;
    }
    return results;
}

// Backwards compatibility shim for modules expecting fetchAllNews
async function fetchAllNews() {
    const { getRecentHeadlines } = require('./database.cjs');
    const items = getRecentHeadlines(50); // last 50 h
    return {
        all: items.slice(0, 50),
        XAUUSD: items.filter(i => i.assets?.includes('XAUUSD')).slice(0, 10),
        BTC: items.filter(i => i.assets?.includes('BTCUSD') || i.assets?.includes('ETHUSD')).slice(0, 10),
        FOREX: items.filter(i => i.category === 'forex' || i.assets?.includes('EURUSD') || i.assets?.includes('DXY')).slice(0, 10),
        fetchedAt: new Date().toISOString()
    };
}

module.exports = { collectAll, detectAssets, isRwandaRelated, isStrictRwanda, fetchUrl, fetchAllNews };
