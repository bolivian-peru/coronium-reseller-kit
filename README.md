# Coronium Reseller Kit

> Open-source starter for building a mobile-proxy reseller business on top of the [Coronium](https://dashboard.coronium.io) API. Optimized for AI coding agents (Claude Code, Cursor, Windsurf, Aider) to scaffold a working dashboard in one prompt.

## For AI agents

If you're an AI agent scaffolding a reseller dashboard, **read these first** in this order:

1. [`AGENTS.md`](./AGENTS.md) — hard rules, architecture template, failure-mode table
2. [`llms.txt`](./llms.txt) — concise machine-readable surface
3. [`PROMPT.md`](./PROMPT.md) — paste-ready prompts (Next.js / CLI / webhook-only / Telegram-bot variants)
4. [`examples/nextjs-dashboard/`](./examples/nextjs-dashboard/) — working foundation, copy and modify
5. [`docs/webhook-integration.md`](./docs/webhook-integration.md) — the auto-swap event flow

Authoritative API reference — interactive OpenAPI / Swagger UI: <https://dashboard.coronium.io/api-docs/> (public, no login required)

## For humans

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/nextjs-dashboard
cp .env.example .env  # set your API key, operator login, and webhook secret
npm ci && npm run dev
open http://localhost:3000
```

Or paste this into Claude Code / Cursor / Windsurf:

```
Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and scaffold me a Next.js reseller dashboard using examples/nextjs-dashboard
as the foundation. My CORONIUM_API_KEY is in .env. Run read-only checks first;
ask me before any paid test purchase.
```

## What this kit gives you

| Surface | Purpose |
|---|---|
| `examples/verify-integration.mjs` | Read-only smoke test for key, separate balances, PocketProxy-aware stock and webhook configuration |
| `examples/nextjs-dashboard/` | Self-hosted Next.js operator dashboard — customer mapping, PocketProxy-aware stock, purchase/renewal, signed webhook inbox |
| `examples/webhook-receiver/` | Durable signed event receiver for resellers with their own CRM worker |
| `docs/reseller-quickstart.md` | Zero → revenue path, 7 steps |
| `docs/webhook-integration.md` | Auto-swap event flow contract |
| `docs/metadata-strategy.md` | Customer mapping via `metadata` plus a small local swap-recovery index |
| `docs/pricing-markup.md` | 2026 market rates + economics |

## Coronium API surface used

| Method · Path | Purpose |
|---|---|
| `GET /api/v3/account/proxies` | List proxies you own |
| `GET /api/v3/account` | Account credit, BTC and USDT balances |
| `GET /api/v3/account/proxies/health` | Per-proxy `is_alive` + `recommendation` |
| `GET /api/v3/tariffs/available` | In-stock tariffs (filtered by country/carrier) |
| `POST /api/v3/payment/buy-modems-with-crypto-balance` | Buy proxies, attach `metadata.customer_id` |
| `POST /api/v3/payment/buy-with-account-credit` | Buy using USD account credit |
| `POST /api/v3/payment/renewal-quote` | Read-only renewal price for owned proxies |
| `POST /api/v3/payment/renew-with-account-credit` | Explicit renewal using account credit |
| `POST /api/v3/payment/renew-modems-with-crypto-balance` | Explicit renewal using BTC balance |
| `POST /api/v3/modems/{id}/restart` | Rotate IP. Synchronous — always 200, branch on `rotated` |
| `PUT /api/v3/modems/{id}/set-rotation-interval` | Auto-rotate every N **seconds** (min 60, 0 disables) |
| `POST /api/v3/modems/{id}/replace` | Swap broken proxy (same country, transferred subscription time) |
| `PUT /api/v3/modems/{id}/set-metadata` | Re-stamp customer mapping (needed after an auto-swap) |
| `GET /api/v3/modems/rotate-modem-by-token/{token}` | Token-auth rotation for end-customer scripts. 200 only on a verified new IP |
| `PUT /api/v3/account/webhook` | Register HTTPS webhook for account events |
| `GET /api/v3/account/webhook` | Read current webhook URL |
| `POST /api/v3/account/webhook/test` | Fire a real signed test event and get the delivery result |

Auth: `Authorization: Bearer <jwt>` header. Get your JWT at <https://dashboard.coronium.io> → Settings → API.

For PocketProxy inventory and purchases, also send `X-Coronium-Proxy-Credentials: separate-protocol-v1`. This opts your client into **separate** `proxyEndpoints.http` and `proxyEndpoints.socks5` credentials. The legacy login/password fields describe HTTP only. Check each proxy's capabilities; PocketProxy customer auto-renew and replacement are not advertised. Its billing coverage date is not a customer rental deadline.

Confirm your key works before writing any code:

```bash
CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs
```

### Rotation returns 200 even when it fails

`POST /modems/{id}/restart` holds the request open until the carrier responds, then reports the truth in the body:

```json
{ "result": "ok", "rotated": true,  "ip": "172.56.171.9", "message": "IP rotated to 172.56.171.9." }
{ "result": "ok", "rotated": false, "ip": "172.56.171.4", "message": "Rotation did not change the IP (…)" }
```

Both are HTTP 200. **Branch on `rotated`, never on the status code.** The token-auth variant differs: it answers 200 only on a verified new IP, `502` otherwise (branch on that HTTP status, not on a body error code), and `429` while a modem is inside its ~60 s cooldown.

### Errors

Every 4xx/5xx on `/api/v3` carries:

```json
{
  "error": "No free modems",
  "code": "OUT_OF_STOCK",
  "suggested_action": "retry_later_or_different_tariff",
  "request_id": "req_MZpmKb_FCA"
}
```

`error` is the human string, `code` the machine identifier. Log `request_id` (also returned as the `X-Request-Id` header) and quote it in support tickets. The current balance-purchase lanes return **409 `OUT_OF_STOCK`** when stock runs out. Do not retry-loop or switch products without asking the buyer.

## Core integration pattern (read this once)

### 1. The `metadata` field is your customer-mapping layer

Stamp `metadata.customer_id` on every purchase. Keep a small durable local modem/customer index as swap recovery: replacements do not inherit metadata, and the old modem may be gone before your webhook worker runs.

```json
POST /api/v3/payment/buy-modems-with-crypto-balance
{
  "tariff_id": "...",
  "modemCount": 1,
  "metadata": "{\"customer_id\":\"acme-007\",\"tag\":\"tiktok-batch\"}"
}
```

`modemCount` is the field name — `modem_count` and `count` are ignored, and the request fails with `Bad modem count`. Country and carrier come from the **tariff**; sending them in the body does nothing. Send `metadata` pre-stringified: it is a string column server-side. Keep the same `Idempotency-Key` and exact body on every retry of one order.

Every `GET /account/proxies` returns the same `metadata` verbatim. Filter client-side by `customer_id`. Full pattern in [`docs/metadata-strategy.md`](./docs/metadata-strategy.md).

The 200 also carries an itemized `billing` block (`line_items`, `subtotal_usd`, `discount`, `charged_usd`, `settlement`) so you can reconcile the charge without a second call — **price before coupon** is `subtotal_usd`, **price after coupon** is `charged_usd`, and every figure ties out to the cent. Plus a `webhook` receipt telling you whether an event is coming and which `event_id` to match it on.

Each proxy also carries `carrier: {_id, name, code}` when resolvable. **Quote renewals with `POST /payment/renewal-quote`** for the exact owned modem and term before charging; a country-only tariff estimate can be wrong.

Full reference: [docs/billing-and-reconciliation.md](docs/billing-and-reconciliation.md).

### 2. Signed lifecycle events

When a supported modem is auto-replaced, Coronium transfers its remaining paid time and POSTs your webhook URL. Replacement is conditional on stock and provider capabilities. Every event shares one envelope, with the event-specific fields under `data`:

```json
{
  "event_id": "3f1a…-uuid",
  "event": "modem.replaced",
  "occurred_at": "2026-07-25T08:34:53.000Z",
  "account": { "user_id": "...", "email": "..." },
  "data": {
    "old_modem_id": "...",
    "new_modem_id": "...",
    "new_modem": {
      "host": "...", "http_port": "...", "socks_port": "...",
      "proxy_login": "...", "proxy_password": "...",
      "tariff_expired_at": 1780987974498, "country_code": "...", "isOnline": true
    }
  }
}
```

Reading `body.old_modem_id` gives `undefined` — it lives at `body.data.old_modem_id`. Deliveries are signed (`X-Coronium-Signature`) and retried up to 8 times, so verify the signature and dedupe on `event_id`. **The replacement does not inherit `metadata`** — re-stamp it, or the proxy shows up unassigned.

If no replacement is available, you may get `modem.dead` with `new_modem_id: null` and a `reason` code. You also receive purchase, purchase-failure, renewal and expiry events. Full event spec in [`docs/webhook-integration.md`](./docs/webhook-integration.md).

### 3. Protect active customers

Treat active proxies as customer-owned service. Check current ownership and capabilities before any replacement or settings change. A replacement may change credentials; contact the customer. Never assume a webhook means the replacement is already usable in your own storefront.

## Hard rules (also in AGENTS.md, repeated here for human readers)

1. **Never put `CORONIUM_API_KEY` in client-side code.** Server-side only. Protect the operator dashboard before putting it online.
2. **Use HTTPS for your webhook URL.** HTTP returns 400, and so does any private or non-resolving host.
3. **Persist the signed webhook durably before acknowledging it within 5 seconds.** Non-2xx is retried; dedupe on `event_id` and process from a durable inbox.
4. **Verify `X-Coronium-Signature`** over the raw request bytes before trusting a payload.
5. **Idempotency**: pass an `Idempotency-Key` header on any `/payment/*` POST — `[A-Za-z0-9_-]{8,128}`, 24h window, replays answer with `X-Idempotency-Replay: true`. One key per buy *intent*, reused across retries; a key that changes per attempt buys twice.
6. **Rotation is synchronous and answers 200 on failure.** Branch on `rotated`, not on the status code.
7. **`rotation_interval` is in SECONDS**, minimum 60, `0` disables. Passing minutes gets a 400.
8. **Don't reinvent auto-swap or health logic.** Both are server-side, battle-tested.

## License

MIT. Fork it, change it, ship it.

## Contact

- Code questions: GitHub Issues on this repo
- API access / partner deals / volume pricing: <hello@coronium.io>
- Coronium status / changelog: <https://dashboard.coronium.io>
