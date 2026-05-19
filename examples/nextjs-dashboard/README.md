# Coronium Reseller Dashboard — Next.js example

The reference reseller dashboard. ~700 lines of TypeScript, deploys to Vercel in one command.

## Run locally

```bash
cp .env.example .env
# Paste your CORONIUM_API_KEY from https://dashboard.coronium.io → Settings → API
npm install
npm run dev
open http://localhost:3000
```

## What it does

| Page | What |
|---|---|
| `/` | Dashboard — proxy inventory grouped by end-customer, with live health overlay |
| `/customers` | CRUD for your end-customers (stored in local SQLite) |
| `/customers/{id}` | One customer's proxies + credentials |
| `/buy` | Buy proxies on a customer's behalf — country picker, in-stock tariffs only, attaches `customer_id` to `metadata` |
| `/events` | Webhook event log (auto-swap notifications from Coronium) |

| Server route | What |
|---|---|
| `POST /api/coronium/webhook` | Receives `modem.replaced` + `modem.dead` events. Persists raw event + dispatches to your custom handler. |
| `POST /api/coronium/buy` | Server-side buy. Validates customer exists locally before charging your balance. |
| `GET /api/coronium/proxies` | Pass-through list. |
| `GET /api/coronium/health` | Pass-through health snapshot. |
| `GET /api/coronium/tariffs` | Pass-through available tariffs. |
| `POST /api/customers` · `GET` · `DELETE` | CRUD on the local customer table. |

## Architecture

```
Browser ──► Your Next.js dashboard ──► /api/coronium/* (server) ──► api.coronium.io/api/v3
                                          │
                                          └── SQLite (your end-customer table only)

Coronium ──► POST /api/coronium/webhook ──► persisted + your handler
```

`CORONIUM_API_KEY` lives only in the server. Browser code never sees it.

## Deploy to Vercel

```bash
vercel deploy
```

Add `CORONIUM_API_KEY` and optional `WEBHOOK_SECRET` in the Vercel project settings → Environment Variables. After first deploy, register your webhook URL with Coronium:

```bash
curl -X PUT "https://api.coronium.io/api/v3/account/webhook" \
    -H "Authorization: Bearer $CORONIUM_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"webhook_url\": \"https://your-app.vercel.app/api/coronium/webhook?key=$WEBHOOK_SECRET\"}"
```

The `?key=$WEBHOOK_SECRET` is optional — the webhook route enforces it if you set `WEBHOOK_SECRET` in env. Without that env var the route accepts all POSTs (rely on URL obscurity instead — fine for an MVP, add HMAC for production).

## Customizing

This is a **foundation**, not a finished product. Most resellers will want to:

- Replace SQLite with Postgres / KV when they outgrow it
- Add their own auth on `/customers/*` so customers can self-serve
- Add a per-customer dashboard URL where customers see their own proxies
- Add billing — Stripe / crypto on top of your retail price (the Coronium API only handles wholesale)
- Add IP rotation history per modem
- Add bulk operations (rotate-all, replace-all-dead)

Use the AI prompt in the repo's `PROMPT.md` to scaffold these on top.
