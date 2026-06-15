const {
  getLocalProviderHealth,
  DEFAULT_TIMEOUT_MS,
} = require('./local_llm_health.cjs');
const {
  getLocalLLMPolicy,
} = require('./local_llm_policy.cjs');

function findProvider(providers, providerName) {
  return providers.find((provider) => provider.provider === providerName) || null;
}

function buildDecision(providers) {
  const policy = getLocalLLMPolicy();
  const ollama = findProvider(providers, 'ollama');

  if (policy.activeProvider === 'ollama' && ollama?.online) {
    return {
      ok: true,
      selectedProvider: 'ollama',
      reason: 'ollama_online_policy_primary',
    };
  }

  return {
    ok: false,
    selectedProvider: null,
    reason: 'ollama_offline_no_fallback_policy',
  };
}

async function getLocalLLMRouterDecision(options = {}) {
  try {
    const providers = await getLocalProviderHealth({
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      ollamaBaseUrl: options.ollamaBaseUrl,
      lmstudioBaseUrl: options.lmstudioBaseUrl,
    });
    const decision = buildDecision(providers);

    return {
      ok: decision.ok,
      selectedProvider: decision.selectedProvider,
      reason: decision.reason,
      generatedAt: new Date().toISOString(),
      policy: getLocalLLMPolicy(),
      providers,
    };
  } catch {
    return {
      ok: false,
      selectedProvider: null,
      reason: 'router_health_check_failed',
      generatedAt: new Date().toISOString(),
      policy: getLocalLLMPolicy(),
      providers: [],
    };
  }
}

module.exports = {
  buildDecision,
  getLocalLLMRouterDecision,
};
