'use strict';

/**
 * OpenClaw local-AI observability snapshot.
 *
 * Read-only by design:
 * - no inference call
 * - no model pull
 * - no prompt input
 * - no trading bridge
 * - no database write
 */

const { getLocalProviderHealth } = require('./local_llm_health.cjs');
const { getLocalLLMPolicy } = require('./local_llm_policy.cjs');
const { getLocalLLMRouterDecision } = require('./local_llm_router.cjs');

function normalizeProviders(source) {
    if (Array.isArray(source)) {
        return source;
    }

    if (Array.isArray(source?.providers)) {
        return source.providers;
    }

    if (Array.isArray(source?.router?.providers)) {
        return source.router.providers;
    }

    return [];
}

function findProvider(providers, providerName) {
    return providers.find((provider) => provider?.provider === providerName) || null;
}

async function getLocalAIObservabilitySnapshot() {
    const generatedAt = new Date().toISOString();
    const issues = [];

    const policy = getLocalLLMPolicy();

    let health = null;
    let router = null;

    try {
        health = await getLocalProviderHealth();
    } catch (error) {
        issues.push({
            component: 'provider_health',
            message: error?.message || 'provider_health_failed'
        });
    }

    try {
        router = await getLocalLLMRouterDecision();
    } catch (error) {
        issues.push({
            component: 'local_llm_router',
            message: error?.message || 'local_llm_router_failed'
        });
    }

    const healthProviders = normalizeProviders(health);
    const routerProviders = normalizeProviders(router);
    const providers = healthProviders.length > 0 ? healthProviders : routerProviders;

    const ollama = findProvider(providers, 'ollama');
    const lmstudio = findProvider(providers, 'lmstudio');

    return {
        ok: true,
        generatedAt,
        scope: 'local_ai_observability_read_only',
        policy,
        router,
        health,
        status: {
            activeProvider: policy.activeProvider,
            approvedModel: policy.approvedModel,
            selectedProvider: router?.selectedProvider || null,
            routerReason: router?.reason || null,
            ollamaOnline: ollama?.online === true,
            ollamaModelCount: Number.isFinite(ollama?.modelCount) ? ollama.modelCount : 0,
            lmStudioOnline: lmstudio?.online === true,
            providerCount: providers.length,
            issueCount: issues.length
        },
        safety: {
            readOnly: true,
            acceptsPromptInput: false,
            triggersInference: false,
            pullsModel: false,
            changesProviderPolicy: false,
            writesDatabase: false,
            touchesTradingExecution: false,
            touchesStrategyRuntime: false
        },
        issues
    };
}

module.exports = {
    getLocalAIObservabilitySnapshot
};