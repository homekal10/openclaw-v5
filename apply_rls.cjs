/**
 * apply_rls.cjs — Applies bot ingest RLS policies to Supabase
 * using the Supabase Management API (requires access token).
 * 
 * Get your access token from: https://supabase.com/dashboard/account/tokens
 * Then: node apply_rls.cjs <your_access_token>
 * 
 * OR: Just log in to Supabase and run the SQL from rls_fix.sql manually:
 * https://supabase.com/dashboard/project/capjzizeouhqyrtxusuf/sql/new
 */

'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PROJECT_REF   = 'capjzizeouhqyrtxusuf';
const ACCESS_TOKEN  = process.argv[2] || process.env.SUPABASE_ACCESS_TOKEN;

const SQL = fs.readFileSync(
    path.join(__dirname, 'supabase', 'migrations', '20260418000000_bot_ingest_rls.sql'),
    'utf8'
);

if (!ACCESS_TOKEN || ACCESS_TOKEN.trim() === '') {
    console.error('\n❌ No access token provided.\n');
    console.log('Steps to fix RLS:');
    console.log('1. Open: https://supabase.com/dashboard/project/capjzizeouhqyrtxusuf/sql/new');
    console.log('2. Paste + run: hktradingbot/supabase/migrations/20260418000000_bot_ingest_rls.sql');
    console.log('\nOR get your personal access token from:');
    console.log('   https://supabase.com/dashboard/account/tokens');
    console.log('Then run: node apply_rls.cjs <your_token>');
    process.exit(1);
}

function post(path, body) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const req = https.request({
            hostname: 'api.supabase.com',
            path,
            method: 'POST',
            headers: {
                'Authorization':  `Bearer ${ACCESS_TOKEN}`,
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 20000,
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', e  => resolve({ status: 0, body: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
        req.write(payload);
        req.end();
    });
}

async function main() {
    console.log('[apply_rls] Applying RLS policies via Supabase Management API...');

    const r = await post(`/v1/projects/${PROJECT_REF}/database/query`, { query: SQL });

    if (r.status >= 200 && r.status < 300) {
        console.log('\n✅ RLS policies applied successfully!');
        console.log('   The bot can now write to Supabase with the anon key.');
        
        // Now immediately run the seeder
        console.log('\n[apply_rls] Running live seeder...');
        try { require('./direct_seeder.cjs'); }
        catch(e) { console.error('Seeder error:', e.message); }
    } else {
        console.error(`\n❌ Failed (${r.status}): ${r.body}`);
        console.log('\nManual fix — run this SQL in Supabase dashboard:');
        console.log('https://supabase.com/dashboard/project/capjzizeouhqyrtxusuf/sql/new');
    }
}

main();
