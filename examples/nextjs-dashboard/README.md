# Coronium reseller operator dashboard

This self-hosted Next.js example uses the current Coronium v3 API. It handles account credit or BTC purchases, explicit renewals with a server price quote, separate PocketProxy HTTP/SOCKS5 credentials, and a signed webhook inbox. It is an **operator dashboard**, not an end-customer portal or retail checkout.

## Run

Use Node 20 or later and a persistent, writable disk. Copy `.env.example` to `.env` and set `CORONIUM_API_KEY`, `RESELLER_ADMIN_USER`, `RESELLER_ADMIN_PASSWORD`, and `CORONIUM_WEBHOOK_SECRET`. Keep `.env` outside source control.

```bash
npm ci
npm run build
npm run start       # terminal 1
npm run worker      # terminal 2; required for webhook reconciliation
```

Put an HTTPS reverse proxy in front of the dashboard. The Basic-auth operator login protects every page and API route except the signed webhook receiver. Use a long unique password. Back up `data/reseller.db` and its SQLite WAL files together. Run one Next.js instance against the SQLite file; multiple instances need a shared database and coordinated workers.

**Do not deploy this SQLite example unchanged to Vercel or another ephemeral serverless filesystem.** Its customer mappings and webhook inbox must survive restarts and retries. Use a persistent VM/container volume, or replace the storage layer with a durable database before serverless deployment.

## Connect the webhook

Ask Coronium support for your account's webhook signing secret and put it in `.env`. Register the final public HTTPS URL, without a query-string secret:

```bash
curl -X PUT https://api.coronium.io/api/v3/account/webhook \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"webhook_url":"https://YOUR-HOST/api/coronium/webhook"}'

curl -X POST https://api.coronium.io/api/v3/account/webhook/test \
  -H "Authorization: Bearer $CORONIUM_API_KEY"
```

The receiver verifies the raw-body HMAC, writes each `event_id` once to SQLite, then acknowledges it. `npm run worker` polls the local protected reconciliation route every 30 seconds. It re-stamps `metadata` on an auto-swap replacement using the durable local modem/customer map. Failed purchases and dead modems stay visible as **review** events; you must contact affected customers. A replacement also changes connection details: notify the end-customer through your own CRM or messaging workflow. This example does not send customer email.

Before enabling webhooks for an existing reseller account, run the worker once while the old modems are still present, so it can backfill local assignments from `metadata.customer_id`. Modems without that tag need manual mapping before automatic replacement reconciliation can identify their customers.

## Money and API safety

The buy page shows an estimated tariff price; Coronium's `billing` response is the actual charge. The renewal UI fetches `POST /payment/renewal-quote` and requires a fresh confirmed price before charging. It does not turn on recurring auto-renew. Both payment lanes send an `Idempotency-Key` and keep the same key after a timeout or ambiguous response. Check Coronium's account and payment state before creating a new intent after an uncertain result.

`X-Coronium-Proxy-Credentials: separate-protocol-v1` opts this client into PocketProxy stock. For those proxies, `proxyEndpoints.http` and `.socks5` can carry different hosts and credentials; the customer page displays each separately. The legacy credential fields are HTTP compatibility fields and must not be reused for SOCKS5.

Do not use this sample as a public customer login. Add tenant authentication, retail billing, notifications, and a durable shared database before offering it to end-customers.
