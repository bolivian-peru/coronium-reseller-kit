# Webhook integration

The auto-swap event flow — the most important integration for a reseller.

## What problem this solves

Mobile modems fail. Phones overheat, SIMs deactivate, carrier networks reroute, ProxySmart hosts go offline. Without auto-swap, your customers experience random outages and blame you.

With the Coronium webhook flow:

1. Coronium's `CustomerModemHealthChecker` detects a modem with 5+ consecutive failed health checks AND remaining paid time
2. Coronium auto-provisions a same-country, same-carrier replacement (carrier-matched first, country-only fallback)
3. The original `tariff_expired_at` is transferred — your customer doesn't lose paid time
4. The old modem is quarantined to a system bucket
5. Coronium POSTs an event to your webhook URL with old + new modem IDs and full credentials
6. Your handler updates the customer's record with the new credentials
7. You email or notify the customer

All within ~45 minutes of the first failed health check (P95).

## Registering your webhook URL

One-time setup per Coronium account:

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://your-host/api/coronium/webhook?key=<your-secret>"}'
```

`webhook_url` must be **HTTPS** (HTTP returns 400). Max length 500 chars. Path / query string is freeform — use it for shared secrets or routing.

Disable later with `{"webhook_url": null}`.

## Event types (v1)

### `modem.replaced` — auto-swap succeeded

```json
{
  "event": "modem.replaced",
  "old_modem_id": "69b5926c942c49e02b9f50c7",
  "new_modem_id": "6a1cf4d2942c49e02b1234ab",
  "new_modem": {
    "_id": "6a1cf4d2942c49e02b1234ab",
    "name": "cor_US_NJ_x83",
    "IMEI": "071735191220045",
    "country_code": "US",
    "carrier_id": "6519b2095df31c2dd53fa0ad",
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

### `modem.dead` — auto-swap couldn't complete

```json
{
  "event": "modem.dead",
  "old_modem_id": "69b5926c942c49e02b9f50c7",
  "new_modem_id": null,
  "reason": "no_stock",
  "remediation": "POST /api/v3/modems/69b5926c942c49e02b9f50c7/replace later",
  "ts": 1779192208000
}
```

`reason` values: `no_stock`, `pipeline_failed`, `shared_modem`, `tariff_orphan`, `modem_not_found`, `unknown`.

## Delivery semantics (v1)

- **One POST per event.** No retries.
- **5-second timeout.** Ack 200 fast or you miss it (email fallback still fires).
- **No HMAC signature in v1.** Bind your endpoint behind a shared secret in the URL itself (`?key=...`). HMAC header is on the roadmap; open a GitHub issue if you need it for your security review.
- **Cooldown 24h per modem.** We don't fire two events for the same modem within 24 hours.
- **No event ordering guarantee.** Use `ts` (epoch ms) to detect out-of-order delivery; the latest one wins.

## Required handler properties

```ts
app.post('/api/coronium/webhook', async (req, res) => {
    // 1. ACK FIRST. Don't block on processing.
    res.sendStatus(200);

    // 2. Persist the raw event (replay safety)
    await persistRaw(req.body);

    // 3. Process async — never re-throw inside this handler
    queueMicrotask(() => process(req.body).catch(logErr));
});

async function process(evt) {
    if (evt.event === 'modem.replaced') {
        // Lookup the customer by the OLD modem id (your metadata.customer_id
        // was stamped when you bought it).
        const customer = await findCustomerByOldModemId(evt.old_modem_id);

        // Update mapping atomically — single write, single source of truth.
        await updateCustomer(customer.id, {
            modem_id: evt.new_modem_id,
            host: evt.new_modem.host,
            http_port: evt.new_modem.http_port,
            socks_port: evt.new_modem.socks_port,
            proxy_login: evt.new_modem.proxy_login,
            proxy_password: evt.new_modem.proxy_password,
            tariff_expired_at: evt.new_modem.tariff_expired_at,
        });

        // Notify the customer.
        await emailNewCredentials(customer.email, evt.new_modem);
    }

    if (evt.event === 'modem.dead') {
        const customer = await findCustomerByOldModemId(evt.old_modem_id);
        await flagOutage(customer.id, evt.reason);
        await emailOutage(customer.email, evt.reason);
        // Optionally: schedule retry of POST /modems/{old_modem_id}/replace
        // for when stock might return.
    }
}
```

## Idempotency

Coronium's cooldown prevents back-to-back duplicate events, but you should still be idempotent in case:

- You re-deploy and replay events from the log
- Network glitches cause our delivery to retry (theoretical — v1 doesn't, but assume it might in v2)
- You manually replay from your event store

Pattern: use `(event, old_modem_id, ts)` as a unique key when writing to your event log.

## Testing locally

Use `ngrok` to expose your local dev server to Coronium during integration:

```bash
ngrok http 3000
```

Then `PUT /account/webhook` with the ngrok HTTPS URL, plug a dongle into your test ProxySmart server, let it sit until health checks accumulate failures. Or — easier — manually POST a fake event:

```bash
curl -X POST http://localhost:3000/api/coronium/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "modem.replaced",
    "old_modem_id": "test-old",
    "new_modem_id": "test-new",
    "new_modem": { "host": "test", "http_port": "8000", "socks_port": "5000", "proxy_login": "u", "proxy_password": "p", "tariff_expired_at": 9999999999, "isOnline": true },
    "ts": 1
  }'
```

## When the webhook is NOT enough

The webhook covers REACTIVE auto-swap (modem died → replace). For PROACTIVE detection (modem is degrading but not dead yet), poll `GET /api/v3/account/proxies/health` every 5 minutes. The `status` field carries `degraded` even before the webhook fires.

## Why not WebSockets / SSE?

WebSockets require both sides to maintain a persistent connection — a webhook URL only needs to be online when an event fires, which is rare (most resellers see <10 events/month). For events that need real-time push (sub-second), use the `/account/proxies/health` polling path with a 30s interval.
