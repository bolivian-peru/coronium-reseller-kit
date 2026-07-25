# Coronium webhook receiver — standalone Node + Express

Small server that demonstrates the Coronium account-event flow without any UI framework.

## Run

```bash
npm install
CORONIUM_API_KEY=eyJ... \
  WEBHOOK_SECRET=$(openssl rand -hex 32) \
  CORONIUM_WEBHOOK_SECRET=<ask support for your signing secret> \
  node server.js
```

`WEBHOOK_SECRET` is your own value in the URL query string. `CORONIUM_WEBHOOK_SECRET` is the shared secret Coronium signs with — set it and the server verifies `X-Coronium-Signature` before trusting any payload.

## Register with Coronium

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"webhook_url\":\"https://your.host/coronium/webhook?key=$WEBHOOK_SECRET\"}"
```

## Test

Best test — ask Coronium to POST a real signed event at your registered URL:

```bash
curl -X POST https://api.coronium.io/api/v3/account/webhook/test \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

The response carries the actual delivery result (HTTP status your endpoint returned + latency), so a misconfigured receiver fails loudly here instead of silently months later.

To trigger a fake event locally, mirror the real envelope — the event fields live under `data`, not at the top level:

```bash
curl -X POST "http://localhost:3001/coronium/webhook?key=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "11111111-2222-3333-4444-555555555555",
    "event": "modem.replaced",
    "occurred_at": "2026-07-25T08:34:53.000Z",
    "account": { "user_id": "6600aa...", "email": "you@example.com" },
    "data": {
      "old_modem_id": "test-old",
      "new_modem_id": "test-new",
      "new_modem": {
        "host": "172.56.171.4",
        "http_port": "8042",
        "socks_port": "5042",
        "proxy_login": "admin",
        "proxy_password": "kP3aL9zXq7Wm",
        "tariff_expired_at": 1780987974498,
        "isOnline": true
      }
    }
  }'
```

Unset `CORONIUM_WEBHOOK_SECRET` for this local test, or the unsigned request is correctly rejected with 401.

You should see the event logged to stdout AND appended to `coronium-events.log`. Then plug your CRM / Stripe / email logic into the `processEvent` function in `server.js`.
