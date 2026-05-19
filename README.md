# Coronium Reseller Kit

> Build your mobile-proxy reseller business with Claude Code in 30 minutes.

This repo is the **starting point** for anyone reselling Coronium mobile 4G/5G proxies to their own end customers. It contains:

- A working **Next.js dashboard** example you can deploy as-is (`examples/nextjs-dashboard`)
- A standalone **webhook receiver** showing the auto-swap + end-customer-mapping pattern (`examples/webhook-receiver`)
- AI-agent-readable docs (`AGENTS.md`, `llms.txt`) so Claude Code / Cursor / Windsurf can scaffold a custom dashboard for you in one prompt
- The exact paste-into-Claude-Code prompt (`PROMPT.md`)

## Quickstart (30 seconds)

1. **Get your Coronium API key** — sign up at <https://dashboard.coronium.io>, top up, then `Settings → API`.
2. **Paste this into Claude Code** (or Cursor, or Windsurf):

   ```
   Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
   and then scaffold me a Next.js reseller dashboard for Coronium mobile proxies,
   using the example in examples/nextjs-dashboard as the foundation. My
   CORONIUM_API_KEY is in .env. I want: a customer list, ability to buy proxies
   on customers' behalf, and a webhook handler that auto-swaps dead modems.
   ```

3. **Done.** AI scaffolds the dashboard against the real API, you push to Vercel, you have a reseller business.

## Or, manually

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/nextjs-dashboard
cp .env.example .env  # paste your CORONIUM_API_KEY
npm install && npm run dev
open http://localhost:3000
```

## What the API gives you

| Endpoint | Purpose |
|---|---|
| `GET /api/v3/account/proxies` | List proxies you own |
| `GET /api/v3/account/proxies/health` | Per-proxy liveness — skip dead ones before customers hit them |
| `POST /api/v3/payment/buy-modems-with-crypto-balance` | Buy proxies (charged to your prepaid USD balance) |
| `POST /api/v3/modems/{id}/restart` | Rotate IP on a proxy |
| `POST /api/v3/modems/{id}/replace` | Swap a broken proxy for a fresh one (same country, transferred subscription time) |
| `PUT /api/v3/account/webhook` | Register HTTPS webhook for auto-swap events |

Full API: <https://dashboard.coronium.io/api-docs/> · Reseller spec: <https://github.com/bolivian-peru/coronium-new-app/blob/main/CORONIUM_RESELLER_API.md>

## The `metadata` field — your customer-mapping layer

Every modem has a freeform `metadata` JSON field you control. Use it to map our `modem_id` to your end-customer in your own DB, without needing a sidecar:

```json
POST /api/v3/payment/buy-modems-with-crypto-balance
{
  "tariff_id": "...",
  "modemCount": 1,
  "metadata": { "customer_id": "acme-007", "tag": "tiktok-batch" }
}
```

Then `GET /account/proxies` returns the same `metadata` on every proxy. You never need a separate database to track who owns what. See `docs/metadata-strategy.md`.

## Auto-swap on hardware failure

When a modem you've sold to a customer dies, our backend auto-swaps it to a fresh same-country replacement (with transferred subscription time) and POSTs to your webhook URL:

```json
{
  "event": "modem.replaced",
  "old_modem_id": "...",
  "new_modem_id": "...",
  "new_modem": { "host": "...", "http_port": "...", "proxy_login": "...", "proxy_password": "...", ... },
  "ts": 1779192208000
}
```

Your code updates its mapping and your customer never sees the outage. See `docs/webhook-integration.md` and `examples/webhook-receiver`.

## Pricing markup

The wholesale price is what you pay Coronium. Retail markup is yours — we recommend 1.5× – 3× depending on geo and your support quality. See `docs/pricing-markup.md`.

## License

MIT — fork it, change it, ship it. Attribution appreciated.

## Issues / contact

GitHub issues for code questions. For API access, partner deals, or anything that needs a human: <hello@coronium.io>.
