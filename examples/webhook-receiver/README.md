# Coronium webhook receiver — standalone Node + Express

50-line server that demonstrates the `modem.replaced` + `modem.dead` event flow without any UI framework.

## Run

```bash
npm install
CORONIUM_API_KEY=eyJ... WEBHOOK_SECRET=$(openssl rand -hex 32) node server.js
```

## Register with Coronium

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"webhook_url\":\"https://your.host/coronium/webhook?key=$WEBHOOK_SECRET\"}"
```

## Test

Trigger a fake event locally:

```bash
curl -X POST "http://localhost:3001/coronium/webhook?key=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "modem.replaced",
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
    },
    "ts": 1779192208000
  }'
```

You should see the event logged to stdout AND appended to `coronium-events.log`. Then plug your CRM / Stripe / email logic into the `processEvent` function in `server.js`.
