#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  runOllamaInferenceOnce,
} = require('../lib/providers/ollama_inference_adapter.cjs');
const {
  getLocalLLMPolicy,
} = require('../lib/providers/local_llm_policy.cjs');
const {
  OLLAMA_GOLDEN_PROMPTS,
} = require('../lib/providers/ollama_golden_prompts.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(REPO_ROOT, 'docs', 'OPENCLAW_SPRINT_001F_INFERENCE_SAFETY_HARNESS_REPORT.md');
const DASHBOARD_PATH = path.join(REPO_ROOT, 'dashboard.cjs');
const ADAPTER_PATH = path.join(REPO_ROOT, 'lib', 'providers', 'ollama_inference_adapter.cjs');
const AI_CORE_PATH = path.join(REPO_ROOT, 'ai_core.cjs');
const MODEL_ROUTER_PATH = path.join(REPO_ROOT, 'model_router.cjs');

const SMOKE_PROMPT = OLLAMA_GOLDEN_PROMPTS.adapterExactPass;

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function safeError(error) {
  return String(error?.message || error || 'unknown_error').slice(0, 180);
}

function pass(name, detail = '') {
  return { name, pass: true, detail };
}

function fail(name, detail = '') {
  return { name, pass: false, detail };
}

function formatCheck(check) {
  const marker = check.pass ? 'PASS' : 'BLOCKED';
  return `- ${marker}: ${check.name}${check.detail ? ` - ${check.detail}` : ''}`;
}

async function withTemporaryFetch(mockFetch, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

async function checkAdapterPayload(policy) {
  const calls = [];
  const result = await withTemporaryFetch(async (url, request = {}) => {
    calls.push({
      url: String(url),
      body: request.body ? JSON.parse(request.body) : null,
    });
    return {
      ok: true,
      json: async () => ({ response: 'OPENCLAW_OLLAMA_ADAPTER_PASS' }),
    };
  }, () => runOllamaInferenceOnce({
    prompt: SMOKE_PROMPT,
    allowLocalInference: true,
    timeoutMs: 250,
  }));

  const call = calls[0] || {};
  const body = call.body || {};
  const checks = [];

  checks.push(calls.length === 1
    ? pass('Adapter performs exactly one request per allowed call', `calls=${calls.length}`)
    : fail('Adapter performs exactly one request per allowed call', `calls=${calls.length}`));
  checks.push(String(call.url || '').includes('/api/generate')
    ? pass('Adapter uses Ollama /api/generate only', call.url)
    : fail('Adapter uses Ollama /api/generate only', call.url || 'missing url'));
  checks.push(body.model === policy.approvedModel
    ? pass('Adapter uses only policy.approvedModel', body.model)
    : fail('Adapter uses only policy.approvedModel', `actual=${body.model || 'missing'} expected=${policy.approvedModel}`));
  checks.push(body.options?.num_ctx === policy.maxContext
    ? pass('Adapter uses policy.maxContext', `num_ctx=${body.options?.num_ctx}`)
    : fail('Adapter uses policy.maxContext', `actual=${body.options?.num_ctx} expected=${policy.maxContext}`));
  checks.push(body.options?.num_predict === policy.maxPredict
    ? pass('Adapter uses policy.maxPredict', `num_predict=${body.options?.num_predict}`)
    : fail('Adapter uses policy.maxPredict', `actual=${body.options?.num_predict} expected=${policy.maxPredict}`));
  checks.push(result.ok && result.responseText.includes('OPENCLAW_OLLAMA_ADAPTER_PASS')
    ? pass('Adapter allowed smoke response contains sentinel', result.responseText)
    : fail('Adapter allowed smoke response contains sentinel', JSON.stringify(result)));

  return checks;
}

async function checkDefaultRefusal(policy) {
  const result = await runOllamaInferenceOnce({
    prompt: SMOKE_PROMPT,
    allowLocalInference: false,
    timeoutMs: 250,
  });

  if (!result.ok && result.error === 'local_inference_requires_explicit_allow' && result.model === policy.approvedModel) {
    return pass('Adapter refuses without explicit allow flag', result.error);
  }
  return fail('Adapter refuses without explicit allow flag', JSON.stringify(result));
}

async function checkActualAllowedSmoke(policy) {
  const result = await runOllamaInferenceOnce({
    prompt: SMOKE_PROMPT,
    allowLocalInference: true,
  });

  if (result.ok && result.model === policy.approvedModel && String(result.responseText || '').includes('OPENCLAW_OLLAMA_ADAPTER_PASS')) {
    return pass('Adapter accepts exactly one allowed smoke request', `latencyMs=${result.latencyMs}`);
  }
  return fail('Adapter accepts exactly one allowed smoke request', JSON.stringify(result));
}

function inspectSourceFiles() {
  const dashboard = readText(DASHBOARD_PATH);
  const adapter = readText(ADAPTER_PATH);
  const aiCore = readText(AI_CORE_PATH);
  const modelRouter = readText(MODEL_ROUTER_PATH);
  const checks = [];

  checks.push(dashboard.includes("app.post('/api/platform/ollama-inference-smoke'")
    ? pass('Dashboard smoke endpoint exists only as dedicated smoke route')
    : fail('Dashboard smoke endpoint exists only as dedicated smoke route'));
  checks.push(dashboard.includes('allowLocalInferenceSmoke === true')
    ? pass('Dashboard smoke endpoint refuses without allowLocalInferenceSmoke')
    : fail('Dashboard smoke endpoint refuses without allowLocalInferenceSmoke'));
  checks.push(dashboard.includes(SMOKE_PROMPT) && !/req\.body\?\.(prompt|message|input)|req\.body\.(prompt|message|input)/.test(dashboard)
    ? pass('Dashboard smoke endpoint uses fixed internal prompt only')
    : fail('Dashboard smoke endpoint uses fixed internal prompt only'));
  checks.push(!/app\.(post|put|patch)\([^)]*(prompt|inference|generate)/i.test(dashboard.replace("app.post('/api/platform/ollama-inference-smoke'", ''))
    ? pass('No arbitrary prompt API endpoint was added')
    : fail('No arbitrary prompt API endpoint was added'));
  checks.push(!adapter.includes('mt5.order_send')
    ? pass('No mt5.order_send reference in adapter')
    : fail('No mt5.order_send reference in adapter'));
  checks.push(!/require\([^)]*strategies|from ['"][^'"]*strategies/.test(adapter)
    ? pass('No strategy files are imported by the adapter')
    : fail('No strategy files are imported by the adapter'));
  checks.push(!/require\([^)]*(database|supabase|pg|postgres|prisma|knex)|from ['"][^'"]*(database|supabase|pg|postgres|prisma|knex)/i.test(adapter)
    ? pass('No DB write modules are imported by the adapter')
    : fail('No DB write modules are imported by the adapter'));
  checks.push(!/lmstudio|LMSTUDIO|\/v1\/models/i.test(adapter)
    ? pass('LM Studio is not called by the adapter')
    : fail('LM Studio is not called by the adapter'));
  checks.push(!/ollama_inference_adapter|runOllamaInferenceOnce|OPENCLAW_OLLAMA_ADAPTER_PASS/.test(aiCore)
    ? pass('ai_core.cjs remains unwired from Ollama inference adapter')
    : fail('ai_core.cjs remains unwired from Ollama inference adapter'));
  checks.push(!/ollama_inference_adapter|runOllamaInferenceOnce|OPENCLAW_OLLAMA_ADAPTER_PASS/.test(modelRouter)
    ? pass('model_router.cjs remains unwired from Ollama inference adapter')
    : fail('model_router.cjs remains unwired from Ollama inference adapter'));

  return checks;
}

function writeReport(checks, startedAt) {
  const verdict = checks.every((check) => check.pass)
    ? 'SPRINT_001F_SAFETY_HARNESS_PASS'
    : 'SPRINT_001F_SAFETY_HARNESS_BLOCKED';
  const generatedAt = new Date().toISOString();
  const body = [
    '# OpenClaw Sprint 001F Inference Safety Harness Report',
    '',
    `Generated At: ${generatedAt}`,
    `Started At: ${startedAt}`,
    '',
    `Verdict: ${verdict}`,
    '',
    '## Checks',
    '',
    ...checks.map(formatCheck),
    '',
    '## Safety Boundary',
    '',
    '- The harness does not add runtime trading wiring.',
    '- The harness does not write inference output to the database.',
    '- The harness does not call LM Studio.',
    '- The harness does not expose arbitrary prompt endpoints or UI run controls.',
    '- The harness allows only a fixed one-shot Ollama smoke prompt.',
    '',
  ].join('\n');

  fs.writeFileSync(REPORT_PATH, body, 'utf8');
  return { verdict, generatedAt, reportPath: REPORT_PATH };
}

async function main() {
  const startedAt = new Date().toISOString();
  const checks = [];

  try {
    const policy = getLocalLLMPolicy();
    checks.push(SMOKE_PROMPT
      ? pass('Golden prompt adapterExactPass is defined')
      : fail('Golden prompt adapterExactPass is defined'));
    checks.push(policy.activeProvider === 'ollama'
      ? pass('Policy active provider remains Ollama', policy.activeProvider)
      : fail('Policy active provider remains Ollama', policy.activeProvider));
    checks.push(policy.allowInferenceByDefault === false
      ? pass('Policy inference remains disabled by default', String(policy.allowInferenceByDefault))
      : fail('Policy inference remains disabled by default', String(policy.allowInferenceByDefault)));

    checks.push(await checkDefaultRefusal(policy));
    checks.push(...await checkAdapterPayload(policy));
    checks.push(await checkActualAllowedSmoke(policy));
    checks.push(...inspectSourceFiles());
  } catch (error) {
    checks.push(fail('Safety harness unexpected error', safeError(error)));
  }

  const report = writeReport(checks, startedAt);

  console.log('OpenClaw Sprint 001F Local Inference Safety Harness');
  console.log(`Generated At: ${report.generatedAt}`);
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Report: ${report.reportPath}`);
  console.log('');
  checks.forEach((check) => console.log(formatCheck(check)));

  process.exitCode = report.verdict === 'SPRINT_001F_SAFETY_HARNESS_PASS' ? 0 : 1;
}

main();
