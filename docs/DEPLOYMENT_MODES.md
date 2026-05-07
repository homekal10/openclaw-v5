# Deployment Modes

## Mode 1: Local-Only (Current)
```
[LM Studio] ←→ [Node.js Bot + Dashboard] ←→ [Telegram API]
                      ↕                          
              [Supabase Cloud]
              [SQLite Local]
```
- PM2 manages `openclaw` process
- Dashboard at localhost:3737
- All providers run locally
- Best for: development, personal use

## Mode 2: Local + Netlify (Current Production)
```
[Netlify Static Site] ←→ [CoinGecko/Alt.me APIs]
[LM Studio] ←→ [Node.js Bot + Dashboard] ←→ [Telegram API]
                      ↕
              [Supabase Cloud]
```
- Static dashboard at openclaw-terminal.netlify.app
- Local bot connects to Telegram via polling
- Best for: current setup

## Mode 3: Cloud Bot + Supabase
```
[Render/Fly.io Worker] ←→ [Telegram Webhook]
         ↕
   [Supabase Cloud]
   [Cloud LLM (Grok)]
```
- Telegram webhook mode (requires HTTPS)
- No local machine dependency
- Set: `ENABLE_WEBHOOK_MODE=true`, `WEBHOOK_URL=https://...`
- Best for: always-on production

## Mode 4: Hybrid (Future)
```
[Cloud Worker] ←→ [Telegram Webhook]
      ↕
[Supabase] + [Private LLM Fallback]
[Paid Providers] ←→ [Free Fallbacks]
```
- Paid providers for primary data
- Free providers as fallbacks
- Best for: institutional-grade deployment

## Telegram Webhook Setup
1. Set `ENABLE_WEBHOOK_MODE=true`
2. Set `WEBHOOK_URL=https://your-domain.com/webhook`
3. Set `WEBHOOK_SECRET=random_secret`
4. Deploy to HTTPS-capable host
5. Bot auto-registers webhook on startup

## Docker (Prepared)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "telegram_bot.cjs"]
```

## PM2 Production
```bash
npx pm2 start ecosystem.config.cjs
npx pm2 save
npx pm2 startup
```
