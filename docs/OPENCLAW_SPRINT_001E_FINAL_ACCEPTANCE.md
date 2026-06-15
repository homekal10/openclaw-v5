# OpenClaw Sprint 001E Final Acceptance

Generated:
2026-06-15T15:22:42.3775561+03:00

## Sprint

Sprint 001E — Controlled Ollama Inference Adapter

## Provider Endpoint

Pass:
True

Response:
{
    "ok":  true,
    "generatedAt":  "2026-06-15T12:22:39.449Z",
    "providers":  [
                      {
                          "provider":  "ollama",
                          "baseUrl":  "http://localhost:11434",
                          "online":  true,
                          "latencyMs":  42,
                          "modelCount":  1,
                          "models":  [
                                         "openclaw-phi3-mini:latest"
                                     ],
                          "error":  null
                      },
                      {
                          "provider":  "lmstudio",
                          "baseUrl":  "http://localhost:1234",
                          "online":  false,
                          "latencyMs":  null,
                          "modelCount":  0,
                          "models":  [

                                     ],
                          "error":  "fetch_failed"
                      }
                  ]
}

## Router Endpoint

Pass:
True

Response:
{
    "ok":  true,
    "generatedAt":  "2026-06-15T12:22:39.537Z",
    "router":  {
                   "ok":  true,
                   "selectedProvider":  "ollama",
                   "reason":  "ollama_online_policy_primary",
                   "generatedAt":  "2026-06-15T12:22:39.537Z",
                   "policy":  {
                                  "activeProvider":  "ollama",
                                  "lmStudioEnabled":  false,
                                  "cloudProvidersEnabledByDefault":  false,
                                  "approvedModel":  "openclaw-phi3-mini:latest",
                                  "maxContext":  2048,
                                  "maxPredict":  64,
                                  "allowInferenceByDefault":  false
                              },
                   "providers":  [
                                     {
                                         "provider":  "ollama",
                                         "baseUrl":  "http://localhost:11434",
                                         "online":  true,
                                         "latencyMs":  3,
                                         "modelCount":  1,
                                         "models":  [
                                                        "openclaw-phi3-mini:latest"
                                                    ],
                                         "error":  null
                                     },
                                     {
                                         "provider":  "lmstudio",
                                         "baseUrl":  "http://localhost:1234",
                                         "online":  false,
                                         "latencyMs":  null,
                                         "modelCount":  0,
                                         "models":  [

                                                    ],
                                         "error":  "fetch_failed"
                                     }
                                 ]
               }
}

## Policy Endpoint

Pass:
True

Response:
{
    "ok":  true,
    "generatedAt":  "2026-06-15T12:22:39.608Z",
    "policy":  {
                   "activeProvider":  "ollama",
                   "lmStudioEnabled":  false,
                   "cloudProvidersEnabledByDefault":  false,
                   "approvedModel":  "openclaw-phi3-mini:latest",
                   "maxContext":  2048,
                   "maxPredict":  64,
                   "allowInferenceByDefault":  false
               }
}

## Inference Smoke Endpoint — Blocked Without Allow Flag

Pass:
True

Response:
{
    "ok":  true,
    "generatedAt":  "2026-06-15T12:22:39.742Z",
    "result":  {
                   "ok":  false,
                   "model":  "openclaw-phi3-mini:latest",
                   "promptPreview":  "Reply with exactly this text and nothing else: OPENCLAW_OLLAMA_ADAPTER_PASS",
                   "responseText":  null,
                   "latencyMs":  null,
                   "generatedAt":  "2026-06-15T12:22:39.742Z",
                   "error":  "local_inference_requires_explicit_allow"
               }
}

## Inference Smoke Endpoint — Explicitly Allowed

Pass:
True

Response:
{
    "ok":  true,
    "generatedAt":  "2026-06-15T12:22:41.965Z",
    "result":  {
                   "ok":  true,
                   "model":  "openclaw-phi3-mini:latest",
                   "promptPreview":  "Reply with exactly this text and nothing else: OPENCLAW_OLLAMA_ADAPTER_PASS",
                   "responseText":  "OPENCLAW_OLLAMA_ADAPTER_PASS",
                   "latencyMs":  2103,
                   "generatedAt":  "2026-06-15T12:22:41.965Z",
                   "error":  null
               }
}

## RAM

Before smoke:
10.04

After CLI smoke:
7.2

After endpoint smoke:
7.09

## Expected Safety Properties

- Uses only Ollama
- Uses only openclaw-phi3-mini:latest
- Requires explicit allow flag
- No arbitrary prompts accepted by API endpoint
- No UI run button
- No trading wiring
- No MT5 execution
- No DB writes
- No cloud fallback

## Verdict

SPRINT_001E_ACCEPTED
