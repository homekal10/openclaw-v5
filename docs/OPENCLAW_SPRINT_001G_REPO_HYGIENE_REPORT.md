# OpenClaw Sprint 001G Repo Hygiene Report

## Commands Run

- `git status --short`
- `git diff --name-only`
- `git ls-files --others --exclude-standard`
- `Get-Content .gitignore`
- acceptance-doc inspection for Sprint 001A through 001F
- provider/router/policy/adapter source inspections
- dashboard and provider UI route inspections
- redacted env-like file inspection
- `npx tsc --noEmit -p .\tsconfig.openclaw.json`
- `node .\scripts\validate_audnzd_csv_contract.cjs`
- `node .\scripts\validate_database_schema.cjs`
- `node .\scripts\check_local_llm_health.cjs`
- `node .\scripts\check_local_llm_router.cjs`
- `node .\scripts\check_local_llm_policy.cjs`
- `node .\scripts\smoke_ollama_inference_adapter.cjs`
- `node .\scripts\test_ollama_inference_safety_harness.cjs`

## Findings

- Sprint 001A through 001F acceptance documents exist and report accepted verdicts.
- Local provider health, router, policy, adapter, golden prompts, and safety harness files are present.
- Ollama-only policy remains active.
- Approved model remains `openclaw-phi3-mini:latest`.
- LM Studio remains disabled by policy and is not selected by router fallback.
- The adapter remains one-shot and requires explicit allow.
- `ai_core.cjs` and `model_router.cjs` remain unwired from the Ollama adapter.
- Dashboard exposes only fixed local AI platform endpoints already accepted by prior sprints.
- No UI inference run button was observed for the Ollama smoke endpoint.
- `telegram.env` and `env_vars_export.txt` are present and credential-shaped; values were not printed.
- Runtime logs and data snapshots are heavily modified and should not be staged.
- MT5/live execution path files are modified and are outside the accepted local AI sprint lane.
- `lib/strategies/Candidate001_AUDNZD.ts` is untracked and must not be staged under current safety rules.
- Multiple SQL schema files are untracked and must not be staged under current safety rules.
- `git diff --stat` is extremely large because of tracked log/data churn and deleted log files.

## Risks

- Running `git add .` would stage secret-risk files, logs, data snapshots, blocked strategy work, MT5/live execution changes, and schema files.
- `telegram.env` and `env_vars_export.txt` may contain real credentials and must not be committed.
- Tracked log deletions are visible; do not stage deletions without a separate cleanup decision.
- Dashboard and UI files contain accepted local AI changes mixed with potentially unrelated additions, requiring manual review before staging.
- MT5/live execution files are modified but Sprint 001G explicitly forbids editing or committing MT5 execution path changes.
- SQL files imply database schema work, which is blocked in this lane.

## Next Recommended Action

1. Do not stage or commit yet.
2. Review `docs/OPENCLAW_SAFE_COMMIT_PLAN.md`.
3. Stage accepted local AI files only with explicit file paths after manual review.
4. Keep secret-risk, logs, runtime data, MT5/live execution, SQL schema, and blocked strategy files out of the local AI commit set.
5. Perform a separate cleanup/hardening sprint for tracked logs and secret-risk file handling if needed.

## Validation Summary

- TypeScript check passed with an npm config warning.
- AUDNZD CSV preflight passed.
- Database validator returned `DB_NOT_CONNECTED`, acceptable for safe handoff.
- Local provider health passed with Ollama online and LM Studio offline.
- Local router selected Ollama with `ollama_online_policy_primary`.
- Local policy confirmed inference disabled by default.
- Default Ollama smoke refused safely.
- Sprint 001F safety harness passed.

## Final Verdict

`SPRINT_001G_REPO_HYGIENE_BLOCKED`

The local AI lane is accepted, but the full worktree is not safe to commit until must-not-commit and manual-review files are isolated.
