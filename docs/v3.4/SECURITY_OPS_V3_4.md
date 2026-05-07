# Security & Operations v3.4

## Telegram Rate Limiting
- Limit: 5 commands / 60 seconds per user
- Scope: per Telegram user ID
- Warning message on limit hit
- No bypass for any user

## Input Sanitization
- sanitizeTicker(sym) — strips non-alphanum except /, max 20 chars, uppercase
- Applied to all symbol arguments before any processing

## Dashboard Security Headers
`
Content-Security-Policy: default-src 'self' 'unsafe-inline' data:; ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), payment=()
`

## Structured Logging
- Format: JSON lines in logs/ directory
- Auto-update log: logs/auto_update_log.jsonl
- Pending approvals: logs/pending_approvals.json

## Commands
- /securitystatus — full security overview (admin only)
- /ratelimits — rate limit configuration (admin only)
- /schema — snapshot schema overview (admin only)
- /backupstatus — snapshot store state (admin only)

## Secret Rules
- No API keys in codebase
- All secrets in 	elegram.env (not committed)
- ADMIN_LEARNING_APPLY flag required for bounded auto-apply
