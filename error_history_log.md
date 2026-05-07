# OpenClaw Error History & Resolution Log

This document records significant errors encountered during the development and deployment of the OpenClaw trading system, detailing their root causes and the specific fixes applied. This serves as a knowledge base for future debugging efforts.

## 1. SyntaxError: `await` is only valid in async functions
*   **Location:** `telegram_bot.cjs`, line 320 (inside `handleCommand`)
*   **Symptom:** Bot failed to start, throwing a SyntaxError when trying to `await runOrchestrator(sym, ...)`.
*   **Root Cause:** The `handleCommand` function was declared as a synchronous function (`function handleCommand(...)`), but async operations were added inside it for the new institutional pipeline.
*   **Resolution:** Changed the function signature to `async function handleCommand(chatId, cmdText, callerUsername = '')`.

## 2. SyntaxError: Unexpected token 'class'
*   **Location:** `dashboard.cjs`, line 231
*   **Symptom:** Dashboard server crashed on startup (`node telegram_bot.cjs` failed).
*   **Root Cause:** Nested template literals were improperly escaped. The code attempted to map an array into an HTML string using backticks inside an already open backtick template literal without proper escaping.
*   **Resolution:** Replaced the inner template literals with standard string concatenation and `function()` syntax to avoid backtick collisions.
    *   *Fix:* `.map(function(v){return '<div class="veto-note">⛔ '+v+'</div>';}).join('');`

## 3. PostgREST Error: PGRST204 (Column not found)
*   **Location:** `lib/storage/signal-store.cjs` → Supabase insert
*   **Symptom:** System logged `[SignalStore] Save failed, queuing: Supabase signal_snapshots insert failed: {"code":"PGRST204", ... "message":"Could not find the 'agreement_summary' column...}`.
*   **Root Cause:** The initial Supabase migration ran a simplified schema. The `signal-store.cjs` module was attempting to insert fields (e.g., `agreement_summary`, `needed_confirmation`, `provider_meta`, `account_size`, `trend_1h`) that did not exist in the live database schema.
*   **Resolution:** Applied a two-part fix:
    1.  **Defensive Coding:** Updated `signal-store.cjs` to dynamically strip `null` and `undefined` values before inserting.
    2.  **Column Whitelist:** Updated `signal-store.cjs` to only include columns explicitly known to exist in the simplified schema, preventing the error even if the DB hasn't been patched.
    3.  *(Optional)* Created `002_patch_columns.sql` to add the missing columns to Supabase for future use.

## 4. API Endpoint Missing: `/api/stats` and `/api/signals/history`
*   **Location:** `dashboard.cjs` routes
*   **Symptom:** Fetching `/api/stats` returned HTML (a 404/Error page) instead of JSON data.
*   **Root Cause:** The dashboard code had UI elements expecting these endpoints, but the Express routes were never defined.
*   **Resolution:** Added explicit `app.get('/api/stats', ...)` and `app.get('/api/signals/history', ...)` handlers. Upgraded the `/api/signals` handler to merge legacy signals with new Supabase `signal_snapshots`.

## 5. LM Studio Inference Timeout / Hang
*   **Location:** `ai_core.cjs` → `fetchFromLMStudio`
*   **Symptom:** The orchestration pipeline hung for several minutes when attempting to use the `phi-3.1-mini-128k-instruct` model on CPU.
*   **Root Cause:** Local LLM inference was too slow for the default 180s timeout, causing the pipeline to block.
*   **Resolution:**
    1.  Reduced the LM Studio timeout to 25s (`timeoutMs = 25000`).
    2.  Implemented a model fallback chain (`LM_MODEL_CHAIN`) that prioritizes faster, smaller models (e.g., `google/gemma-3-4b`) before falling back to heavier models.
    3.  Added graceful error handling to log the timeout and proceed with rule-based scoring if AI fails.

## 6. Port Already in Use (EADDRINUSE)
*   **Location:** Dashboard Express server (Port 3737)
*   **Symptom:** `Error: listen EADDRINUSE: address already in use :::3737`
*   **Root Cause:** A previous instance of the Node process running the bot/dashboard was not terminated properly and was still holding the port.
*   **Resolution:** Found the PID using `netstat -ano | findstr ":3737"` (or `Get-Process node`) and killed the zombie process using `Stop-Process -Force`. Added clean shutdown hooks where applicable.

## 7. Supabase DDL Programmatic Access Denied
*   **Location:** `run_patch.cjs`
*   **Symptom:** Attempting to run `ALTER TABLE` via the Supabase Management API or PG REST endpoint failed with 401 or 404 errors when using the Service Role Key.
*   **Root Cause:** Supabase blocks Data Definition Language (DDL) queries via standard API endpoints for security. The Management API requires a Personal Access Token (PAT), not a Service Role Key.
*   **Resolution:** Updated `run_patch.cjs` to accept a `SUPABASE_PAT` environment variable. Provided explicit manual instructions for the user to run the SQL patch via the web dashboard as a foolproof alternative.
