#!/usr/bin/env node

const {
  getLocalLLMRouterDecision,
} = require('../lib/providers/local_llm_router.cjs');

function formatProvider(provider) {
  const label = provider.provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
  const status = provider.online ? 'ONLINE' : 'OFFLINE';
  const latency = provider.latencyMs == null ? 'n/a' : `${provider.latencyMs} ms`;
  return `${label}: ${status} | ${provider.baseUrl} | latency=${latency} | models=${provider.modelCount}`;
}

async function main() {
  const decision = await getLocalLLMRouterDecision();

  console.log('OpenClaw Local LLM Router');
  console.log(`Generated At: ${decision.generatedAt}`);
  console.log('');
  console.log('Provider Health Summary:');

  if (decision.providers.length === 0) {
    console.log('  No provider health data available.');
  } else {
    decision.providers.forEach((provider) => {
      console.log(`  ${formatProvider(provider)}`);
    });
  }

  console.log('');
  console.log(`Selected Provider: ${decision.selectedProvider || 'none'}`);
  console.log(`Reason: ${decision.reason}`);

  process.exitCode = 0;
}

main().catch((error) => {
  console.log('OpenClaw Local LLM Router');
  console.log(`Generated At: ${new Date().toISOString()}`);
  console.log('');
  console.log('Selected Provider: none');
  console.log('Reason: router_unexpected_error');
  console.log(`Detail: ${String(error.message || error).slice(0, 120)}`);
  process.exitCode = 0;
});
