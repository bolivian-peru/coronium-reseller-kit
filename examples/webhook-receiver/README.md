# Standalone signed webhook inbox

This Express example verifies Coronium's HMAC signature and appends each unique `event_id` to a durable JSONL file **before** acknowledging delivery. It is an event receiver, not a complete customer CRM or notification worker.

```bash
npm ci
CORONIUM_WEBHOOK_SECRET=<signing-secret-from-support> \
LOG_FILE=/persistent-volume/coronium-events.log node server.js
```

Expose `/coronium/webhook` through HTTPS and register that exact public URL with `PUT /api/v3/account/webhook`. Then call `POST /api/v3/account/webhook/test` using your Bearer API key. The signature secret is required even for local testing; do not put a secret in the URL. A 200 means the event was stored, **not** that your customers were updated.

Build a separate idempotent consumer for the JSONL inbox. For `modem.replaced`, use `data.old_modem_id` to find your end-customer, update the assignment, re-stamp the replacement's metadata and notify the customer of new credentials. For `modem.dead` and `proxy.purchase_failed`, open a service review. Keep the event log and consumer state on persistent storage, replay unprocessed events after restarts, and back them up. The included `processEvent` only logs examples; it does not perform those business actions.
