# Coronium Reseller Kit

> Open-source starter for building a mobile-proxy reseller business on top of the [Coronium](https://dashboard.coronium.io) API. Optimized for AI coding agents (Claude Code, Cursor, Windsurf, Aider) to scaffold a working dashboard in one prompt.

## For AI agents

If you're an AI agent scaffolding a reseller dashboard, **read these first** in this order:

1. [`AGENTS.md`](./AGENTS.md) - hard rules, architecture template, failure-mode table
2. [`llms.txt`](./llms.txt) - concise machine-readable surface
3. [`PROMPT.md`](./PROMPT.md) - paste-ready prompts (Next.js / CLI / webhook-only / Telegram-bot variants)
4. [`examples/nextjs-dashboard/`](./examples/nextjs-dashboard/) - working foundation, copy and modify
5. [`docs/webhook-integration.md`](./docs/webhook-integration.md) - the auto-swap event flow

Read the [public OpenAPI specification](https://api.coronium.io/openapi.json) or browse it in [Swagger UI](https://api.coronium.io/api-docs/). Copyable agent setup prompts (API key, MCP, SDK, REST, Stripe MPP): https://dashboard.coronium.io/en/agents. The [changelog](./CHANGELOG.md) records the API behavior and examples checked for each kit update.

Prefer MCP? [`coronium-proxy-mcp`](https://github.com/coroniumio/coronium-proxy-mcp) exposes stock, account and balance-purchase tools: `npx -y coronium-proxy-mcp@2.4.3` locally, or the hosted servers `https://api.coronium.io/mcp` (22 tools, never spends) and `https://api.coronium.io/mcp/buyer` (15 tools, 20 when purchases are allowed). See [Accounts and funding without a browser](#accounts-and-funding-without-a-browser).

### Buy one rental with a Stripe Link wallet

If the buyer chooses their Link wallet, request a quote for one eligible dedicated rental with `POST /api/v3/payment/mpp` and the body `{"tariff_id", "currency": "usd", "max_total_usd"}`. The buyer’s Coronium API key identifies the account. Send `Content-Type: application/json` (anything else answers `415`) and keep the exact body bytes. An eligible first request returns an HTTP 402 challenge with the USD price (amount in cents, valid five minutes) and charges nothing. Show the merchant, tariff, term and exact price before asking the wallet for approval. Only some dedicated plans can be bought this way, and the catalog does not mark them. Terms are daily, weekly or monthly, and p0f is not offered on this checkout. A plan it cannot fill answers `409` with code `spt_stock_unavailable`; on the first request that charges nothing, so pick another plan or pay from account credit.

For the payment retry, keep the same account, request body bytes, credential preference and `Idempotency-Key`. Keep the account Bearer in `Authorization` and send the wallet credential in `Payment-Authorization`. A pending response may already represent a payment in progress. Use the returned `status_url` on the Coronium API origin to confirm delivery before handing over credentials: delivered means `status: completed` with the line in `modems`.

The buyer's wallet tool is the official [Link CLI](https://github.com/stripe/link-cli): `npm install -g @stripe/link-cli@1.6.0`, then `link-cli auth login` (logging in buys nothing). Link agent wallets are for US and Canadian Link accounts for now, and Link allows $500 per spend request and $500 a day. `link-cli mpp decode --challenge` reads the challenge. `link-cli mpp pay` with `--method POST`, the same `--data`, a `--header` each for `Content-Type`, `Authorization` and `Idempotency-Key`, a `--context` of at least 100 characters and `--format json` returns an `approval_url` for the buyer, then a `_next.pay_argv` to run after approval. It adds `Payment-Authorization` itself. Its output repeats the request headers, including the API key, so keep it out of logs and chat. A buyer-approved shared payment token can pay the same rental through `POST /api/v3/payment/buy-with-shared-payment-token`. `POST /payment/mpp` is listed in the OpenAPI from version 3.3.17; the 3.3.16 spec does not have it.

[Stripe MPP buyer guide](https://www.coronium.io/blog/buy-a-mobile-proxy-with-stripe-mpp) and [step-by-step buyer script](https://www.coronium.io/.well-known/agent-skills/coronium-mpp-checkout/SKILL.md)

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
| `examples/verify-integration.mjs` | Read-only smoke test for key, separate balances, stock, p0f and OpenVPN fields and webhook configuration |
| `examples/nextjs-dashboard/` | Self-hosted Next.js operator dashboard - customer mapping, stock, purchase with optional p0f, renewal, signed webhook inbox |
| `examples/webhook-receiver/` | Durable signed event receiver for resellers with their own CRM worker |
| `docs/reseller-quickstart.md` | Zero → revenue path, 7 steps |
| `docs/webhook-integration.md` | Auto-swap event flow contract |
| `docs/feature-badges.md` | Show IPv6, OS fingerprint (p0f) and OpenVPN badges on plan cards, region pickers and customer lines, from live API fields |
| `docs/p0f-and-openvpn.md` | Find p0f stock per region, buy with `require: ["p0f"]`, set the OS, replacements that keep p0f, OpenVPN download answers |
| `docs/ipv6-lines.md` | Picking IPv6 lines: read `ipv6_count`, buy with `require: ["ipv6"]`, handle `409 ipv6_unavailable`, replacements that keep IPv6, what IPv6 guarantees |
| `docs/stock-and-credentials.md` | Optional credential header, line types, Coronium Node rows, capabilities, [guaranteeing features per region](docs/stock-and-credentials.md#guaranteeing-features-per-region) |
| `CHANGELOG.md` | Dated list of API and kit changes, breaking vs additive |
| `docs/metadata-strategy.md` | Customer mapping via `metadata` plus a small local swap-recovery index |
| `docs/pricing-markup.md` | 2026 market rates + economics |

## Coronium API surface used

| Method · Path | Purpose |
|---|---|
| `GET /api/v3/account/proxies` | List proxies you own |
| `GET /api/v3/account` | Account credit, BTC and USDT balances |
| `GET /api/v3/account/proxies/health` | Per-proxy `health` (`state` `ok`, `degraded`, `down` or `unknown`, plus `checked_at` and `source`), `is_alive` and the older `recommendation`. Automate on `health.state` |
| `GET /api/v3/tariffs/available` | In-stock tariffs, with `features.p0f.count`, `features.openvpn.count` and `features.ipv6.count` (= `ip_stack.ipv6`) per plan |
| `GET /api/v3/free-modems` | Stock per country, carrier and region, with `p0f_count` per region, plus `openvpn_count`, `ipv6_count` and `one_time_only_count` (OpenAPI 3.3.16) and `p0f_ipv6_count` (3.3.18). See [Guaranteeing features per region](docs/stock-and-credentials.md#guaranteeing-features-per-region) |
| `POST /api/v3/payment/buy-modems-with-crypto-balance` | Buy proxies, attach `metadata.customer_id`, optional `require: ["p0f"]`, `["ipv6"]` or `["p0f", "ipv6"]` |
| `POST /api/v3/payment/buy-with-account-credit` | Buy using USD account credit, optional `require` as above |
| `POST /api/v3/payment/renewal-quote` | Show the exact total and any advisory `warnings[].message` before approval |
| `GET /api/v3/modems/{id}/auto-renewal` · `PUT /api/v3/modems/{id}/auto-renewal` | Read a term and price, enable with consent, or turn off balance renewal on eligible Node rentals. See [Node line controls](docs/stock-and-credentials.md#coronium-node-rows). |
| `POST /api/v3/payment/renew-with-account-credit` | Explicit renewal using account credit |
| `POST /api/v3/payment/renew-modems-with-crypto-balance` | Explicit renewal using BTC balance |
| `POST /api/v3/modems/{id}/restart` | Rotate IP. Classic proxies: 200, branch on `rotated`; `429` within 60 s of the last rotation. Rows with `proxyEndpoints`: 202 pending, poll `rotation-status`; a refusal is `409`, `429` (wait `Retry-After`) or `502 rotation_unconfirmed` (poll, do not resend); read `code` and `suggested_action` |
| `GET /api/v3/modems/{id}/rotation-status` | `idle`, `rotating`, `done` or `failed` for the last rotation |
| `PUT /api/v3/modems/{id}/set-rotation-interval` | Use seconds for `rotation_interval`. Zero disables a timer. For a Node line, use the bounds returned in `proxyEndpoints.rotationSchedule` (120 to 86400 in steps of 60) when `capabilities.rotationInterval` is true. A stored schedule can still be turned off. Other timed rows with `proxyEndpoints` accept 60 to 2592000 in steps of 60. Classic rows accept 60 or more. |
| `POST /api/v3/modems/{id}/replace` | Swap a broken proxy (same country, remaining time and `metadata` kept). A p0f line gets a p0f line or `409 p0f_replacement_unavailable`; send `{"allow_without_p0f": true}` to accept one without. No replacement in stock = `400 "No free modems!"` (not 409 no_stock, branch on status + message); daily limit = 400; failed delivery = 500 with the current proxy unchanged and no late second line; a concurrent call = `409 request_in_progress`; lines that cannot be replaced through the API = `409` (`action_unsupported`, or `internal_error` with an error that says to contact support); a move already running = `409` "being moved right now" (retry in a few minutes); `500` "needs a check by support" = do not retry, contact support. A proxy you already replaced = `409 already_replaced` with `current_modem` `{_id, name}` (the proxy that replaced it, or null if it left your account), nothing changes. A moved line answers `moved: true` with the same id |
| `GET /api/v3/modems/{id}/p0f-options` | OS values this line accepts, and its `vocabulary` |
| `PUT /api/v3/modems/{id}/set-os` | Set the OS fingerprint (`{"os": "<value>"}`, `""` turns it off). `200` = applied (`data.applied: true`, or `data.noop: true` when the value was already set), `202` `pending: true` = sent, not yet confirmed |
| `GET /api/v3/modems/{id}/openvpn` | Download the `.ovpn` profile. `503 openvpn_profile_pending` = retry after `Retry-After`, never replace |
| `PUT /api/v3/modems/{id}/set-metadata` | Set customer mapping after checking current ownership and receipt |
| `GET /api/v3/modems/rotate-modem-by-token/{token}` | Token-auth rotation for end-customer scripts. Classic: 200 only on a verified new IP, 502 otherwise. Rows with `proxyEndpoints`: 202 pending + `status_url`. Coronium Node refusals: 409/503 with a guessed code, decide from `error`. Other rows: `429 rotation_too_soon`, `409 modem_expired` / `rotate_unavailable` / `modem_rotation_in_progress`, `502 rotation_unconfirmed` (submitted: poll, do not resend) |
| `GET /api/v3/modems/get-rotating-modem-status-by-token/{token}` | No-auth status of the last rotation, using the same token as rotate-modem-by-token. Coronium Node row: poll `data.rotation` until `pending` is false (`success` = done, `needs_review` = still being confirmed: check status later). Other rows with `proxyEndpoints`: `data.state` `done` or `failed`. Classic: `status`, `ext_ip`, `rotated_at` |
| `GET /api/v3/modems/{id}/usage` | Per-day data use of the current rental, where `capabilities.usage` is true |
| `GET /api/v3/account/history` | Cursor-paginated log of changes to your proxies and account (added, replaced, renewed, removed, credentials or settings changed - never the values). Response `{data, next_cursor, partial, live_since}`; `partial: true` means a source failed and the page may be incomplete. Poll it if you do not opt in to `history_events` |
| `GET /api/v3/account/payments` | Your payment ledger, for reconciliation |
| `GET /api/v3/payments/{payment_id}/status` | Follow one payment, for example after a `503 PAYMENT_DELIVERY_UNCONFIRMED` that carries `paymentId` |
| `GET /api/v3/account/subscriptions` | Auto-renew state per proxy |
| `PUT /api/v3/account/webhook` | Register a public HTTPS webhook for account events (private or non-resolving hosts answer `400 invalid_webhook_target`; redirects are not followed) |
| `GET /api/v3/account/webhook` | Read current webhook URL |
| `POST /api/v3/account/webhook/secret/rotate` | Create or rotate your own signing secret (shown once) |
| `POST /api/v3/account/webhook/test` | Fire a real signed test event and get the delivery result: `delivered`, `status_code`, `latency_ms`, and on failure a short `error` with `error_code`. Your endpoint's body is never returned (`response_preview` is null) |

Auth: `Authorization: Bearer <jwt>` header. Use the account API key from <https://dashboard.coronium.io> → Your Account → API Access, or let an agent create the account and the key through the API ([below](#accounts-and-funding-without-a-browser)). The API key needs no two-factor code, keeps working after a password change, and authenticates only the request it is sent with: it never creates a dashboard session. Do not automate `POST /get-token` with a password: on an account with two-factor login it needs the current code as `code` (without it: `401`, `code` `two_factor_required`), its token ends when the password or two-factor setting changes or on "log out everywhere", and failed sign-ins are limited. `/api/v1/create-token` is retired and answers `410`. `POST /get-token` and `POST /signup` never reveal whether an account exists: an unknown address and a wrong password both answer `401 Invalid email or password.`, and sign-up answers `200 {"result":"ok"}` for every valid address.

### Accounts and funding without a browser

An agent can open the account, fund it and buy with no dashboard visit. The account starts empty: no balance, no proxies, nothing included until paid. Every purchase still needs the person's yes for the exact total.

| Method · Path | Purpose |
|---|---|
| `POST /api/v3/signup` | `{login, password, name, purpose?}`. Disposable and reserved email domains (including `.test`, `.example`, `.invalid`, `.localhost`) are refused. At most 5 accounts per IP address a day and 5 per uncommon email domain an hour (`429` with `Retry-After`). `name` at most 80 characters, `purpose` 500; no `<` or `>` in `name`. A verification email is sent; nothing waits for it |
| `POST /api/v3/get-token` | `{login, password}` (plus `code` on a two-factor account) → a session token, used once to fetch the API key below |
| `GET https://api.coronium.io/api/v1/account/api-token` | With the session token as Bearer: `{token, expiresAt}`, the 365-day API key (the same key as Dashboard → Account → API Access) |
| `POST https://api.coronium.io/api/v1/account/api-token/rotate` | With the current API key or a login token as Bearer: a new `{token, expiresAt}`. The old key stops at once. Use it when a key leaks |
| `GET /api/v3/account/crypto-balance` | USDT (TRC-20) and BTC deposit addresses and balances, plus account credit. An array: `coin` is `btc`, `usdt` or `account_credit`. The first call creates missing deposit wallets |
| `POST /api/v3/account/balance/convert` | Moves the account's own confirmed USDT and/or BTC into USD account credit, one way (BTC at the live rate, USDT 1:1). Body `{coin, amount_usd?, dry_run?}`: `coin` is `usdt`, `btc` or `all` (default `all`), `amount_usd` a number of at least 1 (single coin only), `dry_run: true` previews. A real move needs an `Idempotency-Key` header (8-128 letters, digits, `_` or `-`; a UUID works). `200` `data` = `{moved: [{coin, coin_amount, usd, rate, move_id, status, replay}], refused, account_credit_before, account_credit_after}`. A coin that cannot move now (BTC not yet confirmed, an open crypto order) is listed in `refused` with its `code`; when nothing moved the status is `409`, and less than $1 to move is `409 nothing_to_move` with `coin: "all"` (a single coin lists `NOTHING_TO_MOVE` in `refused`). A key with `.` or `:`, or longer than 128 characters, answers `400` "Invalid Idempotency-Key format" |
| `GET /api/v3/account/card-list` | Saved cards. A person adds the card in the dashboard (Stripe) |
| `POST /api/v3/payment/buy-with-card/{card_id}` | Buy with a saved card, same body as the balance buys (`max_total_usd`, `Idempotency-Key`). A declined card, or one the bank wants authenticated, answers `402` and nothing is charged |
| `POST /api/v3/payment/renew-with-card/{card_id}` | Renew with a saved card; quote first with `POST /payment/renewal-quote` |

Then buy with `POST /api/v3/payment/buy-with-account-credit` (or renew with `/payment/renew-with-account-credit`), sending `max_total_usd` and an `Idempotency-Key`. A `202` means paid and provisioning: poll `GET /api/v3/payments/{paymentId}/status`, do not order again. A confirmed BTC balance can also pay directly on `/payment/buy-modems-with-crypto-balance` and `/payment/renew-modems-with-crypto-balance`. Refunds go to the Coronium account balance. The paid 24-hour plan is the way to test a line.

The same flow as MCP tools: start `npx -y coronium-proxy-mcp@2.4.3` with no `CORONIUM_API_TOKEN` and `CORONIUM_TOOL_PROFILE=buyer` (plus `CORONIUM_ENABLE_SPENDING=1` to buy). `coronium_create_account` signs up, signs in and issues the API key for the session, then `coronium_get_crypto_balance`, `coronium_convert_crypto_to_credit` (dry run, then confirmed), `coronium_quote_purchase` and `coronium_buy_modems_with_balance` with `funding_source: "account_credit"`. Full walk-through with curl: [Agents without a browser](https://github.com/coroniumio/coronium-proxy-mcp#agents-without-a-browser).

No header is needed to see stock. Without any header you are offered, and sold, units that are verified to accept **one login on both ports** (HTTP and SOCKS5), so the ordinary `proxy_login` / `proxy_password` fields are complete. The header `X-Coronium-Proxy-Credentials: separate-protocol-v1` is optional: send it on stock, tariff and purchase calls to **also** be offered units whose HTTP and SOCKS5 have different hosts or logins, and then read `proxyEndpoints.http` and `proxyEndpoints.socks5` independently (the legacy fields describe HTTP only). Neither mode bypasses supplier consent, health checks or rental-term coverage, and an order with `autoRenew: true` is only filled from units that support it. `proxyEndpoints.provider` is an opaque label: never branch on it. The one documented value is `coronium_node` (Coronium Node rows, which also carry it as a top-level `provider`); see [stock and credentials](docs/stock-and-credentials.md#coronium-node-rows). Branch on `proxyEndpoints.capabilities`, and hide any action a proxy does not advertise (some line types do not advertise customer auto-renew or replacement). `renewalCoveredUntil` is informational, not a customer rental deadline; `POST /payment/renewal-quote` decides what can be renewed.

Coupons, including any reseller discount on your account, apply on both the account-credit and the BTC lane. Send `"coupon": {"coupon_name": "..."}` and read the result from `billing.discount`. Validate a code once with `POST /api/v3/coupons/check` and cache the answer: see [Limits and error answers](#limits-and-error-answers).

### OS fingerprint (p0f), native IPv6 and OpenVPN

- `/free-modems` rows carry `p0f_count` and `/tariffs/available` plans carry `features.p0f.count`. Both are what a buy with `require: ["p0f"]` can get, counted only on units whose OS change has been seen on the wire.
- Add `require: ["p0f"]` to any v3 buy body to get only units with p0f. No such unit: `409 p0f_unavailable`. Any other value: `400 unknown_requirement` with `supported: ["p0f", "ipv6"]`. Nothing is charged or reserved either way.
- After purchase each line has `features.p0f.server_supported`, `supported_values`, `vocabulary` (`os_profile`, `tcp_stack` or null) and `unavailable_reason` (`mobile_network`, `line` or null). Set the OS with `PUT /modems/{id}/set-os`. `200` = applied: `data.applied: true`, or `data.noop: true` when the line already had that value. `202` with `data.pending: true` (plus `request_id` and `change`) = sent to the line and not yet confirmed: do not resend (a resend answers `409 p0f_change_in_progress`), read `p0f_os` on `GET /account/proxies` later. An optional `request_id` (UUIDv4) makes a retry safe. Refusals: `400 p0f_unsupported_on_server`, `400 p0f_os_unsupported_on_this_server` (with `allowed`), `429` (one change per 5 minutes), `502 p0f_not_applied` (nothing changed, retry in a minute), `404 p0f_unavailable` (OS changes are not available on this line right now - contact support). Some lines answer with these codes instead: `400 p0f_os_not_supported_on_server` (value not accepted, carries `allowed`), `429 p0f_rate_limited`, `409 p0f_change_in_progress`, `409 p0f_proxy_offline` (retry later), `409 rental_conflict`, `400 invalid_request` (bad `request_id`). Branch on the HTTP status first and treat both 400 "value not accepted" spellings the same way.
- Replacing a p0f line gives a p0f line and re-applies the OS. With none available: `409 p0f_replacement_unavailable`, nothing changes; resend with `{"allow_without_p0f": true}` to accept a line without p0f.
- Native IPv6 (OpenAPI 3.3.18): add `require: ["ipv6"]` (or `["p0f", "ipv6"]`) to get only lines whose IPv6 was checked through their own proxy port in the last 2 hours. Too few: `409 ipv6_unavailable`, nothing charged. `ipv6_count` (`p0f_ipv6_count`) on `/free-modems` and `ip_stack.ipv6` on `/tariffs/available` count those lines. Replacing such a line gives a checked IPv6 line or `409 ipv6_replacement_unavailable` (nothing changed; `{"allow_without_ipv6": true}` accepts one without). Steps and examples: [Picking IPv6 lines](docs/ipv6-lines.md).
- Native IPv6 means the line reaches IPv6-only sites over its own mobile IPv6 address. What we guarantee: every line sold with `require: ["ipv6"]` passed that check through its own proxy port within the last 2 hours, and is checked again just before it is handed over when that check is more than 10 minutes old. What we cannot guarantee: the mobile carrier assigns the IPv6 address per session, so a rotation, restart or reconnect gives the line a new address, and whether it gets IPv6 again is the carrier's decision, not ours; we do not re-check sold lines on a schedule. Sites that offer both IPv4 and IPv6 may still be reached over IPv4. We have not verified OS fingerprint (p0f) control on IPv6 connections. Replacement honours the requirement: `/replace` on a line bought with `require: ["ipv6"]` gives a line with a fresh IPv6 check, or answers `409 ipv6_replacement_unavailable` and changes nothing.
- Per region (OpenAPI 3.3.16): every `/free-modems` row also has `openvpn_count`, `ipv6_count` and `one_time_only_count` (integers, always present, never more than `count`). OpenVPN is guaranteed only when you buy with a `region_id` whose row has `openvpn_count == count`; no buy flag selects it. An order with `autoRenew: true` never gets a one-time unit. Full table: [Guaranteeing features per region](docs/stock-and-credentials.md#guaranteeing-features-per-region).
- OpenVPN: check `features.openvpn.available` on the line. A line set up in the last 2 hours may answer `503 openvpn_profile_pending` with `Retry-After`: wait and retry the same line, never replace it. `409 openvpn_not_supported` and `400 openvpn_disabled` are final.

Details and examples: [docs/p0f-and-openvpn.md](docs/p0f-and-openvpn.md).

**Missing stock compared with the dashboard?** Read [stock and credential negotiation](docs/stock-and-credentials.md) for the exact header, term selection, cache rules and protocol credentials.

Confirm your key works before writing any code:

```bash
CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs
```

On Node 20.12+ the script also reads the key from `examples/nextjs-dashboard/.env` or `./.env`. A missing webhook is a warning until you deploy; after deploy run it with `--require-webhook --webhook-test`.

### Rotation returns 200 even when it fails

On a classic proxy (no `proxyEndpoints` on the row), `POST /modems/{id}/restart` holds the request open until the carrier responds, then reports the truth in the body:

```json
{ "result": "ok", "rotated": true,  "ip": "172.56.171.9", "message": "IP rotated to 172.56.171.9." }
{ "result": "ok", "rotated": false, "ip": "172.56.171.4", "message": "Rotation did not change the IP (…)" }
```

Both are HTTP 200. **Branch on `rotated`, never on the status code.** A row with `proxyEndpoints` answers **202** at once with `rotated: false, pending: true`: poll `GET /modems/{id}/rotation-status` every 5-10 seconds until `state` is `done` or `failed`, and never resubmit while it is `rotating`. A refused rotation on such a row changes nothing: read `code` and `suggested_action`. On a Node row, `proxyEndpoints.rotationState` can be `busy`, `needs_review` or null. A `409 rotate_unavailable` with `suggested_action: retry_later` means the previous IP change is still being confirmed. Refresh status after a minute and keep new rotation requests paused until the hold clears. A `503` on a Coronium Node row (`code` `modem_rotation_in_progress`) means rotation is unavailable right now: do not poll, try later. Other rows with `proxyEndpoints` can also answer `429 rotation_too_soon` (wait `Retry-After`), `409 modem_expired` (renew first), `409 rotate_unavailable` with `check_proxy_health` (offline, do not loop) or `502 rotation_unconfirmed` (submitted: poll `rotation-status`, do not resend). Within 60 s of the previous rotation (started or finished, failed included) a classic `/restart` answers `429` with `code` `rotation_too_soon` or `rotation_cooldown`, a `Retry-After` header and the same `retry_after_seconds`. The token-auth variant differs: on a classic proxy it answers 200 only on a verified new IP, `502` otherwise (branch on that HTTP status, not on a body error code), and `429` while a modem is inside its ~60 s cooldown. On a row with `proxyEndpoints` it answers `202` with `pending: true` and a `status_url`: follow that URL as returned and never resend. On a Coronium Node row treat `409` and `503` as refusals whose `code` usually reads `modem_rotation_in_progress` whatever the reason (an ended rental can read `internal_error`), so decide from `error` there (busy, too soon, a previous IP change still being confirmed: recheck status later, or rental required: reload the proxy list). On other rows with `proxyEndpoints` the codes are real: `429 rotation_too_soon`, `409 modem_expired` / `rotate_unavailable` / `modem_rotation_in_progress`, and `502 rotation_unconfirmed` (submitted: poll `status_url`, do not resend).

### Errors

Every 4xx/5xx on `/api/v3` carries:

```json
{
  "error": "This plan is out of stock right now. Nothing was charged - please pick another carrier or try again shortly.",
  "code": "no_stock",
  "reason_code": "OUT_OF_STOCK",
  "suggested_action": "retry_later_or_different_tariff",
  "retryable": false,
  "request_id": "req_MZpmKb_FCA"
}
```

`error` is the human string, `code` the machine identifier. Log `request_id` (also returned as the `X-Request-Id` header) and quote it in support tickets. Out of stock is **409 with `code: "no_stock"`** on `/api/v3` (the same answer carries `reason_code: "OUT_OF_STOCK"`, the spelling `/api/v1` and the `proxy.purchase_failed` webhook use; branch on either). Do not retry-loop or switch products without asking the buyer. A buy with `require: ["p0f"]` refused for lack of p0f units answers `409 p0f_unavailable` instead, and one with `require: ["ipv6"]` (alone or with p0f) refused for lack of IPv6 lines answers `409 ipv6_unavailable`.

## Limits and error answers

Live since 13 Nov 2026. Branch on the HTTP status first.

| Situation | Answer | What to do |
|---|---|---|
| `POST /api/v3/coupons/check` with a valid code | `200 {data: {discount: "15%"}}` (`discount: 0` = this account already used it) | Cache the result for the session and send the code with the order |
| Unknown, expired, revoked or not-applicable code | `404`, one message for all: "This coupon code is not valid for your account." (the envelope `code` is not specific) | Show "code not valid"; do not try variations |
| `coupon_name` missing, empty, longer than 64 characters or not a string | `400` "Enter a coupon code." | Send a string |
| Coupon checks above the limit (120 per 10 minutes per account and per IP address) or too many misses (10 a day per account, 30 per network) | `429` with `Retry-After` | Wait; validate once and cache instead of checking before every order |
| Malformed payment, ticket or pool id in the path, a value of the wrong type, invalid JSON | `400`, `code` `invalid_request` with `reason_code` `BAD_PARAMETERS` (was `500`) | Fix the request; do not retry it unchanged |
| A body or query key that starts with `$` | `400`, `code` `BAD_PARAMETERS` | Send plain values |
| `POST /get-token` too often from one IP address (5 in 10 s, 15 a minute, 60 an hour) or too many failed sign-ins (10 per account and network in 15 minutes, 30 per IP address in an hour) | `429` with `Retry-After` and `retry_after_seconds` | Wait that long. Use the API key instead of signing in |
| `POST /get-token` on a two-factor account without the current `code` | `401`, `code` `two_factor_required` (counts as a failed sign-in) | Send `code`, or use the API key |
| `POST /api/v1/create-token` | `410` | Use the API key |
| Sign-up above 5 accounts per IP address a day or 5 per uncommon email domain an hour; reserved test domains | `429` with `Retry-After`; `400` for the domain | Create accounts only when a person asks for one |
| `name` over 80 characters, `company_name` over 120, `purpose` over 500, or `<` / `>` in `name` or `company_name` | `400` naming the field; nothing is cut | Shorten or clean the value |
| A pool plan id on a line purchase route | `400 not_a_modem_tariff`, nothing charged | Pick a plan from `GET /tariffs/available` |
| Renewal of a line whose plan is not a dedicated-line plan | `409 modem_tariff_invalid`, nothing charged | Contact support |
| `PUT /account/webhook` with a private, internal or non-resolving host | `400 invalid_webhook_target` | Use a public `https://` URL; redirects are not followed |

Every `429` carries a `Retry-After` header in seconds. Wait at least that long; do not retry sooner or switch keys or addresses to get around it.

Hosted MCP connections (`https://api.coronium.io/mcp` and `/mcp/buyer`) end when the account password or two-factor setting changes or on "log out everywhere"; connect again. An API key used as Bearer is not affected.

Offer IP whitelisting only when the owned row advertises `proxyEndpoints.capabilities.whitelist: true` or `features.whitelist.available: true`. When both are absent or false, hide the control and use the line’s login and password.

## Core integration pattern (read this once)

### 1. The `metadata` field is your customer-mapping layer

Stamp `metadata.customer_id` on each reseller dashboard purchase. Keep the purchase receipt and a durable local order/payment/modem-to-customer mapping too. Replacements keep metadata, but older lines can have missing values and the old modem may be gone before your webhook worker runs. Missing metadata alone is not evidence of failed delivery or a reason to buy again.

```json
POST /api/v3/payment/buy-modems-with-crypto-balance
{
  "tariff_id": "...",
  "modemCount": 1,
  "max_total_usd": 97,
  "metadata": "{\"customer_id\":\"acme-007\",\"tag\":\"tiktok-batch\"}"
}
```

`max_total_usd` is the total the buyer approved (tariff `price` x `modemCount`); above it the answer is `409 price_changed` and nothing is charged. `modemCount` is the field name - `modem_count` and `count` are ignored, and the request fails with `Bad modem count`. Country and carrier come from the **tariff**; a body `country_id` or `carrier_id` does not override them. Only dedicated-line plans are accepted on line purchase and renewal routes: a pool plan id answers `400 not_a_modem_tariff` and nothing is charged. Send `metadata` as an object or a string: the API JSON-serializes objects and preserves strings. The example uses a serialized string. Keep the same `Idempotency-Key` and exact body on every retry of one order.

`GET /account/proxies` returns the stored string; parse it defensively before filtering by `customer_id`, because plain strings are also valid. To repair a missing mapping, verify the current owned modem against its purchase receipt, preserve the complete value and read it back after `set-metadata`. Never overwrite a conflicting mapping or re-buy to recover metadata. Full pattern in [`docs/metadata-strategy.md`](./docs/metadata-strategy.md).

The 200 also carries an itemized `billing` block (`line_items`, `subtotal_usd`, `discount`, `charged_usd`, `settlement`) so you can reconcile the charge without a second call - **price before coupon** is `subtotal_usd`, **price after coupon** is `charged_usd`, and every figure ties out to the cent. Plus a `webhook` receipt telling you whether an event is coming and which `event_id` to match it on.

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
      "_id": "...", "host": "...", "http_port": "...", "socks_port": "...",
      "proxy_login": "...", "proxy_password": "...",
      "tariff_expired_at": 1780987974498, "country_code": "...", "isOnline": true
    }
  }
}
```

Reading `body.old_modem_id` gives `undefined` - it lives at `body.data.old_modem_id`. Key on `data.new_modem_id`, which is always set, and refetch the line from `GET /account/proxies` before you hand out credentials. Do not rely on `new_modem.IMEI`/`portId`; they are deprecated and disappear on 2026-11-19. Deliveries are signed (`X-Coronium-Signature`) and retried up to 8 times, so verify the signature and dedupe on `event_id`. Every replacement that changes the connection details (automatic, your own `POST /modems/:id/replace`, or by support) sends `modem.replaced` and carries `metadata` to the new proxy; do not re-stamp it unconditionally. Repair missing metadata only after verifying the current owned modem and original mapping; a conflicting value needs review.

Some lines are moved instead of swapped. This can happen on an automatic replacement or on your own `POST /modems/:id/replace`. On a move, `new_modem_id` equals `old_modem_id` and the `/replace` answer has `moved: true`. The line keeps its id, login, password and expiry, and only the ports may change. Your own `/replace` that moves the line and keeps the same ports sends no `modem.replaced` event, so treat the synchronous `/replace` answer (`moved: true`) as the source of truth. The automatic swap (8 failed checks, an HTTPS webhook registered, more than 24 hours left) sends `modem.replaced` in the `_id`/`proxy_login`/`proxy_password`/`tariff_expired_at` shape, with `new_modem_id` equal to `old_modem_id` when it moved the line. When that move changed the ports it can send a second `modem.replaced` for the same line in the `id`/`login`/`password`/`expires_at` shape (the shape a replacement by support uses). Separately, some lines are moved automatically after about 30 minutes offline, with no webhook required and with as little as 1 hour of paid time left. Such a move keeps id, login, password and expiry. It sends `modem.replaced` only when the ports changed, and then only in the `id`/`login`/`password`/`expires_at` shape; a move that keeps the ports sends no event. Every move writes a `proxy.moved` row to `GET /account/history`, so without a webhook poll that (or `GET /account/proxies`) to catch port changes. Dedupe on `event_id`, treat a repeat `new_modem_id` as the same change, and refetch the line from `GET /account/proxies`.

If no replacement is available, you may get `modem.dead` with `new_modem_id: null` and a `reason` code (for a p0f line with no p0f stock, `no_p0f_stock`). You also receive purchase, purchase-failure, renewal and expiry events. Full event spec in [`docs/webhook-integration.md`](./docs/webhook-integration.md).

### 3. Protect active customers

Treat active proxies as customer-owned service. Check current ownership and capabilities before any replacement or settings change. A replacement may change credentials; contact the customer. Never assume a webhook means the replacement is already usable in your own storefront.

## Hard rules (also in AGENTS.md, repeated here for human readers)

1. **Never put `CORONIUM_API_KEY` in client-side code.** Server-side only. Protect the operator dashboard before putting it online.
2. **Use a public HTTPS webhook URL.** HTTP returns 400, and so does any private or non-resolving host. Redirects are not followed.
3. **Persist the signed webhook durably before acknowledging it within 5 seconds.** Non-2xx is retried; dedupe on `event_id` and process from a durable inbox.
4. **Verify `X-Coronium-Signature`** over the raw request bytes before trusting a payload.
5. **Idempotency**: pass an `Idempotency-Key` header on the starter dashboard’s purchase and renewal requests - `[A-Za-z0-9_-]{8,128}`, 24h window, replays answer with `X-Idempotency-Replay: true`. One key per buy *intent*, reused across retries; a key that changes per attempt buys twice. A real `POST /account/balance/convert` move requires one in the same format.
6. **Classic rotation is synchronous and answers 200 on failure.** Branch on `rotated`, not on the status code. Rows with `proxyEndpoints` answer 202 (poll rotation-status). A refusal is 409, 429 (wait `Retry-After`) or 502 `rotation_unconfirmed` (poll rotation-status, do not resend); read `code` and `suggested_action`.
7. Use seconds for `rotation_interval`. Zero disables a timer. For a Node line, use the bounds returned in `proxyEndpoints.rotationSchedule` (120 to 86400 in steps of 60) when `capabilities.rotationInterval` is true. A stored schedule can still be turned off. Other timed rows with `proxyEndpoints` accept 60 to 2592000 in steps of 60. Classic rows accept 60 or more.
8. **Don't reinvent auto-swap or health logic.** Both are server-side, battle-tested.
9. **Proxy passwords are your customers' secrets.** Encrypt them at rest, show them only to the owning customer, keep them and webhook payloads out of logs.
10. **Trust the API over the event.** Confirm a replacement or a deposit with a fresh API read before handing out credentials or crediting money.

## License

MIT. Fork it, change it, ship it.

## Contact

- Code questions: GitHub Issues on this repo
- API access / partner deals / volume pricing: <hello@coronium.io>
- Coronium status / changelog: <https://dashboard.coronium.io>
