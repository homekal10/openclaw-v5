const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';
const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234';
const DEFAULT_TIMEOUT_MS = 2500;

function normalizeBaseUrl(baseUrl, fallbackBaseUrl) {
  const candidate = String(baseUrl || fallbackBaseUrl || '').trim();
  if (!candidate) {
    return fallbackBaseUrl;
  }
  return candidate.replace(/\/+$/, '');
}

function safeErrorMessage(error) {
  if (!error) {
    return 'unknown_error';
  }
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return 'request_timeout';
  }

  const message = String(error.message || error).toLowerCase();
  if (message.includes('econnrefused')) {
    return 'connection_refused';
  }
  if (message.includes('fetch failed')) {
    return 'fetch_failed';
  }
  if (message.includes('network')) {
    return 'network_error';
  }

  return String(error.message || 'unknown_error').slice(0, 120);
}

function buildOfflineStatus(provider, baseUrl, error, latencyMs = null) {
  return {
    provider,
    baseUrl,
    online: false,
    latencyMs,
    modelCount: 0,
    models: [],
    error: error || 'offline',
  };
}

async function requestJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        data: null,
        error: `http_${response.status}`,
      };
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      return {
        ok: false,
        latencyMs,
        data: null,
        error: 'invalid_json',
      };
    }

    return {
      ok: true,
      latencyMs,
      data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      data: null,
      error: safeErrorMessage(error),
    };
  }
}

function extractOllamaModels(payload) {
  if (!Array.isArray(payload?.models)) {
    return [];
  }

  return payload.models
    .map((model) => String(model?.name || model?.model || '').trim())
    .filter(Boolean);
}

function extractLmStudioModels(payload) {
  if (!Array.isArray(payload?.data)) {
    return [];
  }

  return payload.data
    .map((model) => String(model?.id || model?.name || '').trim())
    .filter(Boolean);
}

async function checkOllamaHealth(options = {}) {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl || process.env.OLLAMA_BASE_URL,
    OLLAMA_DEFAULT_BASE_URL
  );
  const targetUrl = new URL('/api/tags', `${baseUrl}/`).toString();
  const result = await requestJson(targetUrl, options.timeoutMs || DEFAULT_TIMEOUT_MS);

  if (!result.ok) {
    return buildOfflineStatus('ollama', baseUrl, result.error, result.latencyMs);
  }

  const models = extractOllamaModels(result.data);
  return {
    provider: 'ollama',
    baseUrl,
    online: true,
    latencyMs: result.latencyMs,
    modelCount: models.length,
    models,
    error: null,
  };
}

async function checkLMStudioHealth(options = {}) {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl || process.env.LMSTUDIO_BASE_URL,
    LMSTUDIO_DEFAULT_BASE_URL
  );
  const targetUrl = new URL('/v1/models', `${baseUrl}/`).toString();
  const result = await requestJson(targetUrl, options.timeoutMs || DEFAULT_TIMEOUT_MS);

  if (!result.ok) {
    return buildOfflineStatus('lmstudio', baseUrl, result.error, result.latencyMs);
  }

  const models = extractLmStudioModels(result.data);
  return {
    provider: 'lmstudio',
    baseUrl,
    online: true,
    latencyMs: result.latencyMs,
    modelCount: models.length,
    models,
    error: null,
  };
}

async function getLocalProviderHealth(options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const [ollama, lmstudio] = await Promise.all([
    checkOllamaHealth({ timeoutMs, baseUrl: options.ollamaBaseUrl }),
    checkLMStudioHealth({ timeoutMs, baseUrl: options.lmstudioBaseUrl }),
  ]);

  return [ollama, lmstudio];
}

module.exports = {
  OLLAMA_DEFAULT_BASE_URL,
  LMSTUDIO_DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  normalizeBaseUrl,
  buildOfflineStatus,
  checkOllamaHealth,
  checkLMStudioHealth,
  getLocalProviderHealth,
};
