# OpenClaw Sprint 001L-R3A Manual Merge Discovery Report

Generated:
2026-06-15T23:04:56.1101664+03:00

## Clean Worktree

Path:
C:\Users\Homekal\OpenClaw_push_clean_20260615_204330

Base:
2b3dda800b

Safe source commit:
ff29b3379c

## Preconditions

Nothing staged:
True

R2B report pass:
True

Manual merge files untouched:
True

## Manual Merge Files

.env.example
.gitignore
dashboard.cjs

## Missing Env Template Keys To Consider

DATABASE_URL
SUPABASE_ANON_KEY
SUPABASE_DB_URL
TELEGRAM_CHAT_ID

## Missing .gitignore Non-Comment Lines To Consider

!.env.example
!lib/research/data/csv/.gitkeep
.env.*
archived_old_logs_*/
backups/
C:/Users/Homekal/OpenClaw_market_data_archive/
C:/Users/Homekal/OpenClaw_market_data_inbox/
env_vars_export.txt
forensic_log_tails/
lib/research/data/csv/*.csv
logs/
OPENCLAW_CHATGPT_HANDOFF_CURRENT.zip
OPENCLAW_CHATGPT_HANDOFF_CURRENT/
telegram.env

## Dashboard Manual Merge Requirement

dashboard.cjs must be patched surgically.
Do not restore dashboard.cjs wholesale from the safe commit.

Required endpoint families to evaluate:
- GET /api/platform/provider-health
- GET /api/platform/local-llm-router
- GET /api/platform/local-llm-policy
- POST /api/platform/ollama-inference-smoke

Do not add arbitrary prompt endpoints.
Do not wire inference into strategy, DB, ai_core.cjs, or model_router.cjs.
Do not add dashboard-ui files.

## Verdict

SPRINT_001L_R3A_MANUAL_MERGE_DISCOVERY_READY