/**
 * strategy_router.cjs — OpenClaw Expert Edition Strategy Router
 * 
 * Routes signals through setup-specific indicator filters.
 * New indicators (BB, Stoch, AO, ATR) are SUPPORTING evidence only.
 * They do NOT create trades by themselves.
 *
 * Expert Team:
 *   [Quant] BB/Stoch/AO are supporting filters — never primary triggers
 *   [Signal Auditor] Final BUY/SELL still requires verifier approval
 *   [Risk] ATR 0.5× is micro-scalp reference only, not institutional default
 */
'use strict';

const path = require('path');

/**
 * Route indicator confluence for a given setup type.
 * @param {string} setupType - e.g. 'london_sweep_reversal'
 * @param {object} indicators - from getIndicatorSnapshot()
 * @returns {{ indicator_confluence: string[], indicator_conflicts: string[], indicator_score: number }}
 */
function routeIndicators(setupType, indicators) {
    if (!indicators || indicators.error) {
        return { indicator_confluence: [], indicator_conflicts: ['Indicators unavailable'], indicator_score: 0 };
    }

    const confluence = [];
    const conflicts = [];
    let score = 0;

    const bb = indicators.bollinger;
    const stoch = indicators.stochastic;
    const ao = indicators.awesome_oscillator;
    const atr = indicators.atr;
    const adx = indicators.adx;
    const trend = indicators.trend;

    switch (setupType) {
        case 'london_sweep_reversal':
            // Require sweep → prefer BB stretch, Stoch exhaustion, AO flip
            if (bb && (bb.pct_b <= 0.1 || bb.pct_b >= 0.9)) { confluence.push('BB: Price at band edge (%B=' + bb.pct_b + ')'); score += 5; }
            else if (bb) { conflicts.push('BB: Price mid-band — no stretch'); }
            if (stoch && (stoch.zone === 'oversold' || stoch.zone === 'overbought')) { confluence.push('Stoch: ' + stoch.zone + ' (K=' + stoch.k + ')'); score += 5; }
            if (ao && ao.flip) { confluence.push('AO: ' + ao.flip + ' flip detected'); score += 5; }
            if (atr) { confluence.push('ATR stop guide: ' + (atr * 1.0).toFixed(4) + ' beyond sweep'); score += 2; }
            break;

        case 'ny_continuation':
            // Require trend → avoid Stoch extreme w/o pullback, AO aligned
            if (stoch && (stoch.zone === 'overbought' || stoch.zone === 'oversold') && !stoch.crossover) {
                conflicts.push('Stoch: Extreme without pullback crossover — avoid chase');
            } else if (stoch && stoch.zone === 'neutral') { confluence.push('Stoch: Reset from extreme — good entry'); score += 4; }
            if (ao && ao.color === (trend === 'BULLISH' ? 'green' : 'red')) { confluence.push('AO: Aligned with trend (' + ao.color + ')'); score += 5; }
            else if (ao) { conflicts.push('AO: Misaligned with trend'); }
            if (bb && bb.state === 'UPPER_HALF' && trend === 'BULLISH') { confluence.push('BB: Holding above midline'); score += 3; }
            if (bb && bb.state === 'LOWER_HALF' && trend === 'BEARISH') { confluence.push('BB: Holding below midline'); score += 3; }
            break;

        case 'ema_pullback_fvg':
            // Require trend, price near EMA/FVG, Stoch reset, AO resumes
            if (stoch && stoch.crossover) { confluence.push('Stoch: Crossover from extreme — momentum resuming'); score += 5; }
            else if (stoch && stoch.zone !== 'neutral') { confluence.push('Stoch: In ' + stoch.zone + ' zone — watch for crossover'); score += 2; }
            if (ao && ((trend === 'BULLISH' && ao.color === 'green') || (trend === 'BEARISH' && ao.color === 'red'))) {
                confluence.push('AO: Momentum resuming (' + ao.color + ')'); score += 5;
            }
            if (atr) { confluence.push('ATR stop: ' + (atr * 1.0).toFixed(4) + ' beyond FVG/structure'); score += 2; }
            break;

        case 'range_sweep_trap':
            // Require range, sweep of range boundary, BB stretch, Stoch extreme, AO flip
            if (bb && (bb.pct_b <= 0.05 || bb.pct_b >= 0.95)) { confluence.push('BB: At band extreme (%B=' + bb.pct_b + ')'); score += 5; }
            if (stoch && (stoch.zone === 'oversold' || stoch.zone === 'overbought')) { confluence.push('Stoch: ' + stoch.zone); score += 5; }
            if (ao && ao.flip) { confluence.push('AO: Momentum flip — ' + ao.flip); score += 5; }
            else if (ao) { conflicts.push('AO: No flip yet — wait for confirmation'); }
            break;

        case 'trend_breakout_retest':
            // Require structure break, BB expansion, AO confirms, ATR expansion
            if (bb && bb.bandwidth > 0) { confluence.push('BB: Expansion (BW=' + bb.bandwidth.toFixed(2) + ')'); score += 4; }
            if (ao && ao.color === (trend === 'BULLISH' ? 'green' : 'red')) { confluence.push('AO: Confirms breakout direction'); score += 5; }
            if (adx && adx > 25) { confluence.push('ADX: Trending (' + adx + ')'); score += 3; }
            break;

        case 'asian_range_break':
            // Avoid false breaks without AO/ATR expansion
            if (ao && !ao.flip && ao.color === 'red') { conflicts.push('AO: No expansion — possible false break'); }
            else if (ao && ao.flip === 'bullish') { confluence.push('AO: Bullish expansion — break confirmed'); score += 5; }
            if (atr && adx && adx > 20) { confluence.push('ATR expansion with trending ADX — break valid'); score += 4; }
            break;

        case 'liquidity_grab_reversal':
            // Require sweep + FVG/reclaim, Stoch exhaustion, AO flip
            if (stoch && (stoch.zone === 'oversold' || stoch.zone === 'overbought')) { confluence.push('Stoch: Exhaustion at grab (' + stoch.zone + ')'); score += 5; }
            if (ao && ao.flip) { confluence.push('AO: Reversal flip — ' + ao.flip); score += 5; }
            else { conflicts.push('AO: No flip — reversal not confirmed'); }
            if (atr) { confluence.push('ATR stop: ' + (atr * 1.0).toFixed(4) + ' beyond grab extreme'); score += 2; }
            break;

        default:
            // Unknown setup — provide generic indicator context
            if (stoch) confluence.push('Stoch: K=' + stoch.k + ' (' + stoch.zone + ')');
            if (ao) confluence.push('AO: ' + ao.color + (ao.flip ? ' FLIP' : ''));
            if (bb) confluence.push('BB: %B=' + bb.pct_b);
            break;
    }

    return {
        indicator_confluence: confluence,
        indicator_conflicts: conflicts,
        indicator_score: Math.min(20, score)
    };
}

/**
 * Get ATR-based stop/target guides.
 * @param {number} atr - Current ATR value
 * @param {string} direction - 'BUY' or 'SELL'
 * @param {number} price - Current price
 * @returns {object} Stop and target guides
 */
function getATRGuides(atr, direction, price) {
    if (!atr || !price) return null;
    const isBuy = direction === 'BUY';
    return {
        micro_scalp_sl: parseFloat((price + (isBuy ? -1 : 1) * atr * 0.5).toFixed(4)),
        micro_scalp_tp: parseFloat((price + (isBuy ? 1 : -1) * atr * 0.5).toFixed(4)),
        normal_sl: parseFloat((price + (isBuy ? -1 : 1) * atr * 1.0).toFixed(4)),
        normal_tp: parseFloat((price + (isBuy ? 1 : -1) * atr * 1.8).toFixed(4)),
        volatility_sl: parseFloat((price + (isBuy ? -1 : 1) * atr * 1.5).toFixed(4)),
        micro_rr: '1:1 (scalp reference only)',
        normal_rr: '1:1.8 (institutional minimum)',
        label: atr * 0.5 === atr * 0.5 ? '0.5×ATR = ' + (atr * 0.5).toFixed(4) + ' | 1.0×ATR = ' + atr.toFixed(4) + ' | 1.5×ATR = ' + (atr * 1.5).toFixed(4) : ''
    };
}

module.exports = { routeIndicators, getATRGuides };
