#!/usr/bin/env node

const {
  getLocalLLMPolicy,
} = require('../lib/providers/local_llm_policy.cjs');

function formatBool(value) {
  return value ? 'true' : 'false';
}

function main() {
  const policy = getLocalLLMPolicy();

  console.log('OpenClaw Local LLM Policy');
  console.log(`Generated At: ${new Date().toISOString()}`);
  console.log('');
  console.log(`Active Provider: ${policy.activeProvider}`);
  console.log(`Approved Model: ${policy.approvedModel}`);
  console.log(`LM Studio Enabled: ${formatBool(policy.lmStudioEnabled)}`);
  console.log(`Cloud Providers Enabled By Default: ${formatBool(policy.cloudProvidersEnabledByDefault)}`);
  console.log(`Inference Enabled By Default: ${formatBool(policy.allowInferenceByDefault)}`);
  console.log(`Max Context: ${policy.maxContext}`);
  console.log(`Max Predict: ${policy.maxPredict}`);
  process.exitCode = 0;
}

try {
  main();
} catch (error) {
  console.log('OpenClaw Local LLM Policy');
  console.log(`Generated At: ${new Date().toISOString()}`);
  console.log('');
  console.log(`Policy check failed: ${String(error.message || error).slice(0, 120)}`);
  process.exitCode = 0;
}
