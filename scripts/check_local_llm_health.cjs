#!/usr/bin/env node

const {
  getLocalProviderHealth,
} = require('../lib/providers/local_llm_health.cjs');

function formatLatency(latencyMs) {
  return latencyMs == null ? 'n/a' : `${latencyMs} ms`;
}

function printProvider(provider) {
  const label = provider.provider === 'lmstudio' ? 'LM Studio' : 'Ollama';
  const status = provider.online ? 'ONLINE' : 'OFFLINE';

  console.log(`${label}: ${status}`);
  console.log(`  Base URL: ${provider.baseUrl}`);
  console.log(`  Latency: ${formatLatency(provider.latencyMs)}`);
  console.log(`  Models: ${provider.modelCount}`);

  if (provider.models.length > 0) {
    console.log(`  Names: ${provider.models.join(', ')}`);
  } else {
    console.log('  Names: none detected');
  }

  if (provider.error) {
    console.log(`  Error: ${provider.error}`);
  }

  console.log('');
}

async function main() {
  const generatedAt = new Date().toISOString();
  const providers = await getLocalProviderHealth();

  console.log('OpenClaw Local LLM Provider Health');
  console.log(`Generated At: ${generatedAt}`);
  console.log('');

  providers.forEach(printProvider);

  const onlineCount = providers.filter((provider) => provider.online).length;
  console.log(`Summary: ${onlineCount}/${providers.length} providers online`);
  process.exitCode = 0;
}

main().catch((error) => {
  console.log('OpenClaw Local LLM Provider Health');
  console.log(`Generated At: ${new Date().toISOString()}`);
  console.log('');
  console.log(`Unexpected checker error: ${String(error.message || error).slice(0, 120)}`);
  process.exitCode = 0;
});
