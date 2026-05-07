/**
 * system_audit.cjs
 * Comprehensive system audit script for OpenClaw.
 * Performs checks from the perspective of various expert roles.
 */
'use strict';

require('dotenv').config({ path: './telegram.env' });
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function checkDashboardAPI(endpoint) {
    try {
        const res = await fetch(`http://localhost:3737${endpoint}`);
        const text = await res.text();
        const isJson = text.startsWith('{') || text.startsWith('[');
        if (res.ok && isJson) {
            return { ok: true, status: res.status, preview: text.substring(0, 100) };
        } else {
            return { ok: false, status: res.status, error: 'Not JSON or Not OK' };
        }
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function runAudit() {
    console.log('==================================================');
    console.log('  OPENCLAW COMPREHENSIVE SYSTEM AUDIT');
    console.log('==================================================\n');

    // --- 1. DevOps Engineer Audit ---
    console.log('👷 [DEVOPS ENGINEER] Auditing Infrastructure & Environment...');
    const envVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOT_TOKEN', 'AI_BASE_URL'];
    envVars.forEach(v => {
        const status = process.env[v] ? '✅ Set' : '❌ MISSING';
        console.log(`  - Env: ${v} -> ${status}`);
    });

    try {
        const { getRecentSnapshots } = require('./lib/storage/signal-store.cjs');
        const snaps = await getRecentSnapshots('', 1);
        console.log(`  - Supabase Read Test: ✅ Success (${snaps.length} rows)`);
    } catch (e) {
        console.log(`  - Supabase Read Test: ❌ Failed (${e.message})`);
    }
    console.log('');

    // --- 2. Backend Developer Audit ---
    console.log('🧑‍💻 [BACKEND DEVELOPER] Auditing Core Modules...');
    const coreModules = [
        './trading_engine.cjs',
        './lib/orchestration/orchestrator.cjs',
        './lib/storage/signal-store.cjs',
        './lib/learning/weekly-review.cjs'
    ];
    coreModules.forEach(mod => {
        try {
            require(mod);
            console.log(`  - Module load: ${mod} -> ✅ OK`);
        } catch (e) {
            console.log(`  - Module load: ${mod} -> ❌ FAILED (${e.message.substring(0, 50)})`);
        }
    });
    console.log('');

    // --- 3. Frontend/API Lead Audit ---
    console.log('🌐 [FRONTEND/API LEAD] Auditing Dashboard & API Endpoints...');
    const apiEndpoints = [
        '/api/health',
        '/api/session',
        '/api/signals',
        '/api/stats',
        '/api/signals/history',
        '/api/performance'
    ];

    for (const ep of apiEndpoints) {
        const result = await checkDashboardAPI(ep);
        if (result.ok) {
            console.log(`  - API ${ep} -> ✅ [${result.status}] OK`);
            console.log(`      Preview: ${result.preview}...`);
        } else {
            console.log(`  - API ${ep} -> ❌ FAILED (${result.error || result.status})`);
        }
    }
    console.log('');

    // --- 4. AI/Quant Engineer Audit ---
    console.log('🧠 [AI/QUANT ENGINEER] Auditing Models & Strategy Engine...');
    try {
        const aiUrl = process.env.AI_BASE_URL || 'http://localhost:1234';
        const modelRes = await fetch(`${aiUrl}/v1/models`);
        const models = await modelRes.json();
        const count = models?.data?.length || 0;
        console.log(`  - LM Studio Connectivity: ${count > 0 ? '✅' : '❌'} (${count} models found)`);
    } catch (e) {
        console.log(`  - LM Studio Connectivity: ❌ FAILED (${e.message})`);
    }

    try {
        const { detectSession } = require('./strategy_engine.cjs');
        const session = detectSession();
        console.log(`  - Session Detection: ✅ Active (${session.session}, Quality: ${session.quality})`);
    } catch (e) {
        console.log(`  - Session Detection: ❌ FAILED (${e.message})`);
    }
    console.log('');

    console.log('==================================================');
    console.log('  AUDIT COMPLETE');
    console.log('==================================================');
}

runAudit().catch(e => console.error('Audit crashed:', e));
