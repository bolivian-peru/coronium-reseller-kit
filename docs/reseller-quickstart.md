# Reseller quickstart

The shortest possible path from zero to a working reseller business.

## 1. Sign up at Coronium

<https://dashboard.coronium.io> — create an account, verify email, top up your balance via Stripe / Bitcoin / USDT. The balance is what you pay Coronium when you buy proxies on customers' behalf.

## 2. Get your API key

Dashboard → Settings → API. Copy the JWT. This is your reseller identity for every API call.

Confirm it works before building anything:

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit
CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs
```

This checks reachability, live stock, your key, balance, inventory, health and webhook registration — read-only, nothing is bought. Every failure prints the `request_id` to quote in a support ticket.

## 3. Pick a starter

Choose one:

### A) Self-hosted operator dashboard

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/nextjs-dashboard
cp .env.example .env  # set API key, operator login, webhook signing secret
npm ci && npm run dev
open http://localhost:3000
```

For production use a persistent writable volume, HTTPS and the companion
`npm run worker` process. The local SQLite database cannot be used unchanged on
an ephemeral serverless host. See the example's README.

### B) API-only integration

You can integrate directly with the REST API. No reseller dashboard or SDK is
required. Use Bearer auth server-side, fetch `GET /account` for the distinct
account-credit/BTC/USDT balances, `GET /tariffs/available` for stock, and
`POST /payment/renewal-quote` before an explicit renewal. The raw interactive
API reference is <https://dashboard.coronium.io/api-docs/>.

### C) Just the webhook (you already have a backend / CRM)

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/webhook-receiver
npm install
CORONIUM_WEBHOOK_SECRET=<signing-secret-from-support> node server.js
```

### D) AI-scaffolded custom dashboard

Paste `PROMPT.md` into Claude Code, Cursor, or Windsurf. The agent reads `AGENTS.md`, uses the Next.js example as foundation, builds your custom features.

## 4. Register your webhook URL

This is the most important step. Without it, you never get notified when a customer's modem dies.

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://your-host/api/coronium/webhook"}'
```

Then prove it actually works — don't wait for a real outage to find out:

```bash
curl -X POST https://api.coronium.io/api/v3/account/webhook/test \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

The response contains the HTTP status your endpoint returned.

Coronium POSTs a signed `modem.replaced` event when a supported auto-swap succeeds. Persist it before acknowledging, update your CRM, re-stamp metadata and notify the customer of changed credentials. Handle `modem.dead` and `proxy.purchase_failed` as service incidents.

## 5. Buy your first proxy

Pick a `tariff_id` from `GET /api/v3/tariffs/available` (public, no auth). For PocketProxy include `X-Coronium-Proxy-Credentials: separate-protocol-v1` on stock and purchase. Then, with authorization to spend the reseller balance, buy through the dashboard UI or curl:

```bash
curl -X POST https://api.coronium.io/api/v3/payment/buy-modems-with-crypto-balance \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Coronium-Proxy-Credentials: separate-protocol-v1" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "tariff_id": "61ef075c5a33f238ac15a8e7",
    "modemCount": 1,
    "metadata": "{\"customer_id\":\"first-customer\"}"
  }'
```

It is `modemCount`, and `metadata` is a JSON string. Country and carrier come from the tariff. Reuse that same `Idempotency-Key` if you retry, so a timeout can never charge you twice.

You get back `{result, charged_usd, currency, data:[{_id, http_port, socks_port, proxy_login, proxy_password, ext_ip, …}], billing}`. `data[0]` is your customer's proxy; `billing` itemizes what you were charged.

If stock ran out between listing and buying, the current balance lanes return `409 OUT_OF_STOCK`; ask the buyer to choose another available product.

## 6. Set up the customer-facing side

Coronium gives you the wholesale price. Your retail markup is yours to set. See `docs/pricing-markup.md`.

For end-customer auth, billing, and dashboard, you build that yourself on top of the foundation. The starter examples don't include it because every reseller wants different end-customer UX (Telegram, web dashboard, API-only, etc.).

## 7. Verify the whole loop

1. Buy a proxy on behalf of `first-customer` (step 5)
2. Connect through it: `curl -x http://$LOGIN:$PASS@$HOST:$PORT https://api.ipify.org` → should return a mobile carrier IP
3. Rotate it and confirm the IP actually changed:
   ```bash
   curl -X POST https://api.coronium.io/api/v3/modems/$MODEM_ID/restart \
     -H "Authorization: Bearer $CORONIUM_API_KEY"
   ```
   The response is `{"result":"ok","rotated":true,"ip":"…"}`. If `rotated` is `false` the IP did not change — the call still returns 200, so always read that field.
4. Where the provider supports auto-swap, a signed `modem.replaced` event carries the new connection details. Reconcile the mapping, re-stamp metadata and notify the customer. For providers without replacement capability, rely on health checks and your support workflow.

That's the whole flywheel.
