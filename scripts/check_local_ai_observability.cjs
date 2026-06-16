'use strict';

const { getLocalAIObservabilitySnapshot } = require('../lib/providers/local_ai_observability.cjs');

(async () => {
    try {
        const snapshot = await getLocalAIObservabilitySnapshot();

        console.log('OpenClaw Local-AI Observability');
        console.log(`Generated At: ${snapshot.generatedAt}`);
        console.log('');
        console.log(`Scope: ${snapshot.scope}`);
        console.log(`Active Provider: ${snapshot.status.activeProvider}`);
        console.log(`Approved Model: ${snapshot.status.approvedModel}`);
        console.log(`Selected Provider: ${snapshot.status.selectedProvider || 'n/a'}`);
        console.log(`Router Reason: ${snapshot.status.routerReason || 'n/a'}`);
        console.log(`Ollama Online: ${snapshot.status.ollamaOnline}`);
        console.log(`Ollama Model Count: ${snapshot.status.ollamaModelCount}`);
        console.log(`LM Studio Online: ${snapshot.status.lmStudioOnline}`);
        console.log('');
        console.log(`Read Only: ${snapshot.safety.readOnly}`);
        console.log(`Accepts Prompt Input: ${snapshot.safety.acceptsPromptInput}`);
        console.log(`Triggers Inference: ${snapshot.safety.triggersInference}`);
        console.log(`Pulls Model: ${snapshot.safety.pullsModel}`);
        console.log(`Writes Database: ${snapshot.safety.writesDatabase}`);
        console.log(`Touches Trading Execution: ${snapshot.safety.touchesTradingExecution}`);
        console.log(`Touches Strategy Runtime: ${snapshot.safety.touchesStrategyRuntime}`);
        console.log(`Issue Count: ${snapshot.status.issueCount}`);

        const safe =
            snapshot.safety.readOnly === true &&
            snapshot.safety.acceptsPromptInput === false &&
            snapshot.safety.triggersInference === false &&
            snapshot.safety.pullsModel === false &&
            snapshot.safety.writesDatabase === false &&
            snapshot.safety.touchesTradingExecution === false &&
            snapshot.safety.touchesStrategyRuntime === false;

        process.exit(safe ? 0 : 1);
    } catch (error) {
        console.error(`Local-AI observability check failed: ${error?.message || error}`);
        process.exit(1);
    }
})();