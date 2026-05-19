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
5. Coronium reseller API: <https://github.com/bolivian-peru/coronium-new-app/blob/main/CORONIUM_RESELLER_API.md> (authoritative)
6. OpenAPI: <https://dashboard.coronium.io/api-docs/> (interactive Swagger UI; basic-auth gated)

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
5. **Stock-out is normal.** `POST /payment/buy-modems-with-crypto-balance` returning a stock error (`409`) means we have no inventory in that country/carrier right now. Surface this clearly to the reseller; don't retry-loop.
6. **Idempotency** — POSTs that create resources accept an optional `Idempotency-Key` header. Use a UUID per buy action; safe-retry will dedupe.
7. **Don't reinvent the auto-swap logic.** The backend does it. You receive `modem.replaced` events with `{old_modem_id, new_modem_id, new_modem: {...full creds}}`. Update your local mapping atomically and ack 200. That's it.
8. **For rotations that must succeed-or-fail-honestly, use `?sync=true`.** The default `POST /modems/{id}/restart` and `/modems/rotate-modem-by-token/{token}` return `200` *the instant the request is queued*, **before** the actual rotation completes. Silent failures (stuck worker, sticky carrier IP, daemon error) leave the client with a 200 + unchanged IP. Appending `?sync=true` blocks for up to 25 s and returns the real outcome: `200` with `new_ip` on success, `502 rotation_failed` on confirmed failure, or `503 rotation_timeout`. Use `?sync=true` for any rotation whose result your code branches on. Use the async default only for fire-and-forget timers where the next traffic through the proxy is your verification.

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

When a modem the reseller owns dies (5+ consecutive failed health checks AND remaining paid time), Coronium auto-swaps it and POSTs to the webhook URL:

```json
{
  "event": "modem.replaced",
  "old_modem_id": "69b5926c942c49e02b9f50c7",
  "new_modem_id": "6a1cf4d2942c49e02b1234ab",
  "new_modem": {
    "_id": "6a1cf4d2942c49e02b1234ab",
    "name": "cor_US_NJ_x83",
    "IMEI": "EXAMPLE_IMEI_PLACEHOLDER",
    "country_code": "US",
    "carrier_id": "...",
    "host": "172.56.171.4",
    "http_port": "8042",
    "socks_port": "5042",
    "proxy_login": "admin",
    "proxy_password": "kP3aL9zXq7Wm",
    "tariff_expired_at": 1780987974498,
    "isOnline": true
  },
  "ts": 1779192208000
}
```

When stock is unavailable in the geo:

```json
{
  "event": "modem.dead",
  "old_modem_id": "...",
  "new_modem_id": null,
  "reason": "no_stock" | "pipeline_failed" | "shared_modem" | "tariff_orphan" | "modem_not_found" | "unknown",
  "remediation": "POST /api/v3/modems/{old_modem_id}/replace later",
  "ts": ...
}
```

**Handler must:**

1. `res.sendStatus(200)` first (ack within the 5s timeout)
2. Then process: update mapping `old_modem_id → new_modem_id`, notify your end-customer with new credentials, log event
3. Be idempotent — same event may arrive twice across deploys

## Hard-coded values worth knowing

- API base: `https://api.coronium.io/api/v3`
- API docs: `https://dashboard.coronium.io/api-docs/` (basic-auth gated)
- JWT lifetime: 365 days, refreshable via `POST /api/v3/wallet-key/rotate-challenge` + `/wallet-key/rotate`
- Webhook delivery: 5s timeout, no retries v1, no HMAC v1
- Detection cadence: every 30 min, threshold 5 consecutive failed health checks
- Refresh cadence for `/account/proxies/health`: 30 min server-side (cache client-side 30-60s)
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
| `409 stock_unavailable` on buy | No proxies in that country/carrier right now | Show "try different country" UX, don't retry-loop |
| `429 Rate limited` | Hitting our rate limiter | Back off exponentially; show toast |
| Webhook never fires after a modem dies | Customer hasn't set their webhook URL, OR delivery failed | Check `PUT /account/webhook` was called once; fallback to polling `/account/proxies/health` every 5 min |
| `modem.dead` with `reason: "no_stock"` | We tried to swap, couldn't find replacement geo | Notify your customer, retry-`replace` manually later |

## When you're done

Show the user:

1. **Local URL** to open in their browser
2. **Deploy command** for their preferred host (Vercel: `vercel deploy`; Railway: `railway up`; Docker: provide Dockerfile)
3. **Webhook registration command** — the one-liner curl or fetch to PUT their dashboard URL into Coronium
4. **A test purchase** — buy one cheap proxy from the dashboard against their actual API key, show the credentials in their UI, prove the loop works end-to-end

Don't claim "done" until the test purchase succeeded and the proxy is visible in the reseller's UI.
