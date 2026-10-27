# Paste this into Claude Code (or Cursor, Windsurf, Aider)

```
Read the AGENTS.md at https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and use https://github.com/bolivian-peru/coronium-reseller-kit/tree/main/examples/nextjs-dashboard
as the foundation. Scaffold me a reseller dashboard for Coronium mobile 4G/5G
proxies with these features (skip any I don't list):

- Customer list (CRUD on end-customers stored locally)
- Buy proxies on a customer's behalf - pick country/carrier, attach customer_id
  via the metadata field, show resulting credentials
- Per-customer detail page with their proxies + health status + credential copy
- Signed webhook handler at /api/coronium/webhook: verify HMAC, persist by
  event_id, then ack 200. A durable worker reconciles replacements and flags
  modem.dead or purchase-failed events for operator review.
- Health overview: poll /account/proxies/health at most every 60s (it is not real-time; most lines refresh every 30 min), highlight dead modems
- API-only integration instructions: Bearer authentication, account balances,
  tariff stock with X-Coronium-Proxy-Credentials: separate-protocol-v1 on stock
  and purchase calls, renewal quote, renewal, separate HTTP/SOCKS5 endpoints,
  idempotency, and the raw Swagger reference at https://dashboard.coronium.io/api-docs/

My CORONIUM_API_KEY is in .env. Deploy target: a self-hosted persistent volume.
Use Next.js App Router, TypeScript, Tailwind, operator authentication, and a
durable webhook inbox. Keep it minimal and readable. Run build and read-only
integration checks. Ask me before a live purchase that spends my balance.
```

## Variants

**For a one-shot CLI reseller** (no UI, just commands):

```
Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and https://dashboard.coronium.io/api-docs/. Build a Node CLI directly against
the REST API using Bearer auth and server-side secrets. It should list tariffs,
show account credit and BTC separately, buy with a stable Idempotency-Key,
quote and renew an owned modem, and display separate HTTP/SOCKS5 endpoints
separately. Store customer mappings durably. No dashboard is required.
```

**For a Telegram-bot reseller**:

```
Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and build me a Telegram bot that takes /buy and /rotate commands. Customer
identity = Telegram user_id. Use Telegraf for the bot, and call the API through
the typed client in examples/nextjs-dashboard/lib/coronium.ts (server-side only,
the same client AGENTS.md uses). For /rotate follow AGENTS.md rule 8 and the
failure table: 200 rotated:true/false on classic lines; 202 pending:true -> poll
rotation-status, never resubmit; 429 -> wait Retry-After; a 409 on a line with
proxyEndpoints -> branch on code + suggested_action, never on the status alone,
and if the error says the last rotation is under review, tell the user and stop.
Crypto payment: end-customers pay me in my own wallet (TON or USDT-TRC20). Do
not automate funding Coronium and never send funds on-chain from my wallet.
Coronium has no top-up API. I fund my Coronium balance myself, as account credit
(dashboard) or BTC (deposit address from GET /account/crypto-balance). USDT
deposited at Coronium is not spent by the API purchase routes. Before each buy,
read GET /account and use buy-with-account-credit (accountCredit) or
buy-modems-with-crypto-balance (BTC only). Buy only after I approve the quoted
total, and send that approved total as max_total_usd on the buy (and the
renewal-quote total_usd on a renewal). A 409 price_changed means nothing was
charged: show me quote.total_usd and ask again. A 409 duplicate_request is not a
reason to use a new Idempotency-Key; a 202 with paymentId is charged and still
provisioning, not a failure.
```

**For a webhook-only integration** (reseller already has a CRM, just wants the auto-swap event flow):

```
Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
(webhook contract) and examples/webhook-receiver/, then graft a handler into my
existing Express app at /api/coronium/webhook. The handler verifies
X-Coronium-Signature over the raw body, persists the event keyed by event_id and
acks 200 within 5 s (non-2xx only if storage fails). A separate idempotent worker
then processes the inbox: map data.old_modem_id -> data.new_modem_id on my Stripe
customer (store the modem _id, never the proxy password), refetch the line from
GET /account/proxies for the current connection details, re-stamp metadata on the
new modem, notify my customer through my own channel, and handle modem.dead
reasons including no_p0f_stock.
```

## After Claude finishes

It should show a local URL and pass its build and read-only checks. For a paid
end-to-end test, authorize one purchase, verify both protocols with the returned
credentials, and inspect the billing receipt. Use a persistent host for SQLite;
serverless needs a different durable store. Register the public signed webhook URL.
