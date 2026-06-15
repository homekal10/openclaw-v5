#!/usr/bin/env node

const {
  runOllamaInferenceOnce,
} = require('../lib/providers/ollama_inference_adapter.cjs');

const ALLOW_FLAG = '--allow-local-inference-smoke';
const SMOKE_PROMPT = 'Reply with exactly this text and nothing else: OPENCLAW_OLLAMA_ADAPTER_PASS';

async function main() {
  const allowed = process.argv.includes(ALLOW_FLAG);

  if (!allowed) {
    const result = await runOllamaInferenceOnce({
      prompt: SMOKE_PROMPT,
      allowLocalInference: false,
    });
    console.log('OpenClaw Ollama Inference Adapter Smoke');
    console.log('Inference is blocked by default. Re-run with --allow-local-inference-smoke for one controlled smoke request.');
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
    return;
  }

  const result = await runOllamaInferenceOnce({
    prompt: SMOKE_PROMPT,
    allowLocalInference: true,
  });
  console.log('OpenClaw Ollama Inference Adapter Smoke');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 0;
}

main().catch((error) => {
  console.log('OpenClaw Ollama Inference Adapter Smoke');
  console.log(JSON.stringify({
    ok: false,
    model: 'openclaw-phi3-mini:latest',
    promptPreview: '',
    responseText: null,
    latencyMs: null,
    generatedAt: new Date().toISOString(),
    error: String(error.message || error).slice(0, 120),
  }, null, 2));
  process.exitCode = 0;
});
