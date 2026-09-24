# Paste this into Claude Code (or Cursor, Windsurf, Aider)

```
Read the AGENTS.md at https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and use https://github.com/bolivian-peru/coronium-reseller-kit/tree/main/examples/nextjs-dashboard
as the foundation. Scaffold me a reseller dashboard for Coronium mobile 4G/5G
proxies with these features (skip any I don't list):

- Customer list (CRUD on end-customers stored locally)
- Buy proxies on a customer's behalf — pick country/carrier, attach customer_id
  via the metadata field, show resulting credentials
- Per-customer detail page with their proxies + health status + credential copy
- Signed webhook handler at /api/coronium/webhook: verify HMAC, persist by
  event_id, then ack 200. A durable worker reconciles replacements and flags
  modem.dead or purchase-failed events for operator review.
- Health overview: poll /account/proxies/health every 60s, highlight dead modems
- API-only integration instructions: Bearer authentication, account balances,
  tariff stock, purchase, renewal quote, renewal, separate PocketProxy endpoints,
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
quote and renew an owned modem, and display PocketProxy HTTP/SOCKS5 endpoints
separately. Store customer mappings durably. No dashboard is required.
```

**For a Telegram-bot reseller**:

```
Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and build me a Telegram bot that takes /buy and /rotate commands. Customer
identity = Telegram user_id. Use Telegraf for the bot, coronium-sdk for the
API. Crypto payment: accept TON or USDT-TRC20 directly to my wallet, then
top up my Coronium balance with the net.
```

**For a webhook-only integration** (reseller already has a CRM, just wants the auto-swap event flow):

```
Read https://github.com/bolivian-peru/coronium-reseller-kit/blob/main/examples/webhook-receiver/
and graft the modem.replaced + modem.dead handlers into my existing Express
app at /api/coronium/webhook. The handler should update my CRM (Stripe
customer metadata) with the new modem credentials atomically.
```

## After Claude finishes

It should show a local URL and pass its build and read-only checks. For a paid
end-to-end test, authorize one purchase, verify both protocols with the returned
credentials, and inspect the billing receipt. Use a persistent host for SQLite;
serverless needs a different durable store. Register the public signed webhook URL.
