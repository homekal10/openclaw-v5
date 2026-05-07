/**
 * realtime-scanner.cjs — Background Signal Scanner
 * Runs the full institutional orchestrator across priority assets.
 * Only alerts Telegram if the signal is highly rated and veto-clear.
 */

'use strict';

const { runOrchestrator } = require('../orchestration/orchestrator.cjs');
const { generateSignalChart } = require('../../chart_engine.cjs');
const { fetchCandles } = require('../../market_fetcher.cjs');

const PRIORITY_ASSETS = ['XAUUSD', 'BTCUSD', 'ETHUSD', 'EURUSD', 'GBPUSD'];

async function runRealtimeScanner(bot, sendPhoto, bridge) {
    console.log('[RealtimeScanner] Starting 15-min background scan...');
    let found = 0;

    for (const sym of PRIORITY_ASSETS) {
        try {
            // Run orchestrator silently
            const result = await runOrchestrator(sym, { command: "scanner", silent: true });
            
            if (result && (result.final_action === 'BUY' || result.final_action === 'SELL')) {
                // We only care about high conviction setups for auto-alerts
                if (result.total_score >= 75) {
                    found++;
                    console.log(`[RealtimeScanner] 🚨 High-quality signal found for ${sym}`);
                    
                    // Alert users (Broadcast to a specific channel or main admin group)
                    // For now, we will assume an environment variable or default admin
                    const targetChat = process.env.ADMIN_USER_ID; 
                    
                    if (targetChat && bot) {
                        const alertMsg = `🚨 *REAL-TIME SIGNAL ALERT* 🚨\n\n` + result.formatted_message;
                        bot.sendMessage(targetChat, alertMsg, { parse_mode: 'Markdown' });

                        // Attach Chart
                        try {
                            const { candles, display } = await fetchCandles(sym);
                            const tradeParams = {
                                direction: result.final_action,
                                entryPrice: result.entry_price,
                                stopLoss: result.stop_loss,
                                takeProfit1: result.take_profit_1
                            };
                            const sigChart = await generateSignalChart(candles, display, tradeParams);
                            if (sigChart && sendPhoto) {
                                setTimeout(() => {
                                    sendPhoto(targetChat, sigChart, `🕯 *${display}* Auto-Scan Chart`, { parse_mode: 'Markdown' });
                                }, 1000);
                            }
                        } catch(e) {
                            console.warn(`[RealtimeScanner] Chart fail for ${sym}:`, e.message);
                        }
                    }

                    // Push to dashboard
                    if (bridge) {
                        bridge.pushSignal({
                            symbol:     sym,
                            direction:  result.final_action,
                            confidence: result.confidence,
                            score:      result.total_score,
                            setup_type: result.setup_type,
                            entry:      result.entry_price,
                            stopLoss:   result.stop_loss,
                            takeProfit: result.take_profit_1,
                            is_auto:    true
                        }).catch(() => {});
                    }
                }
            }
        } catch (e) {
            console.error(`[RealtimeScanner] Failed to scan ${sym}:`, e.message);
        }
        
        // Delay between assets to avoid rate limits
        await new Promise(r => setTimeout(r, 2000));
    }
    
    console.log(`[RealtimeScanner] Scan complete. Found ${found} actionable signals.`);
    return found;
}

module.exports = { runRealtimeScanner, PRIORITY_ASSETS };
