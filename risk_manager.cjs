/**
 * risk_manager.cjs — Professional risk & position sizing
 * R:R displayed as Reward:Risk (X:1), ATR-based stops,
 * position sizing, confluence scoring (70% threshold)
 */

const MIN_REWARD_RISK = 2.0;    // Minimum Reward:Risk = 2:1
const MIN_SETUP_SCORE = 40;     // Minimum setup score to generate signal

function evaluate(analysis, symbolInput, accountSize = null) {
    const {
        trend, currentPrice, nearSupport, nearResistance,
        atr, rsi, volumeTrend, adx, macd, divergence
    } = analysis;

    if (!atr || atr <= 0) return null;

    // ── ATR-based dynamic stop distances ──
    const slMultiplier = 1.5; // SL = 1.5 × ATR below/above entry
    const tpMultiplier = 3.5; // Initial TP target for R:R calc

    let direction, entry, stopLoss, takeProfit;

    if (trend === 'BULLISH') {
        direction = 'LONG';
        entry     = currentPrice;
        // Use ATR-based SL — also validates against support
        const atrSL = currentPrice - (atr * slMultiplier);
        stopLoss    = nearSupport ? Math.max(nearSupport - atr * 0.3, atrSL) : atrSL;
        takeProfit  = nearResistance || (currentPrice + (currentPrice - stopLoss) * tpMultiplier);
    } else if (trend === 'BEARISH') {
        direction = 'SHORT';
        entry     = currentPrice;
        const atrSL = currentPrice + (atr * slMultiplier);
        stopLoss    = nearResistance ? Math.min(nearResistance + atr * 0.3, atrSL) : atrSL;
        takeProfit  = nearSupport || (currentPrice - (stopLoss - currentPrice) * tpMultiplier);
    } else {
        return null; // No trade in ranging market
    }

    const risk   = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (risk <= 0) return null;

    const rewardRisk = parseFloat((reward / risk).toFixed(2)); // Reward:Risk ratio (want ≥ 2.0)

    // ── Reject if Reward:Risk below threshold ──
    if (rewardRisk < MIN_REWARD_RISK) return null;

    // ── Divergence filter ──
    if (divergence === 'BEARISH_DIVERGENCE' && direction === 'LONG')  return null;
    if (divergence === 'BULLISH_DIVERGENCE' && direction === 'SHORT') return null;

    // ── Volume confirmation ──
    if (volumeTrend === 'DECLINING' && rewardRisk < 2.5) return null;

    // ── Setup Score ──
    const { calcSetupScore } = require('./strategy_engine.cjs');
    const score = calcSetupScore({
        trend, rsi, rr: rewardRisk,
        volumeTrend, adx, macd, divergence
    });

    if (score < MIN_SETUP_SCORE) return null;

    // ── Confidence level ──
    let confidence;
    if (score >= 75 && rewardRisk >= 3)      confidence = 'HIGH';
    else if (score >= 55 && rewardRisk >= 2) confidence = 'MEDIUM';
    else                                      confidence = 'LOW';

    // ── Position sizing (if account size provided) ──
    let positionSize = null;
    if (accountSize && accountSize > 0) {
        const riskPercent = confidence === 'HIGH' ? 2 : confidence === 'MEDIUM' ? 1 : 0.5;
        const riskAmount  = accountSize * (riskPercent / 100);
        const units       = parseFloat((riskAmount / risk).toFixed(4));
        positionSize = { riskPercent, riskAmount: riskAmount.toFixed(2), units, currency: 'USD' };
    }

    return {
        direction,
        entry:      parseFloat(entry.toFixed(entry > 100 ? 2 : 5)),
        stopLoss:   parseFloat(stopLoss.toFixed(stopLoss > 100 ? 2 : 5)),
        takeProfit: parseFloat(takeProfit.toFixed(takeProfit > 100 ? 2 : 5)),
        rewardRisk,          // NEW: Reward:Risk (≥2 = valid)
        rr: rewardRisk,      // backward compat
        atrRisk: parseFloat(risk.toFixed(risk > 100 ? 2 : 5)),
        score,
        confidence,
        positionSize
    };
}

// ── Watchlist alert: check if R:R improved ──
function checkAlertCondition(analysis, targetRewardRisk = 2.0) {
    const signal = evaluate(analysis, '', null);
    if (!signal) return null;
    if (signal.rewardRisk >= targetRewardRisk) return signal;
    return null;
}

module.exports = { evaluate, checkAlertCondition };
