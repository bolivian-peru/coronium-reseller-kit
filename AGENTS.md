# AGENTS.md - Coronium Reseller Kit

> Instructions for AI coding agents (Claude Code, Cursor, Windsurf, Aider, etc.)
> tasked with building a reseller dashboard or automation against the Coronium
> mobile-proxy API.

## TL;DR for the agent

You are scaffolding a **proxy reseller business**. The user resells mobile 4G/5G proxies - they buy wholesale from Coronium, mark up, sell to their own customers. Your job is to give them a working dashboard + webhook handler so they can run that business without a backend team.

**Read these in order, then start coding:**

1. This file (`AGENTS.md`) - orientation + hard rules
2. `examples/nextjs-dashboard/` - copy-paste foundation
3. `docs/webhook-integration.md` - the auto-swap event flow
4. `docs/metadata-strategy.md` - metadata plus the durable local mapping needed for swaps
5. `docs/p0f-and-openvpn.md` - p0f stock per region, `require: ["p0f"]` on buy, OpenVPN download answers
6. Coronium reseller API - authoritative interactive OpenAPI / Swagger UI: <https://api.coronium.io/api-docs/> (public, no login required). Kit synced with OpenAPI 3.3.5; see `CHANGELOG.md`

## The minimum-viable reseller dashboard has six features

When the user asks for a dashboard, deliver these. Anything beyond is bonus.

1. **API key setup** - read the key from a server-side environment variable; protect the operator dashboard before hosting it
2. **Proxy inventory** - list all proxies the reseller has bought, grouped by their `metadata.customer_id`
3. **Buy proxies** - form to buy N proxies in a chosen country/carrier and attach them to a chosen end-customer (writes `metadata.customer_id`)
4. **Webhook endpoint** - POST handler at `/api/coronium/webhook` that processes `modem.replaced` and `modem.dead` events
5. **Customer record view for the operator** - page per end-customer showing assigned proxies and separate HTTP/SOCKS5 credentials. A public end-customer portal needs its own tenant authentication.
6. **Health check** - call `/account/proxies/health` and surface dead proxies before the end-customer hits them

## Hard rules - do not violate

**Renewals: call `POST /payment/renewal-quote` for the exact owned modem and term.**
Do not estimate from a country or carrier tariff. Explicit renewal exists on account-credit
and BTC lanes; provider auto-renew capability varies by proxy.

**Reconcile from the response, not from a second call.** `billing.subtotal_usd` is the price
before coupon, `billing.charged_usd` after, `billing.discount.amount_usd` the delta, and they
tie out to the cent. See docs/billing-and-reconciliation.md.

**Bind every charge to the price the buyer approved.** Send `max_total_usd` (the approved
total in USD) on every buy and renew. For a renewal it is the `total_usd` of
`/payment/renewal-quote`; for a buy it is the total you showed (tariff `price` x
`modemCount`, less any coupon). If the server's total is higher the API answers
`409 price_changed` with a fresh `quote` and charges nothing: show `quote.total_usd`, ask
again, and send the new approval with a new `Idempotency-Key`. Without `max_total_usd` a
price that changed between your quote and your charge is charged as is.

**Check `webhook.configured` on the first purchase.** If it is `false`, no event will ever
arrive and your fulfilment flow must poll instead of wait.

1. **Never put `CORONIUM_API_KEY` in client-side code.** All API calls must go through server routes (Next.js `app/api/...`, or Express/Fastify proxy). The dashboard is hosted by the reseller; their token must not leak to browsers.
2. **Use `metadata.customer_id` for customer mapping and a small durable local recovery index.** Metadata is returned in proxy lists and is copied onto every replacement. Keep old modem ID → customer ID until a swap is reconciled anyway: the old modem can be gone before your worker runs.
3. **Register the webhook URL via `PUT /api/v3/account/webhook` exactly once on first deploy.** Don't re-PUT every request. Store the registration in the reseller's own state (config file, env, KV) so you know when it's already configured.
4. **Authenticate via Bearer header** for any new code you write. `?auth_token=` query-param also works but logs to access.log everywhere; Bearer is the right pattern.
5. **Stock-out is normal.** `/api/v3` answers `409` with `code: "no_stock"` (and `reason_code: "OUT_OF_STOCK"`). A buy with `require: ["p0f"]` and no p0f unit answers `409 p0f_unavailable`. Surface both clearly; do not retry-loop. Read `p0f_count` (`/free-modems`) or `features.p0f.count` (`/tariffs/available`) to offer only regions and plans that can fill it.
6. **Idempotency** - `/payment/*` POSTs accept an `Idempotency-Key` header (`[A-Za-z0-9_-]{8,128}`, 24h window; a replay answers with `X-Idempotency-Replay: true`). Generate ONE UUID per buy *intent* - at the moment the human confirms - and resend that same key on every retry. A key derived from a timestamp changes between attempts and buys twice. A `409 duplicate_request` (`new_order_created: false`) is not a failure to retry with a new key: read `reason`. `idempotency_key_conflict` = this key was already used with a different body; `recent_identical_request` = the same request without a key succeeded in the last 180 s (`Retry-After`); `request_in_progress` = still running; `request_outcome_unknown` or `legacy_request_identity_unknown` = check `GET /account/payments` and `GET /account/proxies` first. Use a new key only for an order you really mean as a second one.
7. **Handle auto-swap only where supported.** Fields are under `data`. Verify HMAC, persist the event, ack within 5 seconds, then notify your customer. The replacement already carries your `metadata`; re-stamping is harmless. Some line types do not advertise replacement; check `proxyEndpoints.capabilities.replace`. Always read `data.new_modem_id`, which is always set, and refetch the line from `GET /account/proxies` before you hand out credentials. Some lines are moved instead of swapped. This can happen on an automatic replacement or on your own `POST /modems/:id/replace`. On a move, `new_modem_id` equals `old_modem_id` and the `/replace` answer has `moved: true`. The line keeps its id, login, password and expiry, and only the ports may change. Your own `/replace` that moves the line and keeps the same ports sends no `modem.replaced` event, so treat the synchronous `/replace` answer (`moved: true`) as the source of truth. The automatic swap (8 failed checks, an HTTPS webhook registered, more than 24 hours left) sends `modem.replaced` in the `_id`/`proxy_login`/`proxy_password`/`tariff_expired_at` shape, with `new_modem_id` equal to `old_modem_id` when it moved the line. When that move changed the ports it can send a second `modem.replaced` for the same line in the `id`/`login`/`password`/`expires_at` shape (the shape a replacement by support uses). Separately, some lines are moved automatically after about 30 minutes offline, with no webhook required and with as little as 1 hour of paid time left. Such a move keeps id, login, password and expiry. It sends `modem.replaced` only when the ports changed, and then only in the `id`/`login`/`password`/`expires_at` shape; a move that keeps the ports sends no event. Every move writes a `proxy.moved` row to `GET /account/history`, so without a webhook poll that (or `GET /account/proxies`) to catch port changes. Dedupe on `event_id`, treat a repeat `new_modem_id` as the same change, and refetch the line from `GET /account/proxies`. Do not rely on `new_modem.IMEI`/`portId`; ignore them.
8. **Rotation on a classic proxy is synchronous and reports failure with a 200.** `POST /modems/{id}/restart` holds the request open until the carrier answers, then returns `{result:'ok', rotated: <bool>, ip, message}`. **`rotated:false` at HTTP 200 means the IP did NOT change** - branch on `rotated`, never on the status code. Within 60 s of the previous rotation (started or finished, failed included) `/restart` answers `429` with `code` `rotation_too_soon` or `rotation_cooldown`, a `Retry-After` header and the same `retry_after_seconds`. A row with `proxyEndpoints` answers **202** with `pending: true`: poll `GET /modems/{id}/rotation-status` until `done` or `failed`; do not resubmit. Other rows with `proxyEndpoints` (one-time rentals that are not Coronium Node rows) can also refuse with `429` `rotation_too_soon` (`suggested_action` `wait_retry_after_seconds`, `Retry-After` header: wait, retry once), `409` `modem_expired` (`renew_first`), `409` `rotate_unavailable` with `suggested_action` `check_proxy_health` (the line is offline: do not loop) and `502` `rotation_unconfirmed` (the rotation was submitted: poll rotation-status, do not resend). A refused rotation on a Coronium Node row is HTTP `409` with `provider: "coronium_node"`, `retryable: false` and nothing queued. Read `code`: `modem_rotation_in_progress` (poll rotation-status), `rotate_unavailable` (`suggested_action` `retry_after_2_minutes` = wait 2 minutes and retry once; `check_capabilities` = rotation is not possible right now, for example the device is offline), or `rental_conflict` (refresh your proxy list). A `503` on a Coronium Node row (`error` "Rotation unavailable", `code` `modem_rotation_in_progress`) means rotation is unavailable right now: do not poll, try later. If `error` says the last rotation "has no confirmed outcome and is under review", every `/restart` gets the same 409 until support resolves it, whatever `suggested_action` says: stop retrying, show "rotation under review" and contact support with the `request_id`. The same case shows in `rotation-status` as `state: "failed"` with `reset_error: "device did not confirm the outcome"`; ignore its "retry after 2 minutes" hint then. An optional body `request_id` must be a UUIDv4 (otherwise `400 invalid_request`); reuse it on a network retry of the same click. There is no `?sync=true` query flag and no `503 rotation_timeout`; both were removed. The token-auth variant `GET /modems/rotate-modem-by-token/{token}` behaves differently. On a classic proxy: `200` only on a verified new IP (carries `ext_ip`/`new_ip`), `502` otherwise (branch on that HTTP status, not on a body error code), `429` inside the ~60 s per-modem cooldown. On a row with `proxyEndpoints` it does not block: it answers `202` with `pending: true` and a `status_url`. Follow `status_url` exactly as returned (or poll `GET /modems/get-rotating-modem-status-by-token/{token}`, no auth) and do not resend: every call is a new request. `status_url` may be on a neutral short-link host (for example `https://ipreset.xyz/s/<token>`) outside `/api/v3`: same `data` shape, but its errors carry only `error` with no envelope `code`, so branch on the HTTP status there, or poll the `/api/v3` route above with the same token to get envelope codes. That status route has its own shape, not the `state` of `/rotation-status`. On a Coronium Node row poll `data.rotation` until `pending` is false: `success: true` = done, `needs_review: true` = under review (stop and contact support), any other `result` = failed. On other rows with `proxyEndpoints` read `data.state` (`done` or `failed`). A classic row answers only `data.status`, `ext_ip` and `rotated_at`. Refusals differ by row. On a Coronium Node row a refusal is `409` and its `code` is guessed from the text: it usually reads `modem_rotation_in_progress` / `poll_rotation_status`, also when nothing is running and when the last rotation is under review, and an ended or foreign rental can come back as `internal_error`. There decide from `error`, never from `code` or `suggested_action`: busy (poll `status_url`), too soon (wait), "has no confirmed outcome and is under review" (stop and contact support), or an active rental required (reload the proxy list). On other rows with `proxyEndpoints` the codes are real: `429 rotation_too_soon` (wait `Retry-After`), `409 modem_expired` (renew first), `409 rotate_unavailable` (offline: do not loop), `409 modem_rotation_in_progress` (poll `status_url`) and `502 rotation_unconfirmed` (the rotation was submitted: poll `status_url`, do not resend). On any of these rows a `503` means rotation is unavailable right now: show it and try again later, do not poll.
9. **`rotation_interval` is in SECONDS.** `PUT /modems/{id}/set-rotation-interval` accepts `0` (disabled) or **≥ 60**. Anything from 1 to 59 is a 400 - a caller who thinks in minutes and sends `5` gets rejected, and one who sends `30` meaning "30 minutes" gets rejected too. Only offer it where `proxyEndpoints.capabilities.rotationInterval` is true, or the row has no `proxyEndpoints`. Other rows answer `409 action_unsupported` (`suggested_action: check_capabilities`, nothing changed); rotate those on demand with `POST /restart`. On rows with `proxyEndpoints` that allow it, the value must be whole minutes: a multiple of 60 from 60 to 2592000, so `90` is a 400 there. Those rows can also answer `409` (the device is offline) or `502` (the change is not confirmed): refresh the line before retrying. Their `200` answer is `{result, applied: true, data: {_id, rotation_interval}}`, without `name`.
10. **`metadata` is a JSON string, and every replacement keeps it.** Send it pre-stringified on buy. After a `modem.replaced` event, re-stamping the new modem with `PUT /modems/{new_modem_id}/set-metadata` is a harmless safety net (lines replaced before October 2026 may have lost it).
11. **No stock header is required.** Without a header you get units with one login on both ports. `X-Coronium-Proxy-Credentials: separate-protocol-v1` (optional) also offers units with separate HTTP/SOCKS5 logins; then use `proxyEndpoints.http` and `.socks5` independently. Use the same contract and rental period throughout discovery and checkout. See `docs/stock-and-credentials.md`.
12. **Never branch on `proxyEndpoints.provider`.** It is an opaque label and new values appear without notice. The one documented value is `coronium_node` (Coronium Node rows, also a top-level `provider`). Use `proxyEndpoints.capabilities` to decide which actions to show, and do not display the provider label to end-customers.
13. **Coupons work on both balance lanes.** Pass `coupon: {coupon_name}` on quote, purchase and renewal; confirm from `billing.discount` that it applied. Never compute a discounted price yourself.
14. **Secrets stay out of logs and the client.** That includes the API key, the webhook signing secret, proxy passwords and raw webhook payloads.
15. **Keep the dashboard private.** The operator sample requires Basic auth and persistent SQLite. It is not a public end-customer login or a serverless one-command deploy.
16. **OpenVPN pending is not broken.** `GET /modems/{id}/openvpn` on a line set up in the last 2 hours can answer `503 openvpn_profile_pending` with `Retry-After` (120 s). Retry the same line after that wait; never replace it (a new line starts a new wait). `409 openvpn_not_supported` and `400 openvpn_disabled` are final; check `features.openvpn.available` before offering a download.
17. **Only send `require` values that exist.** Today that is `["p0f"]`. Anything else is `400 unknown_requirement` with `supported: ["p0f"]`.
18. **Replacing a p0f line keeps p0f.** No p0f line available: `409 p0f_replacement_unavailable`, nothing changed. Ask the buyer before resending with `{"allow_without_p0f": true}`. An automatic swap in that case sends `modem.dead` with `reason: "no_p0f_stock"`.
19. **Take OS values from the line.** `features.p0f.supported_values` (or `GET /modems/{id}/p0f-options`) and `vocabulary` (`os_profile` or `tcp_stack`) say what a line accepts; `unavailable_reason` (`mobile_network` or `line`) says why it has none. There is no `features.p0f.provider` any more.

## Architecture you should produce

This is the layout of `examples/nextjs-dashboard`; start from it.

```
reseller-dashboard/
  app/                       (Next.js App Router - recommended; SvelteKit/Remix are also fine)
    page.tsx                 # Overview: customers, proxies, health, recent webhook events
    buy/                     # Buy form: tariff, count, end-customer
    customers/[id]/          # End-customer detail: their proxies, credentials, renew
    events/                  # Webhook inbox and processing state
    api/
      coronium/
        buy/route.ts         # One server-side route per action
        renew/route.ts
        proxies/route.ts
        health/route.ts
        tariffs/route.ts
        reconcile/route.ts
        webhook/route.ts     # POST handler for modem.replaced + modem.dead events
  lib/
    coronium.ts              # Typed client wrapper around Coronium REST
    customers.ts             # Local model of end-customers (KV / SQLite / JSON file)
    webhook-processing.ts    # Durable inbox: verify, persist, process
  proxy.ts                   # Basic auth in front of the whole operator dashboard
  scripts/reconcile-webhooks.mjs
  README.md
  .env.example               # CORONIUM_API_KEY, read server-side only
```

One route per action, no catch-all proxy to the Coronium API: a pass-through would expose every write route (buy, replace, cancel) behind one URL.

## State storage

For v1, the reseller's end-customer list is small (10-1000 customers). Don't force Postgres. Use one of:

- **SQLite** (`better-sqlite3`) - single file, zero ops, instantly backupable
- **Vercel KV / Upstash** - if deploying serverless
- **JSON file** - for prototypes

Schema for a customer:

```ts
type Customer = {
  id: string;            // reseller-chosen, e.g. "acme-007"
  name: string;
  email?: string;
  created_at: number;
  markup_pct?: number;   // optional - for display only, doesn't affect Coronium pricing
  notes?: string;
};
```

The proxies themselves stay in Coronium. The reseller's DB holds end-customer profiles, a small mapping index for swaps, and a durable signed-event inbox.

## Webhook contract (the most important section)

Every event shares ONE envelope. The event-specific fields are nested under `data` - this is the single most common integration bug, because `body.old_modem_id` silently reads `undefined`.

```json
{
  "event_id": "3f1a…-uuid",
  "event": "modem.replaced",
  "occurred_at": "2026-07-25T08:34:53.000Z",
  "account": { "user_id": "6600aa…", "email": "reseller@example.com" },
  "data": { }
}
```

When a line you own fails 8 consecutive 30-minute health checks (about 4 hours) and still has more than 24 hours of paid time left, and your account has an HTTPS `webhook_url` registered (registering one is your consent to auto-replacement), Coronium tries to replace it and POSTs `modem.replaced` (success) or `modem.dead` (no replacement available). A line the provider still reports online is not treated as dead. After an event is sent for a line, that line gets no new attempt for 72 hours. Without a webhook you get an email instead. Separately, some lines are moved automatically after about 30 minutes offline, with no webhook and as little as 1 hour left; that move keeps the credentials and sends `modem.replaced` only when the ports changed (see rule 7). A successful swap sends:

```json
"data": {
  "old_modem_id": "69b5926c942c49e02b9f50c7",
  "new_modem_id": "6a1cf4d2942c49e02b1234ab",
  "new_modem": {
    "_id": "6a1cf4d2942c49e02b1234ab",
    "name": "cor_US_NJ_x83",
    "IMEI": "6a1cf4d2942c49e02b1234ab",
    "portId": "6a1cf4d2942c49e02b1234ab",
    "country_code": "US",
    "carrier_id": "...",
    "host": "172.56.171.4",
    "http_port": "8042",
    "socks_port": "5042",
    "proxy_login": "admin",
    "proxy_password": "EXAMPLE_PASSWORD",
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
  "reason": "no_stock" | "no_p0f_stock" | "pipeline_failed" | "provider_unsupported" | "shared_modem" | "tariff_orphan" | "no_owner" | "modem_not_found" | "config_error" | "move_<code>" | "unknown",
  "remediation": "POST /api/v3/modems/{old_modem_id}/replace to retry, or contact support"
}
```

`IMEI` and `portId` are deprecated and removed on 2026-11-19. On the automatic swap they carry the `_id`; elsewhere they are not ids you can use. Do not rely on them. Treat unknown `reason` values as "not replaced". A replaced p0f line adds `data.p0f` (`{required, kept, os, os_applied, pending?, note?}`).

`data.old_modem_id` and `data.new_modem_id` are always set; `new_modem` comes in two shapes. A classic `/replace` and the automatic swap send the shape above (`_id`, `proxy_login`, `proxy_password`, `tariff_expired_at`), also when the automatic swap moved the line. A replacement by support and the move notice sent when a moved line's ports changed send `{id, name, host, login, password, http_port, socks_port, http_url, socks_url, expires_at}` (support adds `rotation_link`, and `socks_host`/`socks_login`/`socks_password` when SOCKS5 uses different details), plus `data.old_modem_name` and `data.reason`. Some lines are moved instead of swapped, on an automatic replacement or on your own `POST /modems/:id/replace`: `new_modem_id` equals `old_modem_id`, the line keeps its id, login, password and expiry, and only the ports may change. Your own `/replace` that moves the line and keeps the same ports sends no `modem.replaced` event, so its synchronous answer (`moved: true`) is the source of truth. The automatic swap sends `modem.replaced` (with `new_modem_id` equal to `old_modem_id` when it moved the line), and can send it twice, once in each shape, when the ports changed. Some lines are also moved automatically after about 30 minutes offline, with no webhook required; that move sends `modem.replaced` only when the ports changed, in the `id`/`login` shape only, and writes a `proxy.moved` row to `GET /account/history` either way. Dedupe on `event_id` and on a repeat `new_modem_id`. Key on `data.new_modem_id` and refetch the line from `GET /account/proxies` before you hand out credentials.

You also receive `proxy.purchased`, `proxy.purchase_failed`, `proxy.renewed` and `proxy.expired`, plus `proxy.added`, `proxy.removed` and `proxy.updated` if you opt in with `PUT /account/webhook {"history_events": true}`. Ignore `proxy.expiring_soon` - the `PUT /account/webhook` response lists it, but nothing emits it.

**Handler must:**

1. Verify `X-Coronium-Signature` (`sha256=<hmac-sha256 of the RAW body>`) against the account's signing secret, over the raw bytes - not the re-serialized JSON
2. Persist the event keyed by `event_id`, then acknowledge within the 5s timeout. Return non-2xx if storage fails.
3. Process from the durable inbox: update mapping `data.old_modem_id → data.new_modem_id`, **re-stamp metadata on the new modem**, notify your end-customer with the current connection details (refetched)
4. Be idempotent, keyed on `event_id` - a non-2xx is retried up to 8 times with backoff, and Coronium can replay dead-lettered events

## Hard-coded values worth knowing

- API base: `https://api.coronium.io/api/v3`
- API docs: `https://api.coronium.io/api-docs/` (public, no login required; also at `https://dashboard.coronium.io/api-docs/`)
- API key lifetime: 365 days for the Dashboard -> Account -> API Access key (tokens from `POST /get-token` use a shorter, server-configured expiry). Get a new key by regenerating it in Dashboard -> Account -> API Access; this revokes the old one. Wallet-bound accounts can also use `POST /api/v3/wallet-key/rotate-challenge` + `/wallet-key/rotate`
- Webhook delivery: 5s timeout, up to 8 attempts with escalating backoff, then dead-letter; HMAC-signed via `X-Coronium-Signature` + `X-Coronium-Event-Id`; redirects not followed
- Detection cadence: every 30 min; auto-replacement after 8 consecutive failures (about 4 h, needs an HTTPS webhook and more than 24 h paid time left, one attempt per line per 72 h). A line the provider still reports online is not treated as dead. Some lines are also moved after about 30 min offline, with no webhook needed; those keep their credentials and appear as `proxy.moved` in `GET /account/history`. `/account/proxies/health` reports `dead` from 3 consecutive failures
- Refresh cadence for `/account/proxies/health`: most lines refresh every 30 min server-side (Coronium Node lines reflect the device connection). It is not real-time: poll it at most every 60 s and cache it client-side for 60 s
- `GET /tariffs/available` needs no auth - handy as a connectivity check
- Error envelope on 4xx/5xx: `{error, code, reason_code?, suggested_action, retryable, request_id, documentation_url?}` + `X-Request-Id` header. No `message` field
- Currency: USD. Every API money field is dollars (`*_usd`, `amountUsd`); the only cents field is `total_cents` on renewal-quote and `price_changed` quotes

## When user asks for features beyond the minimum

Common requests and the right answer:

- **"Add Telegram bot"** - separate service, share the same `lib/coronium.ts` client. There is no Telegram example; use the Telegram-bot prompt in `PROMPT.md`, which reuses `examples/nextjs-dashboard/lib/coronium.ts` server-side.
- **"Add per-customer billing"** - calculate `customer.markup_pct × modem.price` in your dashboard. Charge them via your own payment processor (Stripe/PayPal). Coronium doesn't bill end-customers; you do.
- **"Show usage stats per customer"** - `GET /modems/{id}/usage` exists only where `proxyEndpoints.capabilities.usage` is true. It is false on every line today, so do not build a usage view on it; show usage only when that flag is true. Lines without it answer 404 `not_found` there and have no per-line bandwidth figure. For metered bandwidth, use Coronium's pool routes in the API reference (`GET /pool/stock`, `POST /payment/buy-pool-with-account-credit`, `GET /account/pool-keys`) - a separate product from dedicated lines.
- **"Add OAuth login for end-customers"** - out of scope for v1; the reseller owns auth on their side.
- **"Wallet integration"** - if the reseller wants end-customers to pay in crypto, take payment in the reseller's own wallet. The reseller funds Coronium themselves (account credit via the dashboard, or BTC to the deposit address from `GET /account/crypto-balance`). There is no top-up API, and USDT held at Coronium is not spent by the v3 purchase routes. Never automate on-chain sends.

## Failure modes to handle gracefully

| Symptom | What it means | What to do |
|---|---|---|
| `401` with `code` `auth_required` | API key invalid or expired | Regenerate it in Dashboard -> Account -> API Access and update `CORONIUM_API_KEY` in the server environment. Only this code means a key problem |
| `401 "Insufficient crypto balance"` on a BTC-lane buy or renew (`/payment/buy-modems-with-crypto-balance`, `/payment/renew-modems-with-crypto-balance`; `code` `internal_error`, `required` and `available` in BTC) | The BTC balance is below the total; the key is fine; nothing charged | Fund the BTC balance or use the account-credit lane. Never regenerate the key for this: that revokes the one that works. A `401 "Bad parameters"` on the same routes means `tariff_id` or the basket is missing |
| `409 no_stock` on buy | No eligible proxy for that tariff now | Ask buyer to choose another product; don't retry-loop |
| `409 price_changed` on buy or renew | The server total is above the `max_total_usd` you sent; nothing charged | Show `quote.total_usd`, get a new approval, send it as `max_total_usd` with a new `Idempotency-Key` |
| `400 insufficient_balance` (`reason_code` `INSUFFICIENT_CREDIT`) | Account credit is below the total; `available_usd` and `required_usd` say by how much; nothing charged | Tell the operator to add funds in the dashboard; never top up automatically |
| `409 duplicate_request` (`new_order_created: false`) | Read `reason`: `idempotency_key_conflict`, `recent_identical_request`, `request_in_progress`, `request_outcome_unknown` or `legacy_request_identity_unknown`; this request created no order | Do not switch to a new key to get past it. Check `GET /account/payments` and `GET /account/proxies`; wait `Retry-After` where given |
| `409 renewal_already_pending` (`RENEWAL_ALREADY_PENDING`) on an account-credit renewal | A renewal for this line was already paid and is still being applied (`payment_id`); nothing charged | Do not retry. Follow `GET /payments/{payment_id}/status`; contact support if the line is not extended within 30 minutes |
| `429 renewal_burst` (`RENEWAL_BURST`) on an account-credit renewal | The line was renewed 3 times in 10 minutes; nothing charged | Wait 10 minutes (`retry_after_seconds`), or renew once for a longer term |
| `429 payment_in_progress` on buy or renew | Another payment on this account is still running; nothing charged | Wait `Retry-After` (5 s) and resend with the SAME `Idempotency-Key` and body |
| `202` with `paymentId` and `charged_usd`, or `503 payment_delivery_unconfirmed` with `paymentId` on buy or renew | The balance WAS debited; delivery is still running or not yet verified | Follow `GET /payments/{paymentId}/status`. Never re-order with a new `Idempotency-Key` |
| `503 no_stock` (`reason_code` `OUT_OF_STOCK`) or `503 upstream_degraded` with `refunded: true` and `paymentId` on buy | The charge was returned to the account balance at once; net nothing charged | A new order is safe (later, or another product); do not loop |
| `409 node_renewal_reconciling` on a renewal or renewal-quote | An ended Coronium Node rental is still being reconciled; nothing charged | Refresh the proxy list (`GET /account/proxies`); do not repeat the renewal |
| `409 p0f_unavailable` on buy with `require: ["p0f"]` | No p0f unit in that plan or region now | Pick one with `p0f_count` / `features.p0f.count` above 0; nothing was charged |
| `400 unknown_requirement` | `require` holds something other than `"p0f"` | Send `["p0f"]` or leave it out |
| `503 openvpn_profile_pending` | New line's OpenVPN profile still being issued | Wait `Retry-After`, retry the same line; never replace |
| `409 openvpn_not_supported` / `400 openvpn_disabled` | Line has no OpenVPN | Do not retry; hide the download for that line |
| `409 vpn_revoke_required` on openvpn (row with `proxyEndpoints`) | Download-once profile already downloaded, or the password changed | `POST /modems/{id}/openvpn/revoke`, repeat it while it answers `409 vpn_revoke_pending`, then download again |
| `400 invalid_request` (`reason_code: "BAD_MODEM_COUNT"`) | You sent `modem_count`/`count`, or a non-positive number | The field is `modemCount` |
| `400` on set-rotation-interval | Value between 1 and 59, or on a row with `proxyEndpoints` a value that is not a multiple of 60 | The unit is SECONDS; minimum 60, or 0 to disable. On rows with `proxyEndpoints` send whole minutes (60, 120, ... up to 2592000) |
| `409` (not `action_unsupported`) or `502` on set-rotation-interval | Row with `proxyEndpoints`: the device is offline (409) or the change is not confirmed (502) | Refresh the line from `/account/proxies` before retrying; do not loop |
| `409 action_unsupported` on set-rotation-interval | This line has no timer rotation (`capabilities.rotationInterval` false) | Nothing changed. Hide the timer control; rotate on demand with `/restart` |
| `200` with `rotated: false` | Rotation ran but the IP did not change | Wait at least 60 s (honour `Retry-After` if a retry returns 429), then retry; if it persists, `/replace` the modem |
| `429` `rotation_too_soon` / `rotation_cooldown` on `/restart` | Less than 60 s since the last rotation started or finished (a failed one counts) | Wait `Retry-After` seconds (same value as `retry_after_seconds`), then retry once; do not loop |
| `202` with `pending: true` on restart | Row with `proxyEndpoints`: rotation recorded, not done | Poll `rotation-status` until `done` or `failed`; never resubmit or replace for this |
| `409 modem_rotation_in_progress` on restart | Row with `proxyEndpoints`: a rotation is still running; nothing queued | Poll `rotation-status`; do not resubmit |
| `409 rotate_unavailable` + `retry_after_2_minutes` on restart | The last rotation request was under 2 minutes ago; nothing queued | Wait 2 minutes, then retry once |
| `409 rotate_unavailable` + `check_capabilities` on restart | Rotation is not possible right now: the device is offline, or `error` says the last rotation "has no confirmed outcome and is under review" | Show `error`; do not retry automatically. "Under review" stays refused until support resolves it: contact support with the `request_id` |
| `409 rental_conflict` on restart | The rental is no longer active on this account | Reload the proxy list |
| `503` on restart (Coronium Node row, `code` `modem_rotation_in_progress`) | Rotation is unavailable right now; nothing queued | Do not poll `rotation-status`. Show it and try later |
| `429 rotation_too_soon` + `wait_retry_after_seconds` on restart (row with `proxyEndpoints`, not Coronium Node) | Inside the line's minimum rotation interval; nothing queued | Wait `Retry-After` seconds, then retry once |
| `409 modem_expired` (`renew_first`) on restart | The line's paid time ended | Renew it; do not retry the rotation |
| `409 rotate_unavailable` + `check_proxy_health` on restart | The line is offline; nothing queued | Show the line as offline; do not loop. Check `/account/proxies/health` later |
| `502 rotation_unconfirmed` on restart | The rotation was submitted but its outcome is not confirmed yet | Poll `rotation-status`; do not resend |
| `rotation-status` `failed` with `reset_error: "device did not confirm the outcome"` | The last rotation is under review; `/restart` answers 409 until support resolves it | Ignore the "retry after 2 minutes" hint; show "rotation under review" and contact support. Do not replace |
| `202` / `409` / `503` on rotate-by-token (Coronium Node row) | 202 = queued (`pending: true`, `status_url`), 409 = refused, 503 = unavailable now. Refusals usually carry `code` `modem_rotation_in_progress` / `poll_rotation_status` whatever the reason; an ended rental can read `internal_error` | After a 202 poll `status_url` until `data.rotation.pending` is false, never resend. On 409 or 503 ignore `code` and `suggested_action`, read `error`: busy, too soon, "under review" (stop, contact support) or rental required (reload the proxy list). Do not loop |
| `202` / `429` / `409` / `502` on rotate-by-token (other row with `proxyEndpoints`) | 202 = queued (`status_url`). Refusals carry real codes: `429 rotation_too_soon`, `409 modem_expired` / `rotate_unavailable` / `modem_rotation_in_progress`, `502 rotation_unconfirmed` (submitted, outcome not confirmed yet) | 429: wait `Retry-After`. 409: renew, show the line offline, or poll `status_url`. 202 and 502: poll `status_url` until `data.state` is `done` or `failed`; never resend |
| `409 p0f_replacement_unavailable` on replace | p0f line, no p0f replacement now | Nothing changed. Retry later, or with the buyer's consent resend `{"allow_without_p0f": true}` |
| `400 "No free modems!"` on replace | No replacement unit in that country right now (the envelope `code` is `internal_error`, not `no_stock`) | Nothing changed; the old proxy still works. Retry later, don't loop |
| `400 "Your replacements count ran out for today!"` on replace | Daily self-replace allowance used | Nothing changed. Retry tomorrow or contact support |
| `500 "Replacement failed ... Your current proxy is unchanged."` on replace | No line could be assigned in time; the order was closed | Nothing changed and nothing will arrive later. Keep the old mapping and retry replace later; do not loop |
| `409 request_in_progress` on replace | Another replace or action on the same line is still running | Check the line before retrying; don't resend in parallel |
| `409 action_unsupported`, or `409` with `code: "internal_error"` and an `error` that says to contact support, on replace | This line cannot be replaced through the API | Nothing changed, no replacement used. Do not retry; open a support ticket |
| `409` "This proxy is being moved right now. Try again in a few minutes." on replace | A move of this line is running; nothing changed | Refetch the line after a few minutes; do not resend in parallel |
| `500` "The replacement needs a check by support" on replace | Nothing charged; the move needs a manual check | Do not retry; open a ticket with the `request_id` |
| `200` with `moved: true` on replace | The line was moved: same id, login, password and expiry; ports may change | Refetch the line from `/account/proxies`; there may be no `modem.replaced` event |
| `400 p0f_unsupported_on_server` on set-os | This line has no OS control | Hide the OS control; read `features.p0f.unavailable_reason` |
| `202` with `data.pending: true` on set-os | Sent to the line, not yet confirmed | Do not resend (that answers `409 p0f_change_in_progress`); read `p0f_os` later |
| `409 p0f_proxy_offline` on set-os | The line is not connected | Nothing changed; retry later |
| `502 p0f_not_applied` on set-os | Nothing changed | Retry in a minute |
| `404 p0f_unavailable` on set-os | OS changes are not available on this line right now | Nothing changed; contact support |
| `429` on rotate-by-token | Classic line inside the ~60 s per-modem cooldown | Back off; don't hammer |
| Webhook fields all `undefined` | You're reading the top level | They're under `data` - `body.data.old_modem_id` |
| Webhook never fires after a modem dies | No webhook URL set, or your endpoint is failing | Run `POST /account/webhook/test` - it returns your endpoint's actual response |
| `modem.dead` with `reason: "no_stock"` | We tried to swap, couldn't find replacement geo | Notify your customer, retry-`replace` manually later |
| `modem.dead` with `reason: "no_p0f_stock"` | p0f line, no p0f replacement | Ask the buyer; `replace` later, or with `allow_without_p0f: true` |
| Swapped proxy shows as unassigned | A line replaced before October 2026 lost its metadata | Re-stamp via `PUT /modems/{id}/set-metadata` in your webhook handler |

## When you're done

Show the user:

1. **Local URL** to open in their browser
2. **Deploy command** for a persistent host. If using serverless, first replace the local SQLite store with a durable shared database.
3. **Webhook registration command** - the one-liner curl or fetch to PUT their dashboard URL into Coronium
4. **An authorized test purchase** - with the account owner's permission and funding, show credentials in the UI and prove the proxy connects. Never silently spend their balance.

Don't claim "done" until the test purchase succeeded and the proxy is visible in the reseller's UI.
