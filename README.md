# Coronium Reseller Kit

> Open-source starter for building a mobile-proxy reseller business on top of the [Coronium](https://dashboard.coronium.io) API. Optimized for AI coding agents (Claude Code, Cursor, Windsurf, Aider) to scaffold a working dashboard in one prompt.

## For AI agents

If you're an AI agent scaffolding a reseller dashboard, **read these first** in this order:

1. [`AGENTS.md`](./AGENTS.md) — hard rules, architecture template, failure-mode table
2. [`llms.txt`](./llms.txt) — concise machine-readable surface
3. [`PROMPT.md`](./PROMPT.md) — paste-ready prompts (Next.js / CLI / webhook-only / Telegram-bot variants)
4. [`examples/nextjs-dashboard/`](./examples/nextjs-dashboard/) — working foundation, copy and modify
5. [`docs/webhook-integration.md`](./docs/webhook-integration.md) — the auto-swap event flow

Authoritative API reference — interactive OpenAPI / Swagger UI: <https://dashboard.coronium.io/api-docs/> (public, no login required)

## For humans

```bash
git clone https://github.com/bolivian-peru/coronium-reseller-kit
cd coronium-reseller-kit/examples/nextjs-dashboard
cp .env.example .env  # paste your CORONIUM_API_KEY
npm install && npm run dev
open http://localhost:3000
```

Or paste this into Claude Code / Cursor / Windsurf:

```
Read https://raw.githubusercontent.com/bolivian-peru/coronium-reseller-kit/main/AGENTS.md
and scaffold me a Next.js reseller dashboard using examples/nextjs-dashboard
as the foundation. My CORONIUM_API_KEY is in .env. Verify by buying one
test proxy at the end.
```

## What this kit gives you

| Surface | Purpose |
|---|---|
| `examples/nextjs-dashboard/` | Working Next.js 14 App Router dashboard — customer CRUD, proxy inventory, buy flow, webhook handler, ~1,400 LOC TypeScript |
| `examples/webhook-receiver/` | Standalone Node + Express receiver — for resellers who already have a backend |
| `docs/reseller-quickstart.md` | Zero → revenue path, 7 steps |
| `docs/webhook-integration.md` | Auto-swap event flow contract |
| `docs/metadata-strategy.md` | Customer mapping via the `metadata` field (no sidecar DB) |
| `docs/pricing-markup.md` | 2026 market rates + economics |

## Coronium API surface used

| Method · Path | Purpose |
|---|---|
| `GET /api/v3/account/proxies` | List proxies you own |
| `GET /api/v3/account/proxies/health` | Per-proxy `is_alive` + `recommendation` |
| `GET /api/v3/tariffs/available` | In-stock tariffs (filtered by country/carrier) |
| `POST /api/v3/payment/buy-modems-with-crypto-balance` | Buy proxies, attach `metadata.customer_id` |
| `POST /api/v3/modems/{id}/restart` | Rotate IP (async by default; append `?sync=true` to block up to 25 s and return the real outcome with `new_ip`) |
| `POST /api/v3/modems/{id}/replace` | Swap broken proxy (same country, transferred subscription time) |
| `GET /api/v3/modems/rotate-modem-by-token/{token}` | Token-auth rotation for end-customer scripts. Same `?sync=true` flag. |
| `PUT /api/v3/account/webhook` | Register HTTPS webhook for auto-swap events |
| `GET /api/v3/account/webhook` | Read current webhook URL |

Auth: `Authorization: Bearer <jwt>` header. Get your JWT at <https://dashboard.coronium.io> → Settings → API.

## Core integration pattern (read this once)

### 1. The `metadata` field is your customer-mapping layer

Don't create a sidecar `proxies` table mapping your customer-ids to Coronium modem-ids — it drifts. Use the freeform `metadata` JSON field on every Modem:

```json
POST /api/v3/payment/buy-modems-with-crypto-balance
{
  "tariff_id": "...",
  "modemCount": 1,
  "metadata": { "customer_id": "acme-007", "tag": "tiktok-batch" }
}
```

Every `GET /account/proxies` returns the same `metadata` verbatim. Filter client-side by `customer_id`. Full pattern in [`docs/metadata-strategy.md`](./docs/metadata-strategy.md).

### 2. Auto-swap is push, not pull

When a customer's modem dies, Coronium auto-provisions a same-country replacement, transfers the remaining paid time, and POSTs your webhook URL:

```json
{
  "event": "modem.replaced",
  "old_modem_id": "...",
  "new_modem_id": "...",
  "new_modem": {
    "host": "...", "http_port": "...", "socks_port": "...",
    "proxy_login": "...", "proxy_password": "...",
    "tariff_expired_at": ..., "country_code": "...", "isOnline": true
  },
  "ts": ...
}
```

If no replacement is available, you get `modem.dead` with `new_modem_id: null` and a `reason` code. Full event spec in [`docs/webhook-integration.md`](./docs/webhook-integration.md).

### 3. Customer-protection is enforced server-side

You cannot accidentally overwrite, release, or quarantine a customer's active modem via the reseller API. The backend filters protected modems out of every destructive operation (replace, auto-setup, release-by-token, etc.). Build accordingly — you don't need extra guards in your dashboard.

## Hard rules (also in AGENTS.md, repeated here for human readers)

1. **Never put `CORONIUM_API_KEY` in client-side code.** Server-side only. The examples enforce this; respect it in your own code.
2. **Use HTTPS for your webhook URL.** HTTP returns 400.
3. **Ack the webhook 200 within 5 seconds.** Process async. We don't retry; missed events fall back to email notification.
4. **Idempotency**: pass an `Idempotency-Key` header on buy requests. Safe-retry within 24h.
5. **Don't reinvent auto-swap or health logic.** Both are server-side, battle-tested.

## License

MIT. Fork it, change it, ship it.

## Contact

- Code questions: GitHub Issues on this repo
- API access / partner deals / volume pricing: <hello@coronium.io>
- Coronium status / changelog: <https://dashboard.coronium.io>
