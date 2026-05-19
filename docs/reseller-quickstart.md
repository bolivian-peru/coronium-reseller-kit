# Reseller quickstart

The shortest possible path from zero to a working reseller business.

## 1. Sign up at Coronium

<https://dashboard.coronium.io> — create an account, verify email, top up your balance via Stripe / Bitcoin / USDT. The balance is what you pay Coronium when you buy proxies on customers' behalf.

## 2. Get your API key

Dashboard → Settings → API. Copy the JWT. This is your reseller identity for every API call.

## 3. Pick a starter

Choose one:

### A) Hosted dashboard (recommended)

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/nextjs-dashboard
cp .env.example .env  # paste your CORONIUM_API_KEY
npm install && npm run dev
open http://localhost:3000
```

Deploy to Vercel when ready:

```bash
vercel deploy
```

Then register your webhook URL (see step 4).

### B) Just the webhook (you already have a backend / CRM)

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/webhook-receiver
npm install
CORONIUM_API_KEY=eyJ... node server.js
```

### C) AI-scaffolded custom dashboard

Paste `PROMPT.md` into Claude Code, Cursor, or Windsurf. The agent reads `AGENTS.md`, uses the Next.js example as foundation, builds your custom features.

## 4. Register your webhook URL

This is the most important step. Without it, you never get notified when a customer's modem dies.

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://your-host/api/coronium/webhook"}'
```

Coronium will POST `modem.replaced` events to that URL with the new credentials when auto-swap happens. Process the event, update your CRM, email your customer the new URL. Your customer never knows the modem died.

## 5. Buy your first proxy

Through the dashboard UI, or curl:

```bash
curl -X POST https://api.coronium.io/api/v3/payment/buy-modems-with-crypto-balance \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tariff_id": "61ef075c5a33f238ac15a8e7",
    "modemCount": 1,
    "metadata": { "customer_id": "first-customer" }
  }'
```

You get back `{_id, http_port, socks_port, proxy_login, proxy_password, ext_ip, …}`. That's your customer's proxy.

## 6. Set up the customer-facing side

Coronium gives you the wholesale price. Your retail markup is yours to set. See `docs/pricing-markup.md`.

For end-customer auth, billing, and dashboard, you build that yourself on top of the foundation. The starter examples don't include it because every reseller wants different end-customer UX (Telegram, web dashboard, API-only, etc.).

## 7. Verify the whole loop

1. Buy a proxy on behalf of `first-customer` (step 5)
2. Connect through it: `curl -x http://$LOGIN:$PASS@$HOST:$PORT https://api.ipify.org` → should return a mobile carrier IP
3. Wait. When that modem eventually fails a health check 5× in a row, Coronium will fire `modem.replaced` to your webhook with new credentials. Update your customer record. Email the customer the new URL. They keep using the proxy with zero visible interruption.

That's the whole flywheel.
