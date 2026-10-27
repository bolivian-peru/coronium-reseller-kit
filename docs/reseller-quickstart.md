# Reseller quickstart

The shortest possible path from zero to a working reseller business.

## 1. Sign up at Coronium

<https://dashboard.coronium.io> - create an account, verify email, fund your balance in the dashboard (account credit) or with BTC to the deposit address from `GET /account/crypto-balance`. The API purchase routes spend account credit or BTC; USDT held at Coronium is not spent by them. There is no top-up API. The balance is what you pay Coronium when you buy proxies on customers' behalf.

## 2. Get your API key

Dashboard → Your Account → API Access. Copy the JWT. This is your reseller identity for every API call.

Confirm it works before building anything:

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit
CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs
```

This checks reachability, live stock, your key, balance, inventory, health and webhook registration - read-only, nothing is bought. On Node 20.12+ it also reads the key from `examples/nextjs-dashboard/.env` or `./.env`. No webhook yet is a warning, not a failure: after deploy, re-run with `--require-webhook --webhook-test`. Every failure prints the `request_id` to quote in a support ticket.

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
API reference is <https://api.coronium.io/api-docs/>.

### C) Just the webhook (you already have a backend / CRM)

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/webhook-receiver
npm install
CORONIUM_WEBHOOK_SECRET=<your-signing-secret> node server.js
```

### D) AI-scaffolded custom dashboard

Paste `PROMPT.md` into Claude Code, Cursor, or Windsurf. The agent reads `AGENTS.md`, uses the Next.js example as foundation, builds your custom features.

## 4. Register your webhook URL

This is the most important step. Without it, you never get notified when a customer's modem dies.

First create your own signing secret (it is shown only in this answer; store it server-side):

```bash
curl -X POST https://api.coronium.io/api/v3/account/webhook/secret/rotate \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

Put it in your receiver's environment as `CORONIUM_WEBHOOK_SECRET` and restart the receiver.
The kit's receivers refuse events until it is set. Until you create one, deliveries are
signed with the platform default secret (`X-Coronium-Signature-Source: global`), which you
cannot verify, so a test sent before this step fails on a correct setup.

Then register the URL:

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://your-host/api/coronium/webhook"}'
```

Then prove it actually works - don't wait for a real outage to find out:

```bash
curl -X POST https://api.coronium.io/api/v3/account/webhook/test \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

The response contains the HTTP status your endpoint returned. With the Next.js example,
`npm run register-webhook` does the register and test steps for you.

Coronium POSTs a signed `modem.replaced` event when a supported auto-swap succeeds. Persist it before acknowledging, update your CRM, re-stamp metadata and notify the customer of changed credentials. Handle `modem.dead` and `proxy.purchase_failed` as service incidents.

## 5. Buy your first proxy

Pick a `tariff_id` from `GET /api/v3/tariffs/available` (public, no auth). No header is needed; add `X-Coronium-Proxy-Credentials: separate-protocol-v1` on stock and purchase only if your client reads separate HTTP/SOCKS5 logins from `proxyEndpoints`. Then, with authorization to spend the reseller balance, buy through the dashboard UI or curl:

```bash
# One plan with stock, and its price: the buyer approves price x modemCount.
read -r TARIFF_ID PRICE < <(curl -s https://api.coronium.io/api/v3/tariffs/available | jq -r '.data[] | select(.stock > 0) | "\(._id) \(.price)"' | head -1)
curl -X POST https://api.coronium.io/api/v3/payment/buy-modems-with-crypto-balance \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Coronium-Proxy-Credentials: separate-protocol-v1" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "tariff_id": "'"$TARIFF_ID"'",
    "modemCount": 1,
    "max_total_usd": '"$PRICE"',
    "metadata": "{\"customer_id\":\"first-customer\"}"
  }'
```

It is `modemCount`, and `metadata` is a JSON string. Country and carrier come from the tariff. `max_total_usd` is the total the buyer approved (price x `modemCount`): a `409 price_changed` means the price moved above it and nothing was charged. Reuse that same `Idempotency-Key` if you retry, so a timeout can never charge you twice. This route spends the BTC balance: a `401 "Insufficient crypto balance"` means that balance is too low (fund it, or buy through `/payment/buy-with-account-credit` with the same body). It is not a key problem, so do not regenerate the key.

You get back `{result, charged_usd, currency, data:[{_id, http_port, socks_port, proxy_login, proxy_password, ext_ip, …}], billing}`. `data[0]` is your customer's proxy; `billing` itemizes what you were charged.

If stock ran out between listing and buying, the balance lanes return `409` with `code: "no_stock"` (`reason_code: "OUT_OF_STOCK"`) and nothing is charged; ask the buyer to choose another available product. With `require: ["p0f"]` the refusal is `409 p0f_unavailable`.

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
   The response is `{"result":"ok","rotated":true,"ip":"…"}`. If `rotated` is `false` the IP did not change - the call still returns 200, so always read that field. A second rotation within 60 s answers `429` with `Retry-After`. A proxy with `proxyEndpoints` answers 202 `pending: true` instead: poll `GET /modems/$MODEM_ID/rotation-status` until `done` or `failed`. A `409` means the rotate was refused and nothing was queued: read `code` and `suggested_action`, and if `error` says the last rotation is under review, stop retrying and contact support.
4. Where the provider supports auto-swap, a signed `modem.replaced` event names the replacement in `data.new_modem_id`. Refetch the line from `GET /account/proxies`, reconcile the mapping, re-stamp metadata and notify the customer. For providers without replacement capability, rely on health checks and your support workflow.

That's the whole flywheel.
