# Changelog

Each entry names the Coronium API version (OpenAPI at <https://api.coronium.io/api-docs/>)
the kit was checked against. "Breaking" means an answer you may already handle changed;
"Additive" needs no client change.

## 2026.10.29 - raw OpenAPI spec, funding and coupons explained

Docs only. No example code changed, and the API answers you already handle are the same.

- The spec is now served raw at <https://api.coronium.io/openapi.json> (and `/openapi.yaml`),
  version 3.3.6. 3.3.6 is a docs release: every operation has an `operationId`, and the
  payment error codes the routes already return are now written down. PROMPT.md, AGENTS.md
  and llms.txt point at the raw spec; the Swagger UI at `/api-docs/` is unchanged.
- PROMPT.md and llms.txt now say how funding works today. The API spends a balance you
  already hold and cannot add money: account credit is topped up by a person in the
  dashboard, BTC is sent by hand to the deposit address from `GET /account/crypto-balance`.
  USDT held at Coronium is not spent by the API purchase routes. Keep "do not automate
  funding" in your prompts.
- llms.txt explains coupons on API purchases: the `coupon: {coupon_name}` body field,
  checking a code first with `POST /coupons/check`, and why the discounted total belongs in
  `max_total_usd` (a code that no longer applies is priced at list price instead of failing).

## 2026.10.27 - synced with OpenAPI 3.3.5, checked against the live API

- Examples: next 16.3.6 -> 16.4.3 (security advisory), npm audit fix in nextjs-dashboard and webhook-receiver; both report 0 vulnerabilities.

Kit version 2026.10.27. Example packages `0.2.1`. The OpenAPI version is unchanged (3.3.5).
Most entries below correct the kit where it described live behaviour wrongly or not at all.

### API behaviour since the last kit sync

Breaking (an answer you may already handle differs from what the kit said):

- **Moved lines and the `modem.replaced` shape.** Some lines are moved instead of swapped,
  on an automatic replacement or on your own `POST /modems/{id}/replace`. The `/replace`
  answer then has `moved: true` and `newModemId` equal to `oldModemId`; the line keeps its
  id, login, password and expiry, and only the ports may change. Your own `/replace` that
  moves the line and keeps the same ports sends **no** `modem.replaced` event; its
  synchronous answer is the source of truth. The automatic swap sends `modem.replaced`
  (with `new_modem_id` equal to `old_modem_id` when it moved the line) in the
  `{_id, proxy_login, proxy_password, tariff_expired_at}` shape, and when the ports changed
  a second one for the same line in the `{id, login, password, expires_at, http_url,
  socks_url, ...}` shape that a replacement by support also uses. Dedupe.
- **Lines can be moved automatically without a webhook.** Separately from the swap, some
  lines are moved after about 30 minutes offline, with as little as 1 hour of paid time
  left and no webhook or failure count needed. The line keeps its id, login, password and
  expiry. `modem.replaced` is sent only when the ports changed, and only in the
  `{id, login, password, expires_at, http_url, socks_url}` shape; a move that keeps the
  ports sends nothing. Every move writes a `proxy.moved` row to `GET /account/history`:
  without a webhook, poll it (or `GET /account/proxies`) to catch port changes. For every
  replacement event, key on `data.new_modem_id` (always set) and refetch the line from
  `GET /account/proxies`. `modem.replaced` is sent for every replacement that changes the
  connection details, not for every replacement. Do not rely on `IMEI`/`portId`: on a
  moved line's answer they are not the `_id`.
- **Automatic replacement threshold is 8 failures, not 5.** A line is replaced after 8
  consecutive failed 30-minute health checks (about 4 hours), with more than 24 hours of
  paid time left, only when the account has an HTTPS webhook registered, and at most once
  per line per 72 hours. A line the provider still reports online is skipped. These rules
  apply to the swap only, not to the offline move above.
  `/account/proxies/health` reports `dead` from 3 failures.
- **Bad `modemCount`** answers `400` with `code: "invalid_request"` and
  `reason_code: "BAD_MODEM_COUNT"` on `/api/v3` (the failure table said `400 BAD_MODEM_COUNT`).
- **Rotation refusals.** A classic `POST /modems/{id}/restart` within 60 s of the previous
  rotation (started or finished, failed included) answers `429` `rotation_too_soon` or
  `rotation_cooldown` with `Retry-After`; the old advice "retry after a few seconds" after
  `rotated: false` always hit it. A Coronium Node row refuses with `409` and nothing
  queued: `modem_rotation_in_progress`, `rotate_unavailable` (`retry_after_2_minutes` or
  `check_capabilities`) or `rental_conflict`. A `503` on a Coronium Node row ("Rotation
  unavailable", `code` `modem_rotation_in_progress`) means rotation is unavailable right
  now: do not poll, try later. Other rows with `proxyEndpoints` can also
  answer `429 rotation_too_soon` with `Retry-After`, `409 modem_expired` (`renew_first`),
  `409 rotate_unavailable` with `check_proxy_health` (offline) and `502 rotation_unconfirmed`
  (the rotation was submitted: poll `rotation-status`, do not resend).
- **Rotation under review.** On a Coronium Node line whose last rotation was never confirmed
  by the device, every later `/restart` answers `409` ("The last rotation has no confirmed
  outcome and is under review") until support resolves it. `rotation-status` shows
  `state: "failed"` with `reset_error: "device did not confirm the outcome"`; its "retry
  after 2 minutes" hint does not apply. Stop retrying and contact support.
- **Token rotation on rows with `proxyEndpoints`** answers `202` with `pending: true` and a
  `status_url` (follow it as returned). On a Coronium Node row a refusal is `409` and `503`
  means rotation is unavailable; both usually carry `code` `modem_rotation_in_progress` /
  `poll_rotation_status` whatever the reason (an ended rental can read `internal_error`), so
  decide from `error` there (busy, too soon, under review: stop, or rental required: reload
  the proxy list). Other rows with `proxyEndpoints` refuse with real codes:
  `429 rotation_too_soon` (wait `Retry-After`), `409 modem_expired` / `rotate_unavailable` /
  `modem_rotation_in_progress`, and `502 rotation_unconfirmed`. 200 and the 502 "did not
  change the IP" apply to classic lines only; on non-Node rows with `proxyEndpoints` a 502
  is `rotation_unconfirmed` (submitted: poll `status_url`, do not resend).
- **The token status route has its own shape**, not the `state` of `rotation-status`. On a
  Coronium Node row poll `data.rotation` until `pending` is false: `success: true` = done,
  `needs_review: true` = under review (stop, contact support), any other `result` = failed.
  Other rows with `proxyEndpoints` carry `data.state` (`done` or `failed`); classic rows
  carry only `data.status`, `ext_ip` and `rotated_at`.
- **`set-rotation-interval` on rows with `proxyEndpoints`** takes whole minutes only (a
  multiple of 60 up to 2592000; `90` is a 400), answers `409` when the device is offline and
  `502` when the change is not confirmed, and its `200` has `applied: true` and no
  `data.name`.
- **`set-os` answers `200` with `data.noop: true`** (no `applied`) when the line already had
  that value. Treat it as success. No `set-os` answer carries `os`; read `p0f_os`.
- **`set-os` can answer `202`** with `data.pending: true` on lines that apply the OS
  asynchronously. Do not resend (`409 p0f_change_in_progress`); read `p0f_os` later. Those
  lines also use `400 p0f_os_not_supported_on_server`, `429 p0f_rate_limited`,
  `409 p0f_proxy_offline`, `409 rental_conflict` and `400 invalid_request`.
- **`POST /modems/{id}/replace` failures**: no replacement in stock is
  `400 "No free modems!"` (envelope `code` `internal_error`, not `no_stock`), the daily
  limit is `400`, a concurrent call is `409 request_in_progress`, and a line that cannot be
  replaced through the API is `409` (`action_unsupported`, or `internal_error` with a
  "contact support" error). A move already running answers `409` "This proxy is being moved
  right now" (refetch in a few minutes); `500` "The replacement needs a check by support"
  means nothing was charged: do not retry, open a ticket.

Additive (no client change required):

- Payment refusals the kit never named (live before this sync): `409 price_changed` when the
  server total is above the `max_total_usd` you sent (nothing charged, fresh `quote`
  returned), `400 insufficient_balance`, `409 duplicate_request` with `reason`
  (`idempotency_key_conflict`, `recent_identical_request`, `request_in_progress`,
  `request_outcome_unknown`), and on account-credit renewals `409 renewal_already_pending`
  and `429 renewal_burst`.
- `500 "Replacement failed: no available modems could be assigned. Your current proxy is
  unchanged."` on replace is final (live 24 Oct). The old line stays yours with its term
  unchanged and no second line appears later from that request. Keep your mapping and retry
  later; do not loop.
- `set-rotation-interval` on a row whose `capabilities.rotationInterval` is not true answers
  `409 action_unsupported` (nothing changed). It was only listed in the stock doc.
- Rows with `proxyEndpoints` can have OS control: `capabilities.p0f` decides (the line-type
  table said "never").
- Now documented in the kit: `GET /modems/get-rotating-modem-status-by-token/{token}`,
  `GET /account/history`, `GET /account/payments`, `GET /account/subscriptions`,
  `GET /payments/{payment_id}/status`, and `GET /modems/{id}/usage` for per-line usage
  where `capabilities.usage` is true (false on every line today, so do not build on it). A
  plan whose name ends in ` - 20 GB/month only` includes 20 GB of mobile data per month.

### Kit changes

Fixes:

- Dashboard `proxy.ts`: a write (add or delete customer, buy, renew) was refused with
  `403 Invalid origin` behind a reverse proxy, or when opened on `127.0.0.1`, because the
  check compared `Origin` with the listen address only. It now also accepts the origin from
  `X-Forwarded-Proto`/`X-Forwarded-Host` (or `Host`) and from `RESELLER_PUBLIC_URL`, and
  still refuses any other site. Set `RESELLER_PUBLIC_URL` to the URL the browser opens.
- AGENTS.md and llms.txt: payment refusals now include `429 payment_in_progress` (another
  payment on the account is running, nothing charged: wait 5 s, resend with the same
  `Idempotency-Key`), `202` or `503 payment_delivery_unconfirmed` with `paymentId` (charged:
  follow `/payments/{paymentId}/status`, never re-order with a new key), `503 no_stock` /
  `upstream_degraded` with `refunded: true` (nothing net charged, a new order is safe) and
  `409 node_renewal_reconciling` (refresh the proxy list, do not repeat the renewal).
- `status_url` from the token rotation can be on a neutral short-link host (for example
  `https://ipreset.xyz/s/<token>`). Same `data` shape, but its errors carry only `error`, so
  branch on the HTTP status there. Documented in AGENTS.md, llms.txt and
  `docs/stock-and-credentials.md`.
- `docs/billing-and-reconciliation.md`: the `line_items` example now shows what the API
  sends: `plan` is the term period (`day`, `week` or `month`), `pricing_basis` is
  `plan_fixed` or `legacy_per_day` (a purchase is always `plan_fixed`), plus `kind`, `name`,
  `tariff_id`, `country_id` and `carrier_id`.
- AGENTS.md currency line: every API money field is dollars (`*_usd`, `amountUsd`); the only
  cents field is `total_cents` on renewal-quote and `price_changed` quotes. It used to say
  card payments were in cents.
- `npm run worker` loads `.env` itself (Node 20.12 or later). Before, the worker exited at
  once when the credentials were only in `.env`.
- `lib/customers.ts` opens SQLite on first use with a 10 s busy timeout, so parallel
  `next build` workers no longer fail with `database is locked` on a fresh `data/`.
- Dashboard labels say "proxies", not "proxyies".
- The buy and renew forms read `refunded: true` (a `503` `OUT_OF_STOCK` or
  `UPSTREAM_DEGRADED` refunded at once, which also carries `paymentId`) as "not charged,
  refunded to balance" and clear the pending order, instead of "charged". A `202` with a
  payment id shows as "charged, provisioning", not in the error line.
- The dashboard serves `/account/proxies/health` from a 60 s in-process cache shared by the
  home and customer pages, as the polling rule asks.
- `examples/verify-integration.mjs`: reads `CORONIUM_API_KEY` from
  `examples/nextjs-dashboard/.env` or `./.env` (Node 20.12+; exported variables win); no
  registered webhook is a warning before deploy (`--require-webhook` makes it a failure);
  `--webhook-test` passes only when the body says `delivered: true` (the route answers 200
  either way); the p0f buy example prints a complete body with `tariff_id`, `modemCount`,
  `region_id`, `require` and `max_total_usd`; the "fresh key" hint shows only on
  `auth_required`.
- Buy examples in the quickstart, README, `docs/metadata-strategy.md` and
  `docs/p0f-and-openvpn.md` send `max_total_usd`, as the hard rule asks.
- `docs/billing-and-reconciliation.md`: a webhook receipt `status` is `queued`,
  `not_configured` or `error` (`disabled` is never sent).
- llms.txt: the local recovery record is `modem_id → customer_id` (the old modem id is what
  you look up).
- `/customers` no longer answers 500 once a customer exists. The Delete button is a client
  component that sends a real `DELETE /api/customers?id=...` (an HTML form cannot), asks for
  confirmation, shows the `409` "has assigned proxies" error and refreshes the list.
- `npm run lint` removed: Next 16 has no `next lint`, so the script always failed.
- `RESELLER_PUBLIC_URL` is now used: `npm run register-webhook` registers
  `<RESELLER_PUBLIC_URL>/api/coronium/webhook` once, then fires the signed test.
- `docs/reseller-quickstart.md` step 4 creates the signing secret before registering and
  testing the webhook. In the old order the test failed on a correct setup.
- AGENTS.md: metered bandwidth points at Coronium's own pool routes (`/pool/stock`,
  `/payment/buy-pool-with-account-credit`, `/account/pool-keys`), not an outside SDK.
- `examples/webhook-receiver/server.js`: reads both `new_modem` shapes, keys on
  `data.new_modem_id`, flags a refetch when details are missing; the header no longer says
  to ask support for the signing secret; the `modem.dead` advice stops on a `409` that is
  not a stock shortage.
- `docs/webhook-integration.md`: the "same payload for every replacement" claim and the
  sample handler are corrected for both shapes and for moves; detection threshold, 72 h
  cooldown and `GET /account/history` added.
- AGENTS.md: API key lifetime and renewal (regenerate in the dashboard; the wallet-key routes
  work only for wallet-bound accounts); "Wallet integration" no longer suggests a top-up
  API or on-chain sends; failure table extended for rotation, replace, set-os and OpenVPN.
- AGENTS.md: the architecture block now matches `examples/nextjs-dashboard` (key from the
  server environment, one route per action, no catch-all proxy); the 401 row says to
  regenerate the key only when `code` is `auth_required`. A `401 "Insufficient crypto
  balance"` on the BTC-lane buy or renew (`code` `internal_error`, `required` and
  `available` in BTC) means the BTC balance is too low: fund it, never regenerate the key
  (that revokes the working one). Added to AGENTS.md, llms.txt, the quickstart and
  `docs/billing-and-reconciliation.md`; the missing `examples/telegram-bot` reference points at the PROMPT.md
  Telegram prompt instead.
- Health polling: one cadence everywhere (at most every 60 s, cached 60 s; the endpoint is
  not real-time, most lines refresh every 30 minutes server-side).
- PROMPT.md: the Telegram prompt uses the kit client instead of an SDK release that cannot
  send `allow_without_p0f` or handle asynchronous rotation, and no longer asks the agent to
  top up the balance automatically. The webhook-only prompt follows the durable-inbox
  contract and never copies proxy passwords into CRM metadata.
- README hard rule 6: only classic rotation answers 200 on failure.
- `docs/pricing-markup.md`: billing is per tariff period (day, week or month), debited up
  front. Any refund you grant your own customer comes out of your margin.
- `docs/reseller-quickstart.md` and `docs/metadata-strategy.md`: no hard-coded tariff id; the
  quickstart picks one with stock from `/tariffs/available`. Funding is account credit or
  BTC; USDT held at Coronium is not spent by the purchase routes.

Additive:

- Payments: `max_total_usd` is documented and sent. The renew route sends the approved quote
  total, the buy form sends the shown estimate (`price` x count), and both show
  `409 price_changed` (nothing charged) with the new total instead of a plain error. AGENTS.md,
  llms.txt, `docs/billing-and-reconciliation.md` and the Telegram prompt now cover
  `price_changed`, `400 insufficient_balance`, `409 duplicate_request` and its `reason`
  values, `409 renewal_already_pending` and `429 renewal_burst`.
- `lib/coronium.ts`: `payment.buy` takes `max_total_usd`; `payment.renew` takes `maxTotalUsd`.
- `lib/coronium.ts`: `rotate(id, requestId?)` sends an optional UUIDv4 `request_id`;
  `setOs(id, os, requestId?)` returns a typed `SetOsResult` with `pending`;
  `revokeOpenvpn(id)`; `payments.status(id)`; `ReplaceResult.moved`;
  `RotationStatus.reset_error`; JSDoc for every refusal above.
- Dashboard buy and renew routes pass on `payment_id`, `charged_usd` and `refunded` from a
  charged but unconfirmed order, and the forms show the payment id. A `202` with
  `paymentId` (charged, still provisioning) is shown as that, not as an error, with the
  payment id to follow.
- `SetOsResult.data` has `modemId`, `p0f_os`, `requested_os` and `noop` (the `os` field was
  never sent); `setRotationInterval` types `data.name` as optional.

## 2026.10.24b - synced with OpenAPI 3.3.5

Documentation only; no API behaviour changed and no example code changed. These live routes
are now in the OpenAPI reference with parameters, answers and refusals:
`PUT /modems/{id}/set-white-list`, `GET /modems/{id}/usage`, `POST`/`GET /modems/{id}/speed-test`
(Coronium Node lines, see [stock and credentials](docs/stock-and-credentials.md)),
`POST /modems/{id}/openvpn/revoke`, `GET`/`POST /account/pool/saved`,
`DELETE /account/pool/saved/{id}`, `POST /account/pool/saved/{id}/url` and
`GET /pool/stock/carriers/{country}`.

## 2026.10.24 - synced with OpenAPI 3.3.4

Kit version 2026.10.24. Example packages `0.2.0`.

### API changes since the last kit sync (live 20-23 Oct 2026)

Breaking:

- **Replacing a p0f line keeps p0f** (3.3.2, 22 Oct). A line bought with `require: ["p0f"]`,
  or one with an OS set, is replaced only by a p0f line, with its OS re-applied. With none
  available, `POST /modems/{id}/replace` answers `409 p0f_replacement_unavailable`
  (`suggested_action` `retry_later_or_allow_without_p0f`, `changed: false`) and nothing
  changes. Send `{"allow_without_p0f": true}` to accept a line without p0f. Before, it gave
  any line. The automatic swap sends `modem.dead` with the new `reason` `no_p0f_stock`.
- **`features.p0f.provider` removed** (3.3.2). So is `provider` on `p0f-options` and
  `set-os`. Use `vocabulary` (`os_profile`, `tcp_stack` or `null`) and take values from
  `supported_values` / `options`. `set-os` refusals no longer carry `apiMode` or `hint`.
- **A line on a network that rewrites the OS signature** reads
  `features.p0f.server_supported: false` with no values, and `set-os` answers
  `400 p0f_unsupported_on_server`.
- **`IMEI` and `portId` deprecated** (20 Oct). On the replace answer and the `modem.replaced`
  webhook they now carry the proxy `_id`, never a hardware or port id, and are removed on
  **2026-11-19**. The replace answer carries `deprecated`. Key on `_id`.
- **`/signup` and `/get-token` never reveal whether an account exists** (22 Oct). Sign-up
  answers `200 {"result":"ok"}` for an address that already has an account (it used to be
  `400`). Login answers `401 Invalid email or password.` for an unknown address and for a
  wrong password (it used to be `404 User not found` or `Invalid password.`).

Additive:

- `features.p0f.unavailable_reason` on every line: `mobile_network`, `line` or `null` (3.3.3).
- `features.p0f.vocabulary` on every line (3.3.2).
- A replaced p0f line adds `p0f` (`{required, kept, os, os_applied, pending?, note?}`) to the
  replace answer and to `modem.replaced`.
- Coronium Node rows: `provider: "coronium_node"` (top level and in `proxyEndpoints`) is the
  one documented provider value. Other labels stay opaque.
- OpenAPI 3.3.4 (documentation only): corrected auth, replace and proxy-list examples.

### Kit changes

Fixes (the kit said something that is not true):

- Replacements **keep** your `metadata`. AGENTS.md, llms.txt, the webhook receiver and the
  dashboard worker said they do not. Re-stamping stays as a harmless safety net.
- Removed `deposit.confirmed` from the reseller event list: it is never sent to a reseller URL.
  Confirm top-ups with `GET /account`.
- `modem.dead` reasons now match the API: added `no_p0f_stock`, `provider_unsupported`,
  `no_owner`, `config_error`, `move_<code>` (`unknown` stays).
- Rotation: only classic proxies answer `200` with `rotated`. Rows with `proxyEndpoints`
  answer `202` with `pending: true`. Poll `GET /modems/{id}/rotation-status`. README, AGENTS,
  llms.txt and the quickstart said "always 200".
- Webhook signing secret: create it yourself with `POST /account/webhook/secret/rotate`.
  The docs said to ask support.
- Out of stock is `409` with `code: "no_stock"` (the quickstart and failure table said
  `409 OUT_OF_STOCK`).
- `verify-integration.mjs` no longer adds day, week and month stock together in the
  per-country summary. Those terms share devices.
- Dashboard: a line moved in place (`new_modem_id === old_modem_id`) no longer loses its
  customer assignment.
- `docs/pricing-markup.md`: removed the made-up wholesale price table and a named company.
  Prices now come from `/tariffs/available` at runtime. Volume pricing follows the published
  terms: 10% at 10+ lines, 15% at 25+ lines, as a code from hello@coronium.io.

Additive:

- `lib/coronium.ts`: `replace(id, {allow_without_p0f})` with a typed `ReplaceResult`,
  `rotationStatus`, `p0fOptions`, `setOs`, `RotateResult` with `pending`, and
  `features.p0f.vocabulary` / `unavailable_reason`. Removed the `IMEI` field from `Proxy`:
  the proxy list never returns it.
- `verify-integration.mjs` checks that every line carries `features.p0f.vocabulary` and
  `unavailable_reason` and no `provider`, and counts the rows that rotate asynchronously.
- `docs/p0f-and-openvpn.md`: setting the OS, the `set-os` refusal table, replacing a p0f line,
  and one-download OpenVPN on Coronium Node rows.
- `docs/stock-and-credentials.md`: a line-type summary and a Coronium Node section.
- `docs/webhook-integration.md`: opt-in history events (`proxy.added`, `proxy.removed`,
  `proxy.updated`), moved lines, `data.p0f`.

## Earlier

Before this file existed the kit was synced on 21 Oct 2026 (OpenAPI 3.3.1: p0f stock per
region, `require: ["p0f"]` on buy, OpenVPN pending retry). See the git history.
