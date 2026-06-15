# OpenClaw Sprint 001L-R3C5 Policy Contract Runtime Report

Generated:
2026-06-16T00:08:00.5492628+03:00

## Purpose

R3C4 runtime passed operationally, but the validation expected inferenceEnabledByDefault while the policy contract may expose allowInferenceByDefault.

## Results

Nothing staged before:
True

Static routes and bootstrap present:
True

Inherited NODE_PATH available:
True

Server ready:
True

Policy keys:
activeProvider
allowInferenceByDefault
approvedModel
cloudProvidersEnabledByDefault
lmStudioEnabled
maxContext
maxPredict

Canonical inference field:
allowInferenceByDefault

Canonical inference value:
False

Policy contract ok:
True

Smoke blocks without explicit allow:
True

Smoke allows with explicit allow:
True

Nothing staged after:
True

Forbidden changed paths:
0

Patch check:
True

## Verdict

SPRINT_001L_R3C5_POLICY_CONTRACT_RUNTIME_PASS