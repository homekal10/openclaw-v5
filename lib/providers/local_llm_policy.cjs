const LOCAL_LLM_POLICY = Object.freeze({
  activeProvider: 'ollama',
  lmStudioEnabled: false,
  cloudProvidersEnabledByDefault: false,
  approvedModel: 'openclaw-phi3-mini:latest',
  maxContext: 2048,
  maxPredict: 64,
  allowInferenceByDefault: false,
});

function getLocalLLMPolicy() {
  return { ...LOCAL_LLM_POLICY };
}

module.exports = {
  LOCAL_LLM_POLICY,
  getLocalLLMPolicy,
};
