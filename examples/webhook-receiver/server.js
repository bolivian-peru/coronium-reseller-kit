/**
 * Standalone Coronium webhook receiver — Node + Express.
 *
 * For resellers who already have a backend / CRM and just want to wire in
 * the auto-swap event flow without adopting a full dashboard framework.
 *
 * Run it:
 *
 *   npm install
 *   CORONIUM_API_KEY=eyJ... WEBHOOK_SECRET=$(openssl rand -hex 32) node server.js
 *
 * Then register your URL with Coronium:
 *
 *   curl -X PUT https://api.coronium.io/api/v3/account/webhook \
 *     -H "Authorization: Bearer $CORONIUM_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d "{\"webhook_url\":\"https://your.host/coronium/webhook?key=$WEBHOOK_SECRET\"}"
 *
 * That's it. Event log streams to stdout; replace `processEvent` with your
 * CRM/Stripe-metadata/email logic.
 */

import express from 'express';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = process.env.PORT || 3001;
const SECRET = process.env.WEBHOOK_SECRET || '';
const LOG_FILE = process.env.LOG_FILE || './coronium-events.log';

if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '');

app.post('/coronium/webhook', (req, res) => {
    // Optional shared-secret check
    if (SECRET) {
        const got = req.query.key;
        if (got !== SECRET) {
            console.warn('[webhook] rejected: bad/missing ?key=');
            return res.status(403).send('forbidden');
        }
    }

    const body = req.body || {};
    if (!body.event) return res.status(400).send('bad request');

    // Ack first — Coronium delivery times out after 5s and doesn't retry.
    res.json({ ok: true });

    // Persist raw event before any processing so we can replay if logic breaks.
    appendFileSync(LOG_FILE, JSON.stringify({ ts: Date.now(), ...body }) + '\n');

    // Process async
    setImmediate(() => processEvent(body).catch((e) => console.error('[webhook] err:', e)));
});

app.get('/healthz', (_req, res) => res.send('ok'));

app.listen(PORT, () => {
    console.log(`[webhook] listening on :${PORT}`);
    console.log(`[webhook] register URL: http://<your-host>:${PORT}/coronium/webhook${SECRET ? `?key=${SECRET}` : ''}`);
});

// ─── Your business logic goes here ──────────────────────────────────────
async function processEvent(body) {
    switch (body.event) {
        case 'modem.replaced': {
            console.log(`[event] modem.replaced: ${body.old_modem_id} → ${body.new_modem_id}`);
            //
            // 1) Look up the end-customer who owned the old modem.
            //    Your code knows this because you stamped metadata.customer_id
            //    on the modem when you bought it via:
            //      POST /api/v3/payment/buy-modems-with-crypto-balance
            //      { tariff_id: ..., modemCount: 1,
            //        metadata: { customer_id: "acme-007" } }
            //
            // 2) Update your CRM / Stripe customer metadata / DB row:
            //      - modem_id          : new_modem_id (was old_modem_id)
            //      - host              : body.new_modem.host
            //      - http_port         : body.new_modem.http_port
            //      - socks_port        : body.new_modem.socks_port
            //      - proxy_login       : body.new_modem.proxy_login
            //      - proxy_password    : body.new_modem.proxy_password
            //      - tariff_expired_at : body.new_modem.tariff_expired_at
            //
            // 3) Email the customer the new credentials (their old ones are dead).
            //    The new modem is in the same country, with the same remaining
            //    paid time — they don't lose anything, but the URL changes.
            //
            // Don't re-fetch from Coronium — the event payload is complete.
            break;
        }

        case 'modem.dead': {
            console.log(`[event] modem.dead: ${body.old_modem_id} (${body.reason})`);
            //
            // No replacement was available. Possible reasons:
            //   - no_stock          : geo is exhausted right now
            //   - pipeline_failed   : provisioning bug — file a ticket with body.old_modem_id
            //   - shared_modem      : was on a shared tariff (rare for resellers)
            //   - tariff_orphan     : corrupt tariff record — ticket
            //
            // Recommended:
            //   1) Flag the modem in your local state.
            //   2) Notify the end-customer; offer refund or manual replacement
            //      (call POST /api/v3/modems/{old_modem_id}/replace yourself —
            //      it may succeed later when stock returns).
            //   3) Optionally retry /replace on a schedule.
            break;
        }

        default:
            console.warn('[event] unknown:', body.event);
    }
}
