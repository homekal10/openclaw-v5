/**
 * OpenClaw Deploy Builder v4.1
 * Extracts dashboard HTML by rendering the Express route directly.
 * Usage: node deploy.cjs [API_BASE_URL]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const DEPLOY_DIR = path.join(__dirname, 'deploy');
const API_BASE = process.argv[2] || '';

console.log('🚀 OpenClaw Deploy Builder v5.0');
console.log(`   API Base: ${API_BASE || '(relative — same origin)'}`);

// Fetch the full rendered HTML from the running dashboard
function fetchDashboardHTML() {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:3737/', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function build() {
    let html;
    try {
        html = await fetchDashboardHTML();
        console.log(`   ✅ Fetched live HTML (${html.length} chars)`);
    } catch(e) {
        console.error('❌ Dashboard not running on localhost:3737');
        console.error('   Start with: npx pm2 start telegram_bot.cjs --name openclaw');
        process.exit(1);
    }

    // Rewrite API calls if base URL provided
    if (API_BASE) {
        html = html.replace(/fetch\(['"]\/api\//g, `fetch('${API_BASE}/api/`);
        html = html.replace(/fetch\('\/api/g, `fetch('${API_BASE}/api`);
        console.log(`   ✅ Rewrote API calls → ${API_BASE}`);
    }

    // Add deploy metadata
    const meta = `<meta name="deploy-version" content="v4.1-${new Date().toISOString().slice(0,10)}">`;
    html = html.replace('</head>', `${meta}\n</head>`);

    // Create deploy directory
    if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });

    // Write files
    fs.writeFileSync(path.join(DEPLOY_DIR, 'index.html'), html);
    console.log(`   ✅ index.html (${html.length} chars)`);

    fs.writeFileSync(path.join(DEPLOY_DIR, '_redirects'), '/* /index.html 200\n');
    console.log('   ✅ _redirects');

    fs.writeFileSync(path.join(DEPLOY_DIR, '_headers'), 
        `/*\n  Access-Control-Allow-Origin: *\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Cache-Control: public, max-age=60\n`);
    console.log('   ✅ _headers');

    fs.writeFileSync(path.join(DEPLOY_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /api/\n');
    console.log('   ✅ robots.txt');

    console.log(`\n🎯 Deploy ready: ${DEPLOY_DIR}`);
    console.log('   Next: npx netlify-cli deploy --prod --dir=deploy');
}

build().catch(e => { console.error(e); process.exit(1); });
