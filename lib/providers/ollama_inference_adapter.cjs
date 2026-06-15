const {
  OLLAMA_DEFAULT_BASE_URL,
  normalizeBaseUrl,
} = require('./local_llm_health.cjs');
const {
  getLocalLLMPolicy,
} = require('./local_llm_policy.cjs');

const DEFAULT_TIMEOUT_MS = 60000;

function previewPrompt(prompt) {
  return String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function resultBase(prompt, policy) {
  return {
    ok: false,
    model: policy.approvedModel,
    promptPreview: previewPrompt(prompt),
    responseText: null,
    latencyMs: null,
    generatedAt: new Date().toISOString(),
    error: null,
  };
}

function safeErrorMessage(error) {
  if (!error) return 'unknown_error';
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'request_timeout';
  return String(error.message || error).slice(0, 120);
}

async function runOllamaInferenceOnce(options = {}) {
  const policy = getLocalLLMPolicy();
  const prompt = String(options.prompt || '').trim();
  const base = resultBase(prompt, policy);

  if (policy.activeProvider !== 'ollama') {
    return { ...base, error: 'policy_active_provider_not_ollama' };
  }

  if (policy.allowInferenceByDefault === true) {
    return { ...base, error: 'policy_inference_default_enabled_refused' };
  }

  if (options.allowLocalInference !== true) {
    return { ...base, error: 'local_inference_requires_explicit_allow' };
  }

  if (!prompt) {
    return { ...base, error: 'prompt_required' };
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.OLLAMA_BASE_URL, OLLAMA_DEFAULT_BASE_URL);
  const url = new URL('/api/generate', `${baseUrl}/`).toString();
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model: policy.approvedModel,
        prompt,
        stream: false,
        options: {
          num_ctx: policy.maxContext,
          num_predict: policy.maxPredict,
          temperature: 0.1,
        },
      }),
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return { ...base, latencyMs, error: `http_${response.status}` };
    }

    const data = await response.json().catch(() => null);
    const responseText = String(data?.response || '').trim();

    if (!responseText) {
      return { ...base, latencyMs, error: 'empty_response' };
    }

    return {
      ...base,
      ok: true,
      responseText,
      latencyMs,
      generatedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      latencyMs: null,
      generatedAt: new Date().toISOString(),
      error: safeErrorMessage(error),
    };
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  runOllamaInferenceOnce,
};
