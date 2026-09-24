# Webhook integration

The auto-swap event flow — the most important integration for a reseller.

## What problem this solves

Mobile modems fail. Phones overheat, SIMs deactivate, carrier networks reroute, ProxySmart hosts go offline. Without auto-swap, your customers experience random outages and blame you.

With the Coronium webhook flow:

1. Coronium detects an eligible failed modem with remaining paid time
2. If the provider and stock support replacement, Coronium provisions a replacement
3. The original `tariff_expired_at` is transferred — your customer doesn't lose paid time
4. The old modem is quarantined to a system bucket
5. Coronium POSTs an event to your webhook URL with old + new modem IDs and full credentials
6. Your handler updates the customer's record with the new credentials
7. You notify the customer that credentials have changed

This is conditional on provider capability and available stock. Do not promise a fixed recovery time.

## Registering your webhook URL

One-time setup per Coronium account:

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://your-host/api/coronium/webhook"}'
```

`webhook_url` must be **HTTPS** (HTTP returns 400). Max length 500 chars. The target must be a public host: internal, private and non-resolving addresses are rejected with `code: "invalid_webhook_target"`. Use the HMAC signature for authentication, not a secret in the URL.

Disable later with `{"webhook_url": null}`.

## Verify your endpoint before you rely on it

```bash
curl -X POST https://api.coronium.io/api/v3/account/webhook/test \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

This POSTs a real signed `webhook.test` event to your registered URL **synchronously** and returns the actual delivery outcome — the HTTP status your endpoint replied with, plus latency. Run it on every deploy. Without it, "we never get events" is indistinguishable from "our endpoint has been 500ing for a month".

## The envelope — every event has the same shape

```json
{
  "event_id": "3f1a…-uuid",
  "event": "modem.replaced",
  "occurred_at": "2026-07-25T08:34:53.000Z",
  "account": { "user_id": "6600aa…", "email": "you@example.com" },
  "data": { }
}
```

**Event-specific fields live under `data`.** Reading `body.old_modem_id` returns `undefined` — it is `body.data.old_modem_id`. Dedupe on `event_id`.

## Event types

### `modem.replaced` — auto-swap succeeded

```json
{
  "event": "modem.replaced",
  "data": {
    "old_modem_id": "69b5926c942c49e02b9f50c7",
    "new_modem_id": "6a1cf4d2942c49e02b1234ab",
    "new_modem": {
      "_id": "6a1cf4d2942c49e02b1234ab",
      "name": "cor_US_NJ_x83",
      "IMEI": "EXAMPLE_IMEI_PLACEHOLDER",
      "portId": "cor_US_…",
      "country_code": "US",
      "carrier_id": "6519b2095df31c2dd53fa0ad",
      "host": "172.56.171.4",
      "http_port": "8042",
      "socks_port": "5042",
      "proxy_login": "admin",
      "proxy_password": "kP3aL9zXq7Wm",
      "tariff_expired_at": 1780987974498,
      "isOnline": true
    }
  }
}
```

The replacement carries the remaining paid time — but **not** the original's `metadata`. Re-stamp it via `PUT /modems/{new_modem_id}/set-metadata` or the proxy loses its customer tag. See [`metadata-strategy.md`](./metadata-strategy.md).

### `modem.dead` — auto-swap couldn't complete

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

`reason` values: `no_stock`, `pipeline_failed`, `shared_modem`, `tariff_orphan`, `modem_not_found`, `unknown`.

### Lifecycle events

| Event | `data` |
|---|---|
| `proxy.purchased` | `{order_id, amount_usd, provider, days, count, proxies[]}` |
| `proxy.renewed` | same as purchased |
| `proxy.purchase_failed` | `{order_id, amount_usd, requested, reason_code, reason, retryable, retry_after_seconds, refund}`; inspect the refund receipt before any retry |
| `proxy.expired` | `{proxy}` |
| `deposit.confirmed` | `{amount_usd, provider, external_id}` — a balance top-up cleared |
| `webhook.test` | `{message}` — only from the test endpoint |

Each entry in `proxies[]` is `{proxy_id, modem_id, country, carrier, http_port, socks_port, ext_ip, expires_at}`.

> The `PUT /account/webhook` response also advertises `proxy.expiring_soon`. **It never fires** — the code path that would emit it has no callers. Don't build advance-expiry logic on it; poll `tariff_expired_at` from `/account/proxies` instead.

## Knowing an event is coming, before it arrives

Every purchase/renew `200` now carries a `webhook` receipt:

```jsonc
"webhook": {
  "configured": true,
  "event": "proxy.purchased",
  "event_id": "3f1a…-uuid",   // the id the delivered event will carry — match on this
  "status": "queued",          // outbox state, NOT delivery
  "delivery": "pending"
}
```

`configured: false` means you have no `https` webhook URL registered and **no event will ever
arrive** — register one with `PUT /api/v3/account/webhook`. This exists so "Coronium never
sent it" stops looking identical to "our receiver is down".

`status: "queued"` never claims delivery; it means the event is durably in the outbox and the
delivery worker owns it. Full field reference: [billing-and-reconciliation.md](billing-and-reconciliation.md).

## Delivery semantics

- **Signed.** Every POST carries `X-Coronium-Signature: sha256=<hex>` — an HMAC-SHA256 of the raw body under your signing secret — plus `X-Coronium-Event-Id`. Ask support for your secret and verify it (see below).
- **Durable, with retries.** Up to **8 attempts** with escalating backoff, then dead-letter (Coronium is alerted and can replay). A non-2xx WILL be redelivered, so your handler must be idempotent — dedupe on `event_id`.
- **5-second timeout.** Ack fast, process async. A slow 200 counts as a failure and gets retried.
- **Redirects are not followed.** Register the final URL.
- **Cooldown per modem** on the dead-modem path — you won't get two swap events for the same modem back-to-back.
- **No ordering guarantee.** Use `occurred_at` and fresh proxy state before changing customer assignments.

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
    // Skip anything we've already handled — retries and replays are normal.
    if (await alreadyProcessed(evt.event_id)) return;

    const data = evt.data;

    if (evt.event === 'modem.replaced') {
        // Lookup the customer by the OLD modem id (your metadata.customer_id
        // was stamped when you bought it).
        const customer = await findCustomerByOldModemId(data.old_modem_id);

        // Update mapping atomically — single write, single source of truth.
        await updateCustomer(customer.id, {
            modem_id: data.new_modem_id,
            host: data.new_modem.host,
            http_port: data.new_modem.http_port,
            socks_port: data.new_modem.socks_port,
            proxy_login: data.new_modem.proxy_login,
            proxy_password: data.new_modem.proxy_password,
            tariff_expired_at: data.new_modem.tariff_expired_at,
        });

        // The replacement has no metadata — re-stamp it so /account/proxies
        // still tells you who owns this proxy.
        await coronium.proxies.setMetadata(data.new_modem_id, { customer_id: customer.id });

        // Notify the customer.
        await emailNewCredentials(customer.email, data.new_modem);
    }

    if (evt.event === 'modem.dead') {
        const customer = await findCustomerByOldModemId(data.old_modem_id);
        await flagOutage(customer.id, data.reason);
        await emailOutage(customer.email, data.reason);
        // Optionally: schedule retry of POST /modems/{old_modem_id}/replace
        // for when stock might return.
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

The webhook covers REACTIVE auto-swap (modem died → replace). For PROACTIVE detection (modem is degrading but not dead yet), poll `GET /api/v3/account/proxies/health` every 5 minutes. The `status` field carries `degraded` even before the webhook fires.

## Why not WebSockets / SSE?

WebSockets require both sides to maintain a persistent connection — a webhook URL only needs to be online when an event fires, which is rare (most resellers see <10 events/month). For events that need real-time push (sub-second), use the `/account/proxies/health` polling path with a 30s interval.
