/**
 * chart_engine.cjs — Candlestick charts via QuickChart.io
 * Uses Chart.js v3 + chartjs-chart-financial + chartjs-adapter-luxon
 * CRITICAL: candlestick x must be numeric timestamps (ms), not strings
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const QUICKCHART_URL = 'https://quickchart.io/chart/create';
const BG_COLOR = '#0d1117';

// ─── Indicators ───────────────────────────────────────────────────────────────
function calcEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0];
    return data.map(v => { ema = v * k + ema * (1 - k); return parseFloat(ema.toFixed(6)); });
}

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return [];
    let avgG = 0, avgL = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) avgG += d; else avgL -= d;
    }
    avgG /= period; avgL /= period;
    const vals = [];
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
        avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
        vals.push(parseFloat((100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL))).toFixed(2)));
    }
    return vals;
}

function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
    if (closes.length < slow + sig) return { histogram: [] };
    const emaFast  = calcEMA(closes, fast);
    const emaSlow  = calcEMA(closes, slow);
    const macdLine = emaFast.slice(slow - fast).map((v, i) => v - emaSlow[i]);
    const sigLine  = calcEMA(macdLine, sig);
    const hist     = macdLine.slice(sig - 1).map((v, i) => parseFloat((v - sigLine[i]).toFixed(6)));
    return { histogram: hist };
}

function calcSMA(data, period) {
    const sma = [];
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
        if (i >= period) sum -= data[i - period];
        if (i >= period - 1) sma.push(sum / period);
    }
    return sma;
}

function calcBollingerBands(closes, period = 20, multiplier = 2) {
    const sma = calcSMA(closes, period);
    const bands = [];
    for (let i = period - 1; i < closes.length; i++) {
        const slice = closes.slice(i - period + 1, i + 1);
        const mean = sma[i - period + 1];
        const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        bands.push({
            upper: parseFloat((mean + multiplier * stdDev).toFixed(4)),
            lower: parseFloat((mean - multiplier * stdDev).toFixed(4)),
            middle: parseFloat(mean.toFixed(4))
        });
    }
    return bands;
}

function calcVWAP(candles) {
    let cumVol = 0;
    let cumVolPrice = 0;
    return candles.map(c => {
        const typPrice = (c.high + c.low + c.close) / 3;
        cumVol += c.volume || 1;
        cumVolPrice += typPrice * (c.volume || 1);
        return parseFloat((cumVolPrice / cumVol).toFixed(4));
    });
}

function calcATR(candles, period = 14) {
    if (candles.length <= period) return [];
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    const atr = [tr.slice(0, period).reduce((a, b) => a + b, 0) / period];
    for (let i = period; i < tr.length; i++) {
        atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
    }
    return atr.map(v => parseFloat(v.toFixed(4)));
}

const https = require('https');

function httpsPost(url, bodyObj) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(bodyObj);
        const u = new URL(url);
        const opts = {
            hostname: u.hostname,
            port:     443,
            path:     u.pathname,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            },
            timeout: 30000
        };
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error('[Chart] QuickChart', res.statusCode, data.substring(0, 200));
                    return resolve(null);
                }
                try { resolve(JSON.parse(data)); }
                catch(e) { resolve(null); }
            });
        });
        req.on('error', e => { console.error('[Chart] Request error:', e.message); resolve(null); });
        req.on('timeout', () => { req.destroy(); console.error('[Chart] Request timeout'); resolve(null); });
        req.write(bodyStr);
        req.end();
    });
}

async function postChart(chartConfig, width = 860, height = 500) {
    const data = await httpsPost(QUICKCHART_URL, {
        chart: chartConfig, width, height,
        backgroundColor: BG_COLOR, version: '3'
    });
    return data?.url || null;
}


// ─── CANDLESTICK CHART ────────────────────────────────────────────────────────
async function generateCandlestickChart(candles, displaySymbol, lookback = 50) {
    try {
        const recent  = candles.slice(-lookback);
        const closes  = recent.map(c => c.close);
        const ema20   = calcEMA(closes, 20);
        const ema50   = calcEMA(closes, Math.min(50, recent.length - 1));
        const volumes = recent.map(c => c.volume || 0);
        const maxVol  = Math.max(...volumes) || 1;

        // CRITICAL: x must be numeric ms timestamp for chartjs-chart-financial
        const candleData = recent.map(c => ({
            x: typeof c.time === 'number' ? c.time : new Date(c.time).getTime(),
            o: parseFloat(c.open.toFixed(4)),
            h: parseFloat(c.high.toFixed(4)),
            l: parseFloat(c.low.toFixed(4)),
            c: parseFloat(c.close.toFixed(4))
        }));

        const ema20Data = recent.map((c, i) => ({
            x: typeof c.time === 'number' ? c.time : new Date(c.time).getTime(),
            y: parseFloat(ema20[i].toFixed(4))
        }));
        const ema50Data = recent.map((c, i) => ({
            x: typeof c.time === 'number' ? c.time : new Date(c.time).getTime(),
            y: parseFloat(ema50[i].toFixed(4))
        }));
        const volData = recent.map((c, i) => ({
            x: typeof c.time === 'number' ? c.time : new Date(c.time).getTime(),
            y: volumes[i]
        }));

        const priceMin  = Math.min(...recent.map(c => c.low));
        const priceMax  = Math.max(...recent.map(c => c.high));
        const pad       = (priceMax - priceMin) * 0.05;
        const lastClose = closes[closes.length - 1];
        const pct       = ((lastClose - closes[0]) / closes[0] * 100).toFixed(2);
        const chStr     = parseFloat(pct) >= 0 ? `+${pct}%` : `${pct}%`;

        const chartConfig = {
            type: 'candlestick',
            data: {
                datasets: [
                    {
                        label: displaySymbol,
                        data:  candleData,
                        color: {
                            up:        'rgba(0,210,100,1)',
                            down:      'rgba(255,65,65,1)',
                            unchanged: 'rgba(150,150,150,0.9)'
                        },
                        borderColor: {
                            up:        '#00d264',
                            down:      '#ff4141',
                            unchanged: '#969696'
                        },
                        yAxisID: 'y'
                    },
                    {
                        label:       'EMA 20',
                        type:        'line',
                        data:        ema20Data,
                        borderColor: '#f0a500',
                        borderWidth: 2,
                        pointRadius: 0,
                        fill:        false,
                        yAxisID:     'y'
                    },
                    {
                        label:       'EMA 50',
                        type:        'line',
                        data:        ema50Data,
                        borderColor: '#e05252',
                        borderWidth: 1.5,
                        borderDash:  [6, 3],
                        pointRadius: 0,
                        fill:        false,
                        yAxisID:     'y'
                    },
                    {
                        label: 'Volume',
                        type:  'bar',
                        data:  volData,
                        backgroundColor: recent.map(c =>
                            c.close >= c.open ? 'rgba(0,210,100,0.3)' : 'rgba(255,65,65,0.3)'
                        ),
                        borderColor:   'transparent',
                        barPercentage: 0.8,
                        yAxisID:       'yVol'
                    }
                ]
            },
            options: {
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${displaySymbol}  ·  ${lookback}D  ·  ${chStr}  ·  ${lastClose.toFixed(2)}`,
                        color: '#e6edf3',
                        font: { size: 14, weight: 'bold', family: 'monospace' }
                    },
                    legend: { labels: { color: '#8b949e', boxWidth: 14, padding: 12 } }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'day',
                            displayFormats: { day: 'MMM d' }
                        },
                        ticks: { color: '#8b949e', maxTicksLimit: 10, maxRotation: 0 },
                        grid:  { color: 'rgba(255,255,255,0.04)' }
                    },
                    y: {
                        position: 'right',
                        min: parseFloat((priceMin - pad).toFixed(4)),
                        max: parseFloat((priceMax + pad).toFixed(4)),
                        ticks: { color: '#8b949e' },
                        grid:  { color: 'rgba(255,255,255,0.07)' }
                    },
                    yVol: {
                        position: 'left',
                        display:  false,
                        min:      0,
                        max:      maxVol * 5,
                        grid:     { display: false }
                    }
                }
            }
        };

        return await postChart(chartConfig, 860, 500);
    } catch (e) {
        console.error('[CandleChart]', e.message);
        return null;
    }
}

// ─── SIGNAL CHART (with trade lines, BB, VWAP) ────────────────────────────────
async function generateSignalChart(candles, displaySymbol, tradeParams = {}, lookback = 80) {
    try {
        const recent  = candles.slice(-lookback);
        const closes  = recent.map(c => c.close);
        const bb      = calcBollingerBands(closes, 20, 2);
        const vwap    = calcVWAP(recent);
        
        const bbUpper = bb.map(b => b.upper);
        const bbLower = bb.map(b => b.lower);

        // Map timestamp to ms
        const getX = c => typeof c.time === 'number' ? c.time : new Date(c.time).getTime();

        const candleData = recent.map(c => ({
            x: getX(c), o: parseFloat(c.open.toFixed(4)), h: parseFloat(c.high.toFixed(4)),
            l: parseFloat(c.low.toFixed(4)), c: parseFloat(c.close.toFixed(4))
        }));

        const bbUpperData = recent.map((c, i) => ({ x: getX(c), y: bbUpper[i] }));
        const bbLowerData = recent.map((c, i) => ({ x: getX(c), y: bbLower[i] }));
        const vwapData    = recent.map((c, i) => ({ x: getX(c), y: vwap[i] }));

        const priceMin  = Math.min(...recent.map(c => c.low));
        const priceMax  = Math.max(...recent.map(c => c.high));
        let yMin = priceMin, yMax = priceMax;

        const datasets = [
            {
                label: displaySymbol,
                data:  candleData,
                color: { up: 'rgba(0,210,100,1)', down: 'rgba(255,65,65,1)', unchanged: 'rgba(150,150,150,0.9)' },
                borderColor: { up: '#00d264', down: '#ff4141', unchanged: '#969696' },
                yAxisID: 'y'
            },
            {
                label: 'BB Upper', type: 'line', data: bbUpperData, borderColor: 'rgba(0,212,255,0.4)',
                borderWidth: 1, pointRadius: 0, fill: false, borderDash: [4, 4], yAxisID: 'y'
            },
            {
                label: 'BB Lower', type: 'line', data: bbLowerData, borderColor: 'rgba(0,212,255,0.4)',
                borderWidth: 1, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(0,212,255,0.05)', borderDash: [4, 4], yAxisID: 'y'
            },
            {
                label: 'VWAP', type: 'line', data: vwapData, borderColor: '#9d4edd',
                borderWidth: 2, pointRadius: 0, fill: false, yAxisID: 'y'
            }
        ];

        // Add trade plan lines if provided
        if (tradeParams.entryPrice) {
            const ep = parseFloat(tradeParams.entryPrice);
            const sl = parseFloat(tradeParams.stopLoss);
            const tp = parseFloat(tradeParams.takeProfit1);
            
            yMin = Math.min(yMin, ep, sl, tp || ep);
            yMax = Math.max(yMax, ep, sl, tp || ep);

            const len = recent.length;
            const x0 = getX(recent[Math.floor(len * 0.2)]); // Start line at 20% of chart
            const x1 = getX(recent[len - 1]);

            datasets.push({
                label: 'ENTRY', type: 'line',
                data: [{x: x0, y: ep}, {x: x1, y: ep}],
                borderColor: '#f0a500', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false
            });
            if (sl) {
                datasets.push({
                    label: 'STOP', type: 'line',
                    data: [{x: x0, y: sl}, {x: x1, y: sl}],
                    borderColor: '#ff4141', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false
                });
            }
            if (tp) {
                datasets.push({
                    label: 'TP1', type: 'line',
                    data: [{x: x0, y: tp}, {x: x1, y: tp}],
                    borderColor: '#00d264', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false
                });
            }
        }

        const pad = (yMax - yMin) * 0.08;
        
        const chartConfig = {
            type: 'candlestick',
            data: { datasets },
            options: {
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${displaySymbol} Signal Plan  ·  ${tradeParams.direction || 'WAIT'}  ·  VWAP & BB`,
                        color: '#e6edf3', font: { size: 14, weight: 'bold' }
                    },
                    legend: { labels: { color: '#8b949e', boxWidth: 12 } }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'day' },
                        ticks: { color: '#8b949e', maxTicksLimit: 8 },
                        grid:  { color: 'rgba(255,255,255,0.04)' }
                    },
                    y: {
                        position: 'right',
                        min: parseFloat((yMin - pad).toFixed(4)),
                        max: parseFloat((yMax + pad).toFixed(4)),
                        ticks: { color: '#8b949e' },
                        grid:  { color: 'rgba(255,255,255,0.07)' }
                    }
                }
            }
        };

        return await postChart(chartConfig, 860, 500);
    } catch (e) {
        console.error('[SignalChart]', e.message);
        return null;
    }
}


// ─── RSI + MACD PANEL ─────────────────────────────────────────────────────────
async function generateIndicatorChart(candles, displaySymbol) {
    try {
        const recent   = candles.slice(-80);
        const closes   = recent.map(c => c.close);
        const rsiVals  = calcRSI(closes, 14);
        const macdData = calcMACD(closes);
        const hist     = macdData.histogram;
        if (!rsiVals.length) return null;

        const rsiOff  = closes.length - rsiVals.length;
        const histOff = closes.length - hist.length;
        const start   = Math.max(rsiOff, histOff);
        const slice   = recent.slice(start);
        const labels  = slice.map(c => {
            const d = new Date(c.time);
            return `${d.getMonth() + 1}/${d.getDate()}`;
        });
        const rsiSlice  = rsiVals.slice(start - rsiOff);
        const histSlice = hist.slice(start - histOff);

        const chartConfig = {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'RSI (14)', type: 'line',
                        data: rsiSlice,
                        borderColor: '#9d4edd', backgroundColor: 'rgba(157,78,221,0.12)',
                        borderWidth: 2, pointRadius: 0, fill: true, tension: 0.35,
                        yAxisID: 'yRSI'
                    },
                    {
                        label: 'OB 70', type: 'line',
                        data: new Array(labels.length).fill(70),
                        borderColor: 'rgba(255,65,65,0.5)', borderDash: [5, 3],
                        borderWidth: 1, pointRadius: 0, fill: false, yAxisID: 'yRSI'
                    },
                    {
                        label: 'OS 30', type: 'line',
                        data: new Array(labels.length).fill(30),
                        borderColor: 'rgba(0,210,100,0.5)', borderDash: [5, 3],
                        borderWidth: 1, pointRadius: 0, fill: false, yAxisID: 'yRSI'
                    },
                    {
                        label: 'MACD Hist', type: 'bar',
                        data: histSlice,
                        backgroundColor: histSlice.map(v =>
                            v >= 0 ? 'rgba(0,210,100,0.8)' : 'rgba(255,65,65,0.8)'
                        ),
                        borderColor: 'transparent', yAxisID: 'yMACD'
                    }
                ]
            },
            options: {
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${displaySymbol}  ·  RSI(14) + MACD Histogram`,
                        color: '#e6edf3', font: { size: 13, weight: 'bold' }
                    },
                    legend: { labels: { color: '#8b949e', boxWidth: 12 } }
                },
                scales: {
                    x: {
                        ticks: { color: '#8b949e', maxTicksLimit: 8, maxRotation: 45 },
                        grid:  { color: 'rgba(255,255,255,0.04)' }
                    },
                    yRSI: {
                        position: 'right', min: 0, max: 100,
                        ticks: { color: '#9d4edd' },
                        grid:  { color: 'rgba(157,78,221,0.08)' },
                        title: { display: true, text: 'RSI', color: '#9d4edd' }
                    },
                    yMACD: {
                        position: 'left',
                        ticks: { color: '#8b949e' },
                        grid:  { color: 'rgba(255,255,255,0.04)' },
                        title: { display: true, text: 'MACD', color: '#8b949e' }
                    }
                }
            }
        };

        return await postChart(chartConfig, 860, 380);
    } catch (e) {
        console.error('[IndicatorChart]', e.message);
        return null;
    }
}

// ─── LINE CHART fallback ──────────────────────────────────────────────────────
async function generateChart(candles, displaySymbol) {
    try {
        const recent = candles.slice(-60);
        const closes = recent.map(c => parseFloat(c.close.toFixed(4)));
        const ema20  = calcEMA(closes, 20);
        const ema50  = calcEMA(closes, Math.min(50, closes.length - 1));
        const labels = recent.map(c => {
            const d = new Date(c.time);
            return `${d.getMonth() + 1}/${d.getDate()}`;
        });
        const chartConfig = {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Price',  data: closes, borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.07)', borderWidth: 2, pointRadius: 0, fill: true,  tension: 0.1 },
                    { label: 'EMA 20', data: ema20,  borderColor: '#f0a500', borderWidth: 1.5, pointRadius: 0, fill: false },
                    { label: 'EMA 50', data: ema50,  borderColor: '#e05252', borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, fill: false }
                ]
            },
            options: {
                animation: false,
                plugins: {
                    title:  { display: true, text: `${displaySymbol} — Price Chart`, color: '#e6edf3', font: { size: 14, weight: 'bold' } },
                    legend: { labels: { color: '#8b949e' } }
                },
                scales: {
                    x: { ticks: { color: '#8b949e', maxTicksLimit: 8, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { position: 'right', ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.06)' } }
                }
            }
        };
        return await postChart(chartConfig, 800, 420);
    } catch (e) { return null; }
}

// ─── Stochastic Oscillator (5,3,3) ───────────────────────────────────────────
function calcStochastic(candles, kPeriod = 5, kSmooth = 3, dPeriod = 3) {
    const needed = kPeriod + kSmooth + dPeriod;
    if (!candles || candles.length < needed) return null;
    const rawK = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const slice = candles.slice(i - kPeriod + 1, i + 1);
        const hh = Math.max(...slice.map(c => c.high));
        const ll = Math.min(...slice.map(c => c.low));
        const range = hh - ll;
        rawK.push(range > 0 ? ((candles[i].close - ll) / range) * 100 : 50);
    }
    const smoothedK = [];
    for (let i = kSmooth - 1; i < rawK.length; i++) {
        smoothedK.push(rawK.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0) / kSmooth);
    }
    const dValues = [];
    for (let i = dPeriod - 1; i < smoothedK.length; i++) {
        dValues.push(smoothedK.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod);
    }
    if (smoothedK.length < 2 || dValues.length < 2) return null;
    const k = parseFloat(smoothedK[smoothedK.length - 1].toFixed(2));
    const d = parseFloat(dValues[dValues.length - 1].toFixed(2));
    const kPrev = parseFloat(smoothedK[smoothedK.length - 2].toFixed(2));
    const dPrev = parseFloat(dValues[dValues.length - 2].toFixed(2));
    let zone = 'neutral';
    if (k < 20) zone = 'oversold';
    else if (k > 80) zone = 'overbought';
    let crossover = null;
    if (kPrev <= dPrev && k > d) crossover = 'bullish';
    if (kPrev >= dPrev && k < d) crossover = 'bearish';
    return { k, d, kPrev, dPrev, zone, crossover };
}

// ─── Awesome Oscillator ──────────────────────────────────────────────────────
function calcAwesomeOscillator(candles) {
    if (!candles || candles.length < 35) return null;
    const medians = candles.map(c => (c.high + c.low) / 2);
    const aoValues = [];
    for (let i = 33; i < medians.length; i++) {
        const slice = medians.slice(0, i + 1);
        const fast = slice.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const slow = slice.slice(-34).reduce((a, b) => a + b, 0) / 34;
        aoValues.push(fast - slow);
    }
    if (aoValues.length < 2) return null;
    const value = parseFloat(aoValues[aoValues.length - 1].toFixed(4));
    const prev = parseFloat(aoValues[aoValues.length - 2].toFixed(4));
    const color = value > prev ? 'green' : 'red';
    const prevColor = aoValues.length >= 3
        ? (aoValues[aoValues.length - 2] > aoValues[aoValues.length - 3] ? 'green' : 'red') : null;
    let flip = null;
    if (prevColor === 'red' && color === 'green') flip = 'bullish';
    if (prevColor === 'green' && color === 'red') flip = 'bearish';
    return { value, prev, color, prevColor, flip, aoValues };
}

// ─── ADX Calculation ─────────────────────────────────────────────────────────
function calcADX(candles, period = 14) {
    if (!candles || candles.length < period * 2) return { adx: 20, di_plus: 0, di_minus: 0 };
    let sumTR = 0, sumDMp = 0, sumDMn = 0;
    for (let i = 1; i <= period; i++) {
        const h = candles[i].high, l = candles[i].low, pc = candles[i-1].close;
        sumTR += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        const up = candles[i].high - candles[i-1].high;
        const dn = candles[i-1].low - candles[i].low;
        sumDMp += (up > dn && up > 0) ? up : 0;
        sumDMn += (dn > up && dn > 0) ? dn : 0;
    }
    let sTR = sumTR, sDMp = sumDMp, sDMn = sumDMn;
    const dxVals = [];
    for (let i = period + 1; i < candles.length; i++) {
        const h = candles[i].high, l = candles[i].low, pc = candles[i-1].close;
        const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        const up = candles[i].high - candles[i-1].high;
        const dn = candles[i-1].low - candles[i].low;
        sTR = sTR - sTR / period + tr;
        sDMp = sDMp - sDMp / period + ((up > dn && up > 0) ? up : 0);
        sDMn = sDMn - sDMn / period + ((dn > up && dn > 0) ? dn : 0);
        const dip = sTR > 0 ? (sDMp / sTR) * 100 : 0;
        const din = sTR > 0 ? (sDMn / sTR) * 100 : 0;
        const dx = (dip + din) > 0 ? Math.abs(dip - din) / (dip + din) * 100 : 0;
        dxVals.push({ dx, dip, din });
    }
    if (dxVals.length < period) return { adx: 20, di_plus: 0, di_minus: 0 };
    let adx = dxVals.slice(0, period).reduce((a, v) => a + v.dx, 0) / period;
    for (let i = period; i < dxVals.length; i++) {
        adx = (adx * (period - 1) + dxVals[i].dx) / period;
    }
    const last = dxVals[dxVals.length - 1];
    return { adx: parseFloat(adx.toFixed(2)), di_plus: parseFloat(last.dip.toFixed(2)), di_minus: parseFloat(last.din.toFixed(2)) };
}

// ─── BB CHART (candlestick + Bollinger Bands overlay) ─────────────────────────
async function generateBBChart(candles, displaySymbol, lookback = 60) {
    try {
        const recent = candles.slice(-lookback);
        const closes = recent.map(c => c.close);
        const bb = calcBollingerBands(closes, 20, 2);
        const getX = c => typeof c.time === 'number' ? c.time : new Date(c.time).getTime();
        const candleData = recent.map(c => ({ x: getX(c), o: parseFloat(c.open.toFixed(4)), h: parseFloat(c.high.toFixed(4)), l: parseFloat(c.low.toFixed(4)), c: parseFloat(c.close.toFixed(4)) }));
        const bbStart = lookback - bb.length;
        const bbSlice = recent.slice(bbStart);
        const bbUpperData = bbSlice.map((c, i) => ({ x: getX(c), y: bb[i].upper }));
        const bbMiddleData = bbSlice.map((c, i) => ({ x: getX(c), y: bb[i].middle }));
        const bbLowerData = bbSlice.map((c, i) => ({ x: getX(c), y: bb[i].lower }));
        const priceMin = Math.min(...recent.map(c => c.low));
        const priceMax = Math.max(...recent.map(c => c.high));
        const pad = (priceMax - priceMin) * 0.05;
        const lastBB = bb[bb.length - 1];
        const pctB = lastBB ? ((closes[closes.length - 1] - lastBB.lower) / (lastBB.upper - lastBB.lower)).toFixed(3) : '—';
        const bw = lastBB ? (lastBB.upper - lastBB.lower).toFixed(2) : '—';
        const chartConfig = {
            type: 'candlestick',
            data: { datasets: [
                { label: displaySymbol, data: candleData, color: { up: 'rgba(0,210,100,1)', down: 'rgba(255,65,65,1)', unchanged: 'rgba(150,150,150,0.9)' }, borderColor: { up: '#00d264', down: '#ff4141', unchanged: '#969696' }, yAxisID: 'y' },
                { label: 'BB Upper', type: 'line', data: bbUpperData, borderColor: 'rgba(0,212,255,0.5)', borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [4,3], yAxisID: 'y' },
                { label: 'BB Middle', type: 'line', data: bbMiddleData, borderColor: 'rgba(255,165,0,0.6)', borderWidth: 1, pointRadius: 0, fill: false, yAxisID: 'y' },
                { label: 'BB Lower', type: 'line', data: bbLowerData, borderColor: 'rgba(0,212,255,0.5)', borderWidth: 1.5, pointRadius: 0, fill: '-2', backgroundColor: 'rgba(0,212,255,0.04)', borderDash: [4,3], yAxisID: 'y' }
            ]},
            options: { animation: false, plugins: { title: { display: true, text: `${displaySymbol} · BB(20,2) · %B=${pctB} · BW=${bw}`, color: '#e6edf3', font: { size: 14, weight: 'bold' } }, legend: { labels: { color: '#8b949e', boxWidth: 12 } } }, scales: { x: { type: 'time', time: { unit: 'day' }, ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { position: 'right', min: parseFloat((priceMin - pad).toFixed(4)), max: parseFloat((priceMax + pad).toFixed(4)), ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.07)' } } } }
        };
        return await postChart(chartConfig, 860, 500);
    } catch (e) { console.error('[BBChart]', e.message); return null; }
}

// ─── STRATEGY CHART (EMA + BB + VWAP + Volume + Momentum) ─────────────────────
async function generateStratChart(candles, displaySymbol, lookback = 80) {
    try {
        const recent = candles.slice(-lookback);
        const closes = recent.map(c => c.close);
        const ema20 = calcEMA(closes, 20);
        const ema50 = calcEMA(closes, Math.min(50, recent.length - 1));
        const bb = calcBollingerBands(closes, 20, 2);
        const vwap = calcVWAP(recent);
        const volumes = recent.map(c => c.volume || 0);
        const maxVol = Math.max(...volumes) || 1;
        const getX = c => typeof c.time === 'number' ? c.time : new Date(c.time).getTime();
        const candleData = recent.map(c => ({ x: getX(c), o: parseFloat(c.open.toFixed(4)), h: parseFloat(c.high.toFixed(4)), l: parseFloat(c.low.toFixed(4)), c: parseFloat(c.close.toFixed(4)) }));
        const bbStart = lookback - bb.length;
        const bbSlice = recent.slice(bbStart);
        const datasets = [
            { label: displaySymbol, data: candleData, color: { up: 'rgba(0,210,100,1)', down: 'rgba(255,65,65,1)', unchanged: 'rgba(150,150,150,0.9)' }, borderColor: { up: '#00d264', down: '#ff4141', unchanged: '#969696' }, yAxisID: 'y' },
            { label: 'EMA 20', type: 'line', data: recent.map((c, i) => ({ x: getX(c), y: parseFloat(ema20[i].toFixed(4)) })), borderColor: '#f0a500', borderWidth: 2, pointRadius: 0, fill: false, yAxisID: 'y' },
            { label: 'EMA 50', type: 'line', data: recent.map((c, i) => ({ x: getX(c), y: parseFloat(ema50[i].toFixed(4)) })), borderColor: '#e05252', borderWidth: 1.5, borderDash: [6,3], pointRadius: 0, fill: false, yAxisID: 'y' },
            { label: 'BB Upper', type: 'line', data: bbSlice.map((c, i) => ({ x: getX(c), y: bb[i].upper })), borderColor: 'rgba(0,212,255,0.4)', borderWidth: 1, pointRadius: 0, fill: false, borderDash: [4,4], yAxisID: 'y' },
            { label: 'BB Lower', type: 'line', data: bbSlice.map((c, i) => ({ x: getX(c), y: bb[i].lower })), borderColor: 'rgba(0,212,255,0.4)', borderWidth: 1, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(0,212,255,0.04)', borderDash: [4,4], yAxisID: 'y' },
            { label: 'VWAP', type: 'line', data: recent.map((c, i) => ({ x: getX(c), y: vwap[i] })), borderColor: '#9d4edd', borderWidth: 2, pointRadius: 0, fill: false, yAxisID: 'y' },
            { label: 'Volume', type: 'bar', data: recent.map((c, i) => ({ x: getX(c), y: volumes[i] })), backgroundColor: recent.map(c => c.close >= c.open ? 'rgba(0,210,100,0.25)' : 'rgba(255,65,65,0.25)'), borderColor: 'transparent', barPercentage: 0.8, yAxisID: 'yVol' }
        ];
        const priceMin = Math.min(...recent.map(c => c.low));
        const priceMax = Math.max(...recent.map(c => c.high));
        const pad = (priceMax - priceMin) * 0.05;
        // Momentum summary text
        const stoch = calcStochastic(recent);
        const ao = calcAwesomeOscillator(recent);
        const rsi = calcRSI(closes, 14);
        const lastRSI = rsi.length ? rsi[rsi.length - 1] : '—';
        const momText = `RSI:${lastRSI} | Stoch:${stoch ? stoch.k + '/' + stoch.d : '—'} | AO:${ao ? ao.color : '—'}`;
        const chartConfig = {
            type: 'candlestick',
            data: { datasets },
            options: { animation: false, plugins: { title: { display: true, text: `${displaySymbol} Strategy · EMA+BB+VWAP · ${momText}`, color: '#e6edf3', font: { size: 13, weight: 'bold' } }, legend: { labels: { color: '#8b949e', boxWidth: 10, padding: 8 } } }, scales: { x: { type: 'time', time: { unit: 'day' }, ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } }, y: { position: 'right', min: parseFloat((priceMin - pad).toFixed(4)), max: parseFloat((priceMax + pad).toFixed(4)), ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.07)' } }, yVol: { position: 'left', display: false, min: 0, max: maxVol * 5, grid: { display: false } } } }
        };
        return await postChart(chartConfig, 900, 520);
    } catch (e) { console.error('[StratChart]', e.message); return null; }
}

// ─── FULL INDICATOR PANEL (RSI + MACD + Stochastic + AO) ──────────────────────
async function generateFullIndicatorChart(candles, displaySymbol) {
    try {
        const recent = candles.slice(-80);
        const closes = recent.map(c => c.close);
        const rsiVals = calcRSI(closes, 14);
        const macdData = calcMACD(closes);
        const hist = macdData.histogram;
        const stoch = calcStochastic(recent);
        const ao = calcAwesomeOscillator(recent);
        if (!rsiVals.length) return null;
        const rsiOff = closes.length - rsiVals.length;
        const histOff = closes.length - hist.length;
        const start = Math.max(rsiOff, histOff);
        const slice = recent.slice(start);
        const labels = slice.map(c => { const d = new Date(c.time); return `${d.getMonth()+1}/${d.getDate()}`; });
        const rsiSlice = rsiVals.slice(start - rsiOff);
        const histSlice = hist.slice(start - histOff);
        // AO values for the chart
        const aoVals = ao && ao.aoValues ? ao.aoValues : [];
        const aoOff = recent.length - aoVals.length;
        const aoSlice = aoVals.slice(Math.max(0, start - aoOff));
        // Pad arrays to match labels length
        while (aoSlice.length < labels.length) aoSlice.unshift(0);
        const aoSliceTrimmed = aoSlice.slice(-labels.length);
        const stochInfo = stoch ? `K=${stoch.k} D=${stoch.d} (${stoch.zone})` : 'N/A';
        const aoInfo = ao ? `${ao.value > 0 ? '+' : ''}${ao.value} [${ao.color}]${ao.flip ? ' ⚡'+ao.flip : ''}` : 'N/A';
        const chartConfig = {
            type: 'bar',
            data: { labels, datasets: [
                { label: 'RSI (14)', type: 'line', data: rsiSlice, borderColor: '#9d4edd', backgroundColor: 'rgba(157,78,221,0.12)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.35, yAxisID: 'yRSI' },
                { label: 'OB 70', type: 'line', data: new Array(labels.length).fill(70), borderColor: 'rgba(255,65,65,0.5)', borderDash: [5,3], borderWidth: 1, pointRadius: 0, fill: false, yAxisID: 'yRSI' },
                { label: 'OS 30', type: 'line', data: new Array(labels.length).fill(30), borderColor: 'rgba(0,210,100,0.5)', borderDash: [5,3], borderWidth: 1, pointRadius: 0, fill: false, yAxisID: 'yRSI' },
                { label: 'MACD Hist', type: 'bar', data: histSlice, backgroundColor: histSlice.map(v => v >= 0 ? 'rgba(0,210,100,0.7)' : 'rgba(255,65,65,0.7)'), borderColor: 'transparent', yAxisID: 'yMACD' },
                { label: 'AO', type: 'bar', data: aoSliceTrimmed, backgroundColor: aoSliceTrimmed.map(v => v >= 0 ? 'rgba(0,180,255,0.5)' : 'rgba(255,140,0,0.5)'), borderColor: 'transparent', yAxisID: 'yMACD' }
            ]},
            options: { animation: false, plugins: { title: { display: true, text: `${displaySymbol} · RSI+MACD+AO · Stoch: ${stochInfo}`, color: '#e6edf3', font: { size: 13, weight: 'bold' } }, legend: { labels: { color: '#8b949e', boxWidth: 12 } } }, scales: { x: { ticks: { color: '#8b949e', maxTicksLimit: 8, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.04)' } }, yRSI: { position: 'right', min: 0, max: 100, ticks: { color: '#9d4edd' }, grid: { color: 'rgba(157,78,221,0.08)' }, title: { display: true, text: 'RSI', color: '#9d4edd' } }, yMACD: { position: 'left', ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'MACD/AO', color: '#8b949e' } } } }
        };
        return await postChart(chartConfig, 860, 400);
    } catch (e) { console.error('[FullIndicatorChart]', e.message); return null; }
}

// ─── Indicator Snapshot (structured data for dashboard/telegram) ───────────────
function getIndicatorSnapshot(candles, symbol) {
    if (!candles || candles.length < 35) return { error: 'Insufficient data', symbol };
    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1];
    const rsiVals = calcRSI(closes, 14);
    const rsi = rsiVals.length ? parseFloat(rsiVals[rsiVals.length - 1].toFixed(2)) : null;
    const macd = calcMACD(closes);
    const macdHist = macd.histogram.length ? parseFloat(macd.histogram[macd.histogram.length - 1].toFixed(4)) : null;
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, Math.min(50, closes.length - 1));
    const bb = calcBollingerBands(closes, 20, 2);
    const lastBB = bb && bb.length ? bb[bb.length - 1] : null;
    const stoch = calcStochastic(candles);
    const ao = calcAwesomeOscillator(candles);
    const atrVals = calcATR(candles, 14);
    const atr = atrVals.length ? atrVals[atrVals.length - 1] : null;
    const adxResult = calcADX(candles);
    // RSI signal
    const rsiSignal = rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi > 50 ? 'BULLISH' : 'BEARISH';
    // Trend
    const lastEma20 = ema20[ema20.length - 1];
    const lastEma50 = ema50[ema50.length - 1];
    const trend = price > lastEma20 && lastEma20 > lastEma50 ? 'BULLISH' : price < lastEma20 && lastEma20 < lastEma50 ? 'BEARISH' : 'NEUTRAL';
    return {
        symbol, price, trend, timestamp: new Date().toISOString(),
        candle_count: candles.length,
        candle_close_time: candles[candles.length - 1].time || null,
        rsi, rsi_signal: rsiSignal,
        macd: macdHist, macd_signal: macdHist > 0 ? 'BULLISH' : 'BEARISH',
        adx: adxResult.adx, adx_signal: adxResult.adx > 25 ? 'TRENDING' : 'RANGING',
        di_plus: adxResult.di_plus, di_minus: adxResult.di_minus,
        ema20: parseFloat(lastEma20.toFixed(4)),
        ema50: parseFloat(lastEma50.toFixed(4)),
        atr: atr,
        atr_05: atr ? parseFloat((atr * 0.5).toFixed(4)) : null,
        atr_10: atr ? parseFloat((atr * 1.0).toFixed(4)) : null,
        atr_15: atr ? parseFloat((atr * 1.5).toFixed(4)) : null,
        bollinger: lastBB ? (() => {
            const bw = parseFloat((lastBB.upper - lastBB.lower).toFixed(4));
            const pctB = parseFloat(((price - lastBB.lower) / (lastBB.upper - lastBB.lower)).toFixed(4));
            const bwPct = lastBB.middle > 0 ? bw / lastBB.middle : 0;
            const squeezeState = bwPct < 0.02 ? 'SQUEEZE' : bwPct > 0.05 ? 'EXPANSION' : 'NORMAL';
            const priceState = price > lastBB.upper ? 'ABOVE_UPPER' : price < lastBB.lower ? 'BELOW_LOWER' : price > lastBB.middle ? 'UPPER_HALF' : 'LOWER_HALF';
            return {
                upper: lastBB.upper, middle: lastBB.middle, lower: lastBB.lower,
                bandwidth: bw,
                pct_b: pctB,
                state: priceState,
                squeeze_state: squeezeState
            };
        })() : null,
        stochastic: stoch ? {
            k: stoch.k, d: stoch.d, zone: stoch.zone, crossover: stoch.crossover
        } : null,
        awesome_oscillator: ao ? {
            value: ao.value, color: ao.color, flip: ao.flip
        } : null
    };
}

async function generateRSIChart(candles, displaySymbol) {
    return generateIndicatorChart(candles, displaySymbol);
}

module.exports = {
    // Chart generators
    generateCandlestickChart, generateIndicatorChart, generateChart,
    generateRSIChart, generateSignalChart, generateBBChart,
    generateStratChart, generateFullIndicatorChart,
    // Indicator calculations
    calcEMA, calcSMA, calcRSI, calcMACD, calcBollingerBands,
    calcVWAP, calcATR, calcStochastic, calcAwesomeOscillator, calcADX,
    // Snapshot
    getIndicatorSnapshot,
    // HTTP
    postChart
};

