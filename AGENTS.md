# AGENTS.md — Coronium Reseller Kit

> Instructions for AI coding agents (Claude Code, Cursor, Windsurf, Aider, etc.)
> tasked with building a reseller dashboard or automation against the Coronium
> mobile-proxy API.

## TL;DR for the agent

You are scaffolding a **proxy reseller business**. The user resells mobile 4G/5G proxies — they buy wholesale from Coronium, mark up, sell to their own customers. Your job is to give them a working dashboard + webhook handler so they can run that business without a backend team.

**Read these in order, then start coding:**

1. This file (`AGENTS.md`) — orientation + hard rules
2. `examples/nextjs-dashboard/` — copy-paste foundation
3. `docs/webhook-integration.md` — the auto-swap event flow
4. `docs/metadata-strategy.md` — how to map Coronium modems to the reseller's end-customers without a separate database
5. Coronium reseller API — authoritative interactive OpenAPI / Swagger UI: <https://dashboard.coronium.io/api-docs/> (public, no login required)

## The minimum-viable reseller dashboard has six features

When the user asks for a dashboard, deliver these. Anything beyond is bonus.

1. **API key setup** — page where the reseller pastes their `CORONIUM_API_KEY` (we won't see it; their dashboard talks to Coronium server-side)
2. **Proxy inventory** — list all proxies the reseller has bought, grouped by their `metadata.customer_id`
3. **Buy proxies** — form to buy N proxies in a chosen country/carrier and attach them to a chosen end-customer (writes `metadata.customer_id`)
4. **Webhook endpoint** — POST handler at `/api/coronium/webhook` that processes `modem.replaced` and `modem.dead` events
5. **End-customer view** — page per end-customer showing their proxies, with copy-button for credentials
6. **Health check** — call `/account/proxies/health` and surface dead proxies before the end-customer hits them

## Hard rules — do not violate

1. **Never put `CORONIUM_API_KEY` in client-side code.** All API calls must go through server routes (Next.js `app/api/...`, or Express/Fastify proxy). The dashboard is hosted by the reseller; their token must not leak to browsers.
2. **Use the `metadata` field for customer mapping.** Do NOT create a separate Postgres table to track which Coronium modem belongs to which of the reseller's customers. The `metadata` field on every Modem is freeform JSON, returned in every list, persistent across rotations. Sidecar databases drift out of sync.
3. **Register the webhook URL via `PUT /api/v3/account/webhook` exactly once on first deploy.** Don't re-PUT every request. Store the registration in the reseller's own state (config file, env, KV) so you know when it's already configured.
4. **Authenticate via Bearer header** for any new code you write. `?auth_token=` query-param also works but logs to access.log everywhere; Bearer is the right pattern.
5. **Stock-out is normal.** `POST /payment/buy-modems-with-crypto-balance` fails when we have no inventory in that country/carrier right now. It currently surfaces as **`500` with `error: "No free modems"`** — there is no `409 stock_unavailable`. Match on the message, surface it clearly, don't retry-loop.
6. **Idempotency** — `/payment/*` POSTs accept an `Idempotency-Key` header (`[A-Za-z0-9_-]{8,128}`, 24h window; a replay answers with `X-Idempotency-Replay: true`). Generate ONE UUID per buy *intent* — at the moment the human confirms — and resend that same key on every retry. A key derived from a timestamp changes between attempts and buys twice.
7. **Don't reinvent the auto-swap logic.** The backend does it. You receive `modem.replaced` events; the fields are under `data` (`data.old_modem_id`, `data.new_modem_id`, `data.new_modem`). Update your local mapping, re-stamp the metadata, ack 200.
8. **Rotation is synchronous and reports failure with a 200.** `POST /modems/{id}/restart` holds the request open until the carrier answers, then returns `{result:'ok', rotated: <bool>, ip, message}`. **`rotated:false` at HTTP 200 means the IP did NOT change** — branch on `rotated`, never on the status code. There is no `?sync=true` query flag and no `503 rotation_timeout`; both were removed. The token-auth variant `GET /modems/rotate-modem-by-token/{token}` behaves differently: `200` only on a verified new IP (carries `ext_ip`/`new_ip`), `502` otherwise (branch on that HTTP status, not on a body error code), `429` inside the ~60 s per-modem cooldown.
9. **`rotation_interval` is in SECONDS.** `PUT /modems/{id}/set-rotation-interval` accepts `0` (disabled) or **≥ 60**. Anything from 1 to 59 is a 400 — a caller who thinks in minutes and sends `5` gets rejected, and one who sends `30` meaning "30 minutes" gets rejected too.
10. **`metadata` is a JSON string, and it is NOT inherited by auto-swap replacements.** Send it pre-stringified on buy. After a `modem.replaced` event, re-stamp the new modem with `PUT /modems/{new_modem_id}/set-metadata` or that proxy is permanently unattributed.

## Architecture you should produce

```
reseller-dashboard/
  app/                       (Next.js App Router — recommended; SvelteKit/Remix are also fine)
    page.tsx                 # Landing / API-key paste form
    dashboard/
      page.tsx               # Reseller's home: customer list, total proxies, recent webhook events
      customers/[id]/
        page.tsx             # End-customer detail: their proxies, credentials, health
    api/
      coronium/
        [...path]/route.ts   # Server-side proxy to Coronium API (keeps JWT off the client)
        webhook/route.ts     # POST handler for modem.replaced + modem.dead events
  lib/
    coronium.ts              # Typed client wrapper around Coronium REST (or use `coronium-sdk` package)
    customers.ts             # Local model of end-customers (KV / SQLite / JSON file)
  README.md
  .env.example
```

## State storage

For v1, the reseller's end-customer list is small (10-1000 customers). Don't force Postgres. Use one of:

- **SQLite** (`better-sqlite3`) — single file, zero ops, instantly backupable
- **Vercel KV / Upstash** — if deploying serverless
- **JSON file** — for prototypes

Schema for a customer:

```ts
type Customer = {
  id: string;            // reseller-chosen, e.g. "acme-007"
  name: string;
  email?: string;
  created_at: number;
  markup_pct?: number;   // optional — for display only, doesn't affect Coronium pricing
  notes?: string;
};
```

The proxies themselves stay in Coronium. The reseller's DB only holds end-customer profiles. Mapping happens via `metadata.customer_id` on each modem.

## Webhook contract (the most important section)

Every event shares ONE envelope. The event-specific fields are nested under `data` — this is the single most common integration bug, because `body.old_modem_id` silently reads `undefined`.

```json
{
  "event_id": "3f1a…-uuid",
  "event": "modem.replaced",
  "occurred_at": "2026-07-25T08:34:53.000Z",
  "account": { "user_id": "6600aa…", "email": "reseller@example.com" },
  "data": { }
}
```

When a modem the reseller owns dies (5+ consecutive failed health checks AND remaining paid time), Coronium auto-swaps it and POSTs `modem.replaced` with:

```json
"data": {
  "old_modem_id": "69b5926c942c49e02b9f50c7",
  "new_modem_id": "6a1cf4d2942c49e02b1234ab",
  "new_modem": {
    "_id": "6a1cf4d2942c49e02b1234ab",
    "name": "cor_US_NJ_x83",
    "IMEI": "EXAMPLE_IMEI_PLACEHOLDER",
    "portId": "cor_US_…",
    "country_code": "US",
    "carrier_id": "...",
    "host": "172.56.171.4",
    "http_port": "8042",
    "socks_port": "5042",
    "proxy_login": "admin",
    "proxy_password": "kP3aL9zXq7Wm",
    "tariff_expired_at": 1780987974498,
    "isOnline": true
  }
}
```

When stock is unavailable in the geo, `modem.dead` with:

```json
"data": {
  "old_modem_id": "...",
  "new_modem_id": null,
  "reason": "no_stock" | "pipeline_failed" | "shared_modem" | "tariff_orphan" | "modem_not_found" | "unknown",
  "remediation": "POST /api/v3/modems/{old_modem_id}/replace to retry, or contact support"
}
```

You also receive `proxy.purchased`, `proxy.renewed` and `proxy.expired`. Ignore `proxy.expiring_soon` — the `PUT /account/webhook` response lists it, but nothing emits it.

**Handler must:**

1. Verify `X-Coronium-Signature` (`sha256=<hmac-sha256 of the RAW body>`) against the account's signing secret, over the raw bytes — not the re-serialized JSON
2. `res.sendStatus(200)` fast (ack within the 5s timeout)
3. Then process: update mapping `data.old_modem_id → data.new_modem_id`, **re-stamp metadata on the new modem**, notify your end-customer with new credentials, log event
4. Be idempotent, keyed on `event_id` — a non-2xx is retried up to 8 times with backoff, and Coronium can replay dead-lettered events

## Hard-coded values worth knowing

- API base: `https://api.coronium.io/api/v3`
- API docs: `https://dashboard.coronium.io/api-docs/` (public, no login required)
- JWT lifetime: 365 days, refreshable via `POST /api/v3/wallet-key/rotate-challenge` + `/wallet-key/rotate`
- Webhook delivery: 5s timeout, up to 8 attempts with escalating backoff, then dead-letter; HMAC-signed via `X-Coronium-Signature` + `X-Coronium-Event-Id`; redirects not followed
- Detection cadence: every 30 min, threshold 5 consecutive failed health checks
- Refresh cadence for `/account/proxies/health`: 30 min server-side (cache client-side 30-60s)
- `GET /tariffs/available` needs no auth — handy as a connectivity check
- Error envelope on 4xx/5xx: `{error, code, suggested_action, request_id, documentation_url?}` + `X-Request-Id` header. No `message` field
- Currency: USD throughout; cents for Stripe payments, dollars for crypto/balance

## When user asks for features beyond the minimum

Common requests and the right answer:

- **"Add Telegram bot"** — separate service, share the same `lib/coronium.ts` client. See `examples/telegram-bot` (Phase 2, may not exist yet).
- **"Add per-customer billing"** — calculate `customer.markup_pct × modem.price` in your dashboard. Charge them via your own payment processor (Stripe/PayPal). Coronium doesn't bill end-customers; you do.
- **"Show usage stats per customer"** — Coronium doesn't expose bandwidth-per-modem on the reseller API. If they need this, point them at the Pool Gateway product (different SKU, different SDK at `@proxies-sx/pool-sdk`).
- **"Add OAuth login for end-customers"** — out of scope for v1; the reseller owns auth on their side.
- **"Wallet integration"** — if the reseller wants end-customers to pay in crypto, integrate a wallet on the reseller's side, then top up the reseller's Coronium balance with the net amount.

## Failure modes to handle gracefully

| Symptom | What it means | What to do |
|---|---|---|
| `401 Unauthorized` on any call | API key invalid or expired | Show "reauthorize" UI; user pastes a fresh key |
| `500` + `error: "No free modems"` on buy | No proxies in that country/carrier right now | Show "try different country" UX, don't retry-loop |
| `500` + `error: "Bad modem count"` | You sent `modem_count`/`count`, or a non-positive number | The field is `modemCount` |
| `400` on set-rotation-interval | Value between 1 and 59 | The unit is SECONDS; minimum 60, or 0 to disable |
| `200` with `rotated: false` | Rotation ran but the IP did not change | Retry after a few seconds; if it persists, `/replace` the modem |
| `429` on rotate-by-token | Inside the ~60 s per-modem cooldown | Back off; don't hammer |
| Webhook fields all `undefined` | You're reading the top level | They're under `data` — `body.data.old_modem_id` |
| Webhook never fires after a modem dies | No webhook URL set, or your endpoint is failing | Run `POST /account/webhook/test` — it returns your endpoint's actual response |
| `modem.dead` with `reason: "no_stock"` | We tried to swap, couldn't find replacement geo | Notify your customer, retry-`replace` manually later |
| Swapped proxy shows as unassigned | Metadata isn't carried onto replacements | Re-stamp via `PUT /modems/{id}/set-metadata` in your webhook handler |

## When you're done

Show the user:

1. **Local URL** to open in their browser
2. **Deploy command** for their preferred host (Vercel: `vercel deploy`; Railway: `railway up`; Docker: provide Dockerfile)
3. **Webhook registration command** — the one-liner curl or fetch to PUT their dashboard URL into Coronium
4. **A test purchase** — buy one cheap proxy from the dashboard against their actual API key, show the credentials in their UI, prove the loop works end-to-end

Don't claim "done" until the test purchase succeeded and the proxy is visible in the reseller's UI.
