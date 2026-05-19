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
- Webhook handler at /api/coronium/webhook that processes modem.replaced and
  modem.dead events — update local mapping, log event, ack 200 immediately
- Health overview: poll /account/proxies/health every 60s, highlight dead modems

My CORONIUM_API_KEY is in .env. Deploy target: Vercel. Use Next.js App Router,
TypeScript, Tailwind. Don't invent features I didn't ask for — keep it
minimal and readable. End by running `npm run dev`, opening the browser, and
buying ONE proxy to verify the end-to-end loop works.
```

## Variants

**For a one-shot CLI reseller** (no UI, just commands):

```
Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and build me a Node CLI that lets me buy/rotate/replace Coronium proxies on
behalf of named customers. Store customers in a local JSON file. Use
coronium-sdk. Skip the webhook handler. Target ergonomics: `cor buy us
acme-007 --count 5`.
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

It'll show you a local URL. Open it. Do one test buy. If credentials show up in your dashboard AND the proxy actually proxies traffic (curl through it to `ipify.org`), you're done. Push to Vercel. Tell the bot the new URL so it registers your webhook.
