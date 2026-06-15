const OLLAMA_GOLDEN_PROMPTS = Object.freeze({
  adapterExactPass: 'Reply with exactly this text and nothing else: OPENCLAW_OLLAMA_ADAPTER_PASS',
});

function getOllamaGoldenPrompt(name) {
  return OLLAMA_GOLDEN_PROMPTS[name] || null;
}

module.exports = {
  OLLAMA_GOLDEN_PROMPTS,
  getOllamaGoldenPrompt,
};
