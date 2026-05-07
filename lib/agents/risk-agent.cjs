/**
 * risk-agent.cjs — OpenClaw Risk Agent
 *
 * Role: Capital protection first. Validate every aspect of risk before approval.
 *
 * Hard blockers (any one = risk_decision REJECTED):
 *   - No stop loss
 *   - Vague invalidation
 *   - R:R < 1.8
 *   - Stop too tight (< 0.8 ATR) or too wide (> 3.5 ATR)
 *   - Abnormal spread
 */

'use strict';

// ─── Spread Table (typical max acceptable spread by asset) ────────────────────
const MAX_SPREAD = {
    XAUUSD:  0.50,   // $0.50
    BTCUSD:  25.0,   // $25
    BTCUSDT: 25.0,
    BTC:     25.0,
    EURUSD:  0.0003, // 3 pips
    GBPUSD:  0.0004,
    USDJPY:  0.04,
    NAS100:  2.0,
    US30:    3.0,
    DEFAULT: 0.001   // generic fallback
};

/**
 * runRiskAgent(params) → RiskOutput
 *
 * @param {Object} params
 * @param {number} params.entryPrice
 * @param {number} params.stopLoss
 * @param {number} params.takeProfit1
 * @param {number} params.takeProfit2
 * @param {string} params.direction       'LONG' | 'SHORT'
 * @param {string} params.symbol
 * @param {number} params.atr
 * @param {number|null} params.accountSize
 * @param {string} params.invalidationLevel  specific price level as string
 * @param {number} params.spread             current spread (optional)
 * @param {string} params.eventRiskLevel     'HIGH' | 'MEDIUM' | 'LOW'
 */
async function runRiskAgent(params) {
    const startTime = Date.now();
    const {
        entryPrice, stopLoss, takeProfit1, takeProfit2,
        direction = 'LONG', symbol = '', atr, accountSize,
        invalidationLevel, spread, eventRiskLevel = 'LOW'
    } = params;

    const blockers  = [];
    const warnings  = [];
    const whyTrade  = [];
    const whyNot    = [];

    // ── Validate inputs ───────────────────────────────────────────────────────
    if (!entryPrice || !stopLoss) {
        return buildRejected('No entry price or stop loss provided', Date.now() - startTime);
    }

    // ── Stop loss validation ──────────────────────────────────────────────────
    const isLong    = direction === 'LONG';
    const stopValid = isLong ? stopLoss < entryPrice : stopLoss > entryPrice;

    if (!stopValid) {
        blockers.push(`Stop loss ${stopLoss} is on wrong side of entry ${entryPrice} for ${direction}`);
    }

    // ── Invalidation validation ────────────────────────────────────────────────
    const invStr = String(invalidationLevel || '');
    const invValid = invStr.length > 0 &&
        !invStr.toLowerCase().includes('vague') &&
        !invStr.toLowerCase().includes('unclear') &&
        !invStr.toLowerCase().includes('tbd') &&
        parseFloat(invStr) > 0;

    if (!invValid) {
        blockers.push(`Invalidation is vague or missing: "${invStr}" — specific price level required`);
    }

    // ── R:R calculation ────────────────────────────────────────────────────────
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const tp1Distance  = takeProfit1 ? Math.abs(takeProfit1 - entryPrice) : 0;
    const tp2Distance  = takeProfit2 ? Math.abs(takeProfit2 - entryPrice) : 0;
    const rr1 = stopDistance > 0 ? parseFloat((tp1Distance / stopDistance).toFixed(2)) : 0;
    const rr2 = stopDistance > 0 ? parseFloat((tp2Distance / stopDistance).toFixed(2)) : 0;

    if (rr1 < 1.8) {
        blockers.push(`R:R to TP1 is ${rr1}:1 — minimum 1.8 required`);
    }

    // ── Stop distance vs ATR ───────────────────────────────────────────────────
    let stopAtrRatio = null;
    if (atr && atr > 0) {
        stopAtrRatio = parseFloat((stopDistance / atr).toFixed(2));
        if (stopAtrRatio < 0.5) {
            blockers.push(`Stop is too tight: ${stopAtrRatio}x ATR — minimum 0.5x ATR needed to avoid noise`);
        } else if (stopAtrRatio > 4.0) {
            warnings.push(`Stop is wide: ${stopAtrRatio}x ATR — may reduce position size significantly`);
        }
    }

    // ── Spread check ───────────────────────────────────────────────────────────
    const assetKey = Object.keys(MAX_SPREAD).find(k => symbol.toUpperCase().includes(k)) || 'DEFAULT';
    const maxSpread = MAX_SPREAD[assetKey];
    const spreadAcceptable = spread == null ? true : spread <= maxSpread;
    const spreadRatio = spread && stopDistance > 0
        ? parseFloat((spread / stopDistance * 100).toFixed(1))
        : null;

    if (!spreadAcceptable) {
        blockers.push(`Spread ${spread} exceeds max ${maxSpread} for ${symbol}`);
    }
    if (spreadRatio && spreadRatio > 25) {
        warnings.push(`Spread is ${spreadRatio}% of stop distance — high spread cost`);
    }

    // ── Event risk adjustment ──────────────────────────────────────────────────
    let eventRiskAdj = 0;
    if (eventRiskLevel === 'HIGH') {
        eventRiskAdj = -5;
        warnings.push('High event risk — position size should be 50% of normal');
    } else if (eventRiskLevel === 'MEDIUM') {
        eventRiskAdj = -2;
        warnings.push('Medium event risk — consider reduced size');
    }

    // ── Risk score (max 10) ────────────────────────────────────────────────────
    let riskScore = 0;
    if (rr1 >= 3.0) riskScore += 5;
    else if (rr1 >= 2.5) riskScore += 4;
    else if (rr1 >= 2.0) riskScore += 3;
    else if (rr1 >= 1.8) riskScore += 2;

    if (stopValid && invValid) riskScore += 3;
    else if (stopValid || invValid) riskScore += 1;

    if (spreadAcceptable) riskScore += 2;

    riskScore = Math.max(0, Math.min(10, riskScore + eventRiskAdj));

    // ── Position sizing ────────────────────────────────────────────────────────
    let positionSize = null;
    let dollarRisk   = null;
    if (accountSize && accountSize > 0 && stopDistance > 0) {
        dollarRisk   = parseFloat((accountSize * 0.01).toFixed(2)); // 1% risk
        positionSize = parseFloat((dollarRisk / stopDistance).toFixed(4));
        if (eventRiskLevel === 'HIGH') {
            positionSize = parseFloat((positionSize * 0.5).toFixed(4));
            dollarRisk   = parseFloat((dollarRisk * 0.5).toFixed(2));
        }
    }

    // ── Risk decision ──────────────────────────────────────────────────────────
    const riskDecision = blockers.length > 0 ? 'REJECTED' : riskScore >= 7 ? 'APPROVED' : 'CAUTION';

    // ── Build why_trade / why_not_trade ────────────────────────────────────────
    if (rr1 >= 2.0) whyTrade.push(`Strong R:R of ${rr1}:1 to TP1`);
    if (rr2 >= 3.0) whyTrade.push(`Extended R:R of ${rr2}:1 to TP2`);
    if (invValid)   whyTrade.push(`Clear invalidation at ${invalidationLevel}`);
    if (stopAtrRatio && stopAtrRatio >= 1.0 && stopAtrRatio <= 2.5) {
        whyTrade.push(`Stop well-placed at ${stopAtrRatio}x ATR`);
    }

    blockers.forEach(b => whyNot.push(b));
    warnings.forEach(w => whyNot.push(`⚠️ ${w}`));

    return {
        symbol,
        risk_status:    riskDecision,
        risk_decision:  riskDecision,
        risk_score:     riskScore,
        rr_value:       rr1,
        rr_to_tp2:      rr2,
        stop_distance:  parseFloat(stopDistance.toFixed(5)),
        stop_atr_ratio: stopAtrRatio,
        stop_validation: stopValid ? 'VALID' : 'INVALID',
        invalidation_validation: invValid ? 'VALID' : 'INVALID',
        spread_status:  spreadAcceptable ? 'ACCEPTABLE' : 'HIGH',
        spread_pct_of_stop: spreadRatio,
        event_risk_adjustment: eventRiskAdj,
        position_size:  positionSize,
        dollar_risk:    dollarRisk,
        account_size:   accountSize || null,
        blockers,
        warnings,
        why_trade:      whyTrade,
        why_not_trade:  whyNot,
        needed_confirmation: riskDecision === 'REJECTED'
            ? blockers.map(b => `Resolve: ${b}`)
            : ['Risk validation passed'],
        run_duration_ms: Date.now() - startTime
    };
}

function buildRejected(reason, duration) {
    return {
        risk_decision: 'REJECTED',
        risk_status:   'REJECTED',
        risk_score:    0,
        blockers:      [reason],
        why_not_trade: [reason],
        why_trade:     [],
        run_duration_ms: duration
    };
}

module.exports = { runRiskAgent };
