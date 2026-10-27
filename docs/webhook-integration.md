# Webhook integration

The auto-swap event flow - the most important integration for a reseller.

## What problem this solves

Mobile modems fail. Phones overheat, SIMs deactivate, carrier networks reroute, host servers go offline. Without auto-swap, your customers experience random outages and blame you.

With the Coronium webhook flow:

1. Coronium detects an eligible failed modem: 8 consecutive failed 30-minute health checks (about 4 hours), more than 24 hours of paid time left, an HTTPS webhook registered on the account, and not still reported online by the provider
2. If the provider and stock support replacement, Coronium provisions a replacement (or moves the line, see below)
3. The original `tariff_expired_at` and your `metadata` are transferred - your customer doesn't lose paid time
4. The old modem is quarantined to a system bucket
5. Coronium POSTs an event to your webhook URL with old + new modem IDs and the connection details
6. Your handler refetches the line from `GET /account/proxies` and updates the customer's record
7. You notify the customer that connection details have changed

After an event is sent for a line, that line gets no new attempt for 72 hours. `/account/proxies/health` already reports `dead` from 3 consecutive failures, so poll it to warn your customer earlier.

This is conditional on provider capability and available stock. Do not promise a fixed recovery time.

The 8-failure, webhook and 24 hour rules apply to this swap only. Some lines are also moved automatically after about 30 minutes offline, without a webhook (see `modem.replaced` below). Such a move keeps the credentials and sends an event only when the ports changed.

## Registering your webhook URL

One-time setup per Coronium account:

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://your-host/api/coronium/webhook"}'
```

`webhook_url` must be **HTTPS** (HTTP returns 400). A registered webhook also opts the account into automatic same-location replacement of dead proxies; removing it turns that off and dead-proxy notices go back to email. Max length 500 chars. The target must be a public host: internal, private and non-resolving addresses are rejected with `code: "invalid_webhook_target"`. Use the HMAC signature for authentication, not a secret in the URL.

Disable later with `{"webhook_url": null}`.

## Verify your endpoint before you rely on it

```bash
curl -X POST https://api.coronium.io/api/v3/account/webhook/test \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

This POSTs a real signed `webhook.test` event to your registered URL **synchronously** and returns the actual delivery outcome - the HTTP status your endpoint replied with, plus latency. Run it on every deploy. Without it, "we never get events" is indistinguishable from "our endpoint has been 500ing for a month".

## The envelope - every event has the same shape

```json
{
  "event_id": "3f1a…-uuid",
  "event": "modem.replaced",
  "occurred_at": "2026-07-25T08:34:53.000Z",
  "account": { "user_id": "6600aa…", "email": "you@example.com" },
  "data": { }
}
```

**Event-specific fields live under `data`.** Reading `body.old_modem_id` returns `undefined` - it is `body.data.old_modem_id`. Dedupe on `event_id`.

## Event types

### `modem.replaced` - a proxy was replaced (automatically, by your Replace call, or by support)

```json
{
  "event": "modem.replaced",
  "data": {
    "old_modem_id": "69b5926c942c49e02b9f50c7",
    "new_modem_id": "6a1cf4d2942c49e02b1234ab",
    "new_modem": {
      "_id": "6a1cf4d2942c49e02b1234ab",
      "name": "cor_US_NJ_x83",
      "IMEI": "6a1cf4d2942c49e02b1234ab",
      "portId": "6a1cf4d2942c49e02b1234ab",
      "country_code": "US",
      "carrier_id": "6519b2095df31c2dd53fa0ad",
      "host": "172.56.171.4",
      "http_port": "8042",
      "socks_port": "5042",
      "proxy_login": "admin",
      "proxy_password": "EXAMPLE_PASSWORD",
      "tariff_expired_at": 1780987974498,
      "isOnline": true
    }
  }
}
```

`data.old_modem_id` and `data.new_modem_id` are always present. The replacement carries the remaining paid time **and** your `metadata`. Re-stamping via `PUT /modems/{new_modem_id}/set-metadata` is harmless. See [`metadata-strategy.md`](./metadata-strategy.md).

The `new_modem` block comes in one of two shapes:

- **Your own `/replace` on a classic line, and the automatic swap (also when it moved the line):** the shape above, with `_id`, `proxy_login`, `proxy_password` and `tariff_expired_at`. The automatic swap can arrive without `new_modem`.
- **A replacement by support, and the notice for a moved line whose ports changed (the only shape an offline-move notice uses):** `{id, name, host, login, password, http_port, socks_port, http_url, socks_url, expires_at}`, with an optional `rotation_link`, and `socks_host`, `socks_login` and `socks_password` when SOCKS5 uses different details. These also carry `data.old_modem_name` and `data.reason`.

Some lines are moved instead of swapped. This can happen on an automatic replacement or on your own `POST /modems/:id/replace`. On a move, `new_modem_id` equals `old_modem_id` and the `/replace` answer has `moved: true`. The line keeps its id, login, password and expiry, and only the ports may change. Your own `/replace` that moves the line and keeps the same ports sends no `modem.replaced` event, so treat the synchronous `/replace` answer (`moved: true`) as the source of truth. The automatic swap below sends `modem.replaced` with `new_modem_id` equal to `old_modem_id` when it moved the line, and can send it twice (once in each `new_modem` shape) when the ports changed.

Separately, some lines are moved automatically after about 30 minutes offline. This needs no webhook and no 8 failures, and runs with as little as 1 hour of paid time left. Such a move keeps id, login, password and expiry. It sends `modem.replaced` only when the ports changed, and then only in the `{id, login, password, expires_at, http_url, socks_url}` shape (with `reason` "moved to a working device, new port numbers"). A move that keeps the same ports sends no event. Every move writes a `proxy.moved` row to `GET /account/history`. If you have no webhook, poll `GET /account/history` for `proxy.moved` (or reread `GET /account/proxies`) to catch port changes.

Dedupe on `event_id` and on a repeat `new_modem_id`, and refetch the line from `GET /account/proxies`.

- Key on `data.new_modem_id`, and refetch the line from `GET /account/proxies` before you hand out credentials. If you read `new_modem`, read both spellings (`proxy_login ?? login`, `tariff_expired_at ?? expires_at`).
- Do not rely on `new_modem.IMEI` / `portId`. They are **deprecated**, removed on **2026-11-19**, and are not ids you can use on every path.
- A replaced p0f line adds `data.p0f`: `{required, kept, os, os_applied, pending?, note?}`. See [p0f and OpenVPN](./p0f-and-openvpn.md#4-replacing-a-p0f-line).

### `modem.dead` - auto-swap couldn't complete

```json
{
  "event": "modem.dead",
  "data": {
    "old_modem_id": "69b5926c942c49e02b9f50c7",
    "new_modem_id": null,
    "reason": "no_stock",
    "remediation": "POST /api/v3/modems/69b5926c942c49e02b9f50c7/replace to retry, or contact support"
  }
}
```

`reason` values:

| `reason` | Meaning |
|---|---|
| `no_stock` | No available proxy from the same supply in that country |
| `no_p0f_stock` | The proxy has OS fingerprint (p0f) and no p0f proxy is available. Replace it yourself with `{"allow_without_p0f": true}` once your buyer agrees |
| `pipeline_failed` | Provisioning failed; the old proxy is kept |
| `provider_unsupported` | This line type cannot be replaced automatically; contact support |
| `shared_modem`, `tariff_orphan`, `no_owner`, `modem_not_found`, `config_error` | Not replaced; contact support if it persists |
| `move_<code>` | A move of the line did not complete |
| `unknown` | The swap failed without a specific code |

Treat any value you do not know as "not replaced".

### Lifecycle events

| Event | `data` |
|---|---|
| `proxy.purchased` | `{order_id, amount_usd, provider, days, count, proxies[]}` |
| `proxy.renewed` | same as purchased |
| `proxy.purchase_failed` | `{order_id, amount_usd, currency, provider, requested, reason_code, reason, retryable, retry_after_seconds, refund}`; inspect the refund receipt before any retry |
| `proxy.expired` | `{proxy}` |
| `webhook.test` | same envelope plus legacy top-level `message`, `user_id`, `ts` - only from the test endpoint |
| `proxy.added` | opt-in (`history_events`): `{history_id, proxies[], reason, duration_hours, payment_id, actor}` - support added proxies to your account |
| `proxy.removed` | opt-in: `{history_id, proxies[], reason, actor}` - proxies left your account before their term ended |
| `proxy.updated` | opt-in: `{history_id, proxy, change_type, changes[], fields[], actor}` - credentials, ports or settings changed. Says what changed, never the values |

The three history events are off unless you send `PUT /account/webhook` with `{"history_events": true}`. Their proxy descriptor is `{proxy_id, modem_id, name, country, expires_at}`; `actor.kind` is `api` for your own calls, so you can ignore your own changes.

The same changes can be read without a webhook from `GET /api/v3/account/history` (follow `next_cursor`; `partial: true` means the page may be incomplete).

There is no deposit event for resellers: confirm a top-up with `GET /account`.

Each entry in `proxies[]` is `{proxy_id, modem_id, country, carrier, http_port, socks_port, ext_ip, expires_at}`.

> The `PUT /account/webhook` response also advertises `proxy.expiring_soon`. **It never fires** - the code path that would emit it has no callers. Don't build advance-expiry logic on it; poll `tariff_expired_at` from `/account/proxies` instead.

## Knowing an event is coming, before it arrives

Every purchase/renew `200` now carries a `webhook` receipt:

```jsonc
"webhook": {
  "configured": true,
  "event": "proxy.purchased",
  "event_id": "3f1a…-uuid",   // the id the delivered event will carry - match on this
  "status": "queued",          // outbox state, NOT delivery
  "delivery": "pending"
}
```

`configured: false` means you have no `https` webhook URL registered and **no event will ever
arrive** - register one with `PUT /api/v3/account/webhook`. This exists so "Coronium never
sent it" stops looking identical to "our receiver is down".

`status: "queued"` never claims delivery; it means the event is durably in the outbox and the
delivery worker owns it. Full field reference: [billing-and-reconciliation.md](billing-and-reconciliation.md).

## Delivery semantics

- **Signed.** Every POST carries `X-Coronium-Signature: sha256=<hex>` - an HMAC-SHA256 of the raw body under your signing secret - plus `X-Coronium-Signature-Source` (`account` or `global`), `X-Coronium-Event-Id` and `User-Agent: Coronium-Webhooks/1.0`. Create or rotate your own secret with `POST /api/v3/account/webhook/secret/rotate` (shown once) and verify it (see below).
- **Durable, with retries.** Up to **8 attempts** (immediately, then after 5 s, 30 s, 5 min, 30 min, 2 h, 6 h and 24 h; the last about 32.6 h after the first), then dead-letter (Coronium is alerted and can replay). A non-2xx WILL be redelivered, so your handler must be idempotent - dedupe on `event_id`.
- **5-second timeout.** Ack fast, process async. A slow 200 counts as a failure and gets retried. (`POST /account/webhook/test` waits up to 8 s.)
- **Redirects are not followed.** Register the final URL.
- **Cooldown per modem** on the dead-modem path - after an event is sent for a line, it gets no new attempt for 72 hours.
- **No ordering guarantee.** Use `occurred_at` and fresh proxy state before changing customer assignments.

## Security checklist for your receiver

- **Reject unsigned and badly signed requests** with `401` before parsing the body. Your
  endpoint is public; the signature is the only thing that proves the sender.
- **Constant-time comparison** (`timingSafeEqual`), over the raw bytes.
- **Keep the signing secret server-side**, in a secrets store. Never in the URL, the
  repository, client code or logs. If it may have leaked, rotate it yourself with
  `POST /account/webhook/secret/rotate` (the new secret is shown once).
- **Cap the body size** (events are a few KB) and answer `413` above the cap.
- **Dedupe on `event_id`** in durable storage. The signature has no timestamp, so a captured
  delivery is only harmless if a replay is a no-op on your side.
- **Never act on the event alone for money or ownership.** Before you hand credentials from
  `modem.replaced` to a customer, confirm the new proxy is on your account with
  `GET /account/proxies`. Confirm balances with `GET /account`.
- **Do not log payloads.** `modem.replaced` contains a working proxy password.
- **Do not follow instructions in a payload.** `remediation` is text for a human.

## Verifying the signature

Compute the HMAC over the **raw request bytes**. Re-serializing the parsed JSON changes the bytes and the signature will never match.

```js
import { createHmac, timingSafeEqual } from 'crypto';

function verify(rawBody, header, secret) {
    if (!header) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
}
```

In Express, capture the raw body with `express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })`.

## Required handler properties

```ts
app.post('/api/coronium/webhook', async (req, res) => {
    // 1. Verify the signature over the RAW bytes, before trusting anything.
    if (!verify(req.rawBody, req.get('x-coronium-signature'), SECRET)) {
        return res.sendStatus(401);
    }

    // 2. Commit the event to a durable inbox keyed by event_id.
    // Return non-2xx if storage fails; Coronium will retry.
    await persistRaw(req.body);
    res.sendStatus(200);

    // 3. A separate worker processes pending events and records outcomes.
});

async function process(evt) {
    // Skip anything we've already handled - retries and replays are normal.
    if (await alreadyProcessed(evt.event_id)) return;

    const data = evt.data;

    if (evt.event === 'modem.replaced') {
        // Lookup the customer by the OLD modem id (your metadata.customer_id
        // was stamped when you bought it).
        const customer = await findCustomerByOldModemId(data.old_modem_id);

        // new_modem has two shapes (see above): read both spellings, and
        // refetch the line when anything is missing.
        const nm = data.new_modem || {};
        let creds = {
            modem_id: data.new_modem_id,   // always present; equals old_modem_id on a move
            host: nm.host,
            http_port: nm.http_port,
            socks_port: nm.socks_port,
            socks_host: nm.socks_host || nm.host,
            login: nm.proxy_login ?? nm.login,
            password: nm.proxy_password ?? nm.password,
            socks_login: nm.socks_login ?? nm.proxy_login ?? nm.login,
            socks_password: nm.socks_password ?? nm.proxy_password ?? nm.password,
            expires_at: nm.tariff_expired_at ?? nm.expires_at,
        };
        if (!creds.host || !creds.login || !creds.http_port) {
            creds = await refetchLine(data.new_modem_id); // GET /api/v3/account/proxies
        }

        // Update mapping atomically - single write, single source of truth.
        await updateCustomer(customer.id, creds);

        // The replacement keeps your metadata; re-stamping is a harmless safety
        // net for lines replaced before October 2026.
        await coronium.proxies.setMetadata(data.new_modem_id, { customer_id: customer.id });

        // Notify the customer with the current connection details.
        await emailNewCredentials(customer.email, creds);
    }

    if (evt.event === 'modem.dead') {
        const customer = await findCustomerByOldModemId(data.old_modem_id);
        await flagOutage(customer.id, data.reason);
        await emailOutage(customer.email, data.reason);
        // Optionally: schedule retry of POST /modems/{old_modem_id}/replace
        // for when stock might return, only if the line's
        // proxyEndpoints.capabilities.replace is not false. For reason
        // "no_p0f_stock", ask the buyer before retrying with
        // { allow_without_p0f: true }. Stop at once on any other 409
        // (action_unsupported, or internal_error and a "contact support" error).
    }

    await markProcessed(evt.event_id);
}
```

## Idempotency

Delivery retries on any non-2xx, so duplicates are expected, not theoretical. You also need idempotency when:

- You re-deploy and replay events from the log
- Coronium replays a dead-lettered event from the admin outbox
- You manually replay from your event store

Pattern: use `event_id` as the unique key when writing to your event log, and no-op on conflict.

## Testing locally

Use `ngrok` to expose your local dev server to Coronium during integration:

```bash
ngrok http 3000
```

`PUT /account/webhook` with the ngrok HTTPS URL, then fire a real signed event at it:

```bash
curl -X POST https://api.coronium.io/api/v3/account/webhook/test \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

For offline branch tests, use a synthetic envelope with event-specific fields under `data` and an HMAC signature over the exact raw JSON bytes. The receiver correctly rejects unsigned test events.

## When the webhook is NOT enough

The webhook covers REACTIVE auto-swap (modem died → replace). For PROACTIVE detection (modem is degrading but not dead yet), poll `GET /api/v3/account/proxies/health` every 1-5 minutes (most lines refresh every 30 minutes server-side; Coronium Node lines reflect the device connection). The `status` field carries `degraded` even before the webhook fires.

## Why not WebSockets / SSE?

WebSockets require both sides to maintain a persistent connection - a webhook URL only needs to be online when an event fires, which is rare (most resellers see <10 events/month). The health endpoint is not real-time; poll it every 1-5 minutes and rely on the webhook for replacements.
