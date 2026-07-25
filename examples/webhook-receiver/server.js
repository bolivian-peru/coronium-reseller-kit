/**
 * Standalone Coronium webhook receiver — Node + Express.
 *
 * For resellers who already have a backend / CRM and just want to wire in
 * the auto-swap event flow without adopting a full dashboard framework.
 *
 * Run it:
 *
 *   npm install
 *   CORONIUM_API_KEY=eyJ... WEBHOOK_SECRET=$(openssl rand -hex 32) \
 *     CORONIUM_WEBHOOK_SECRET=<ask support> node server.js
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
import { createHmac, timingSafeEqual } from 'crypto';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

const app = express();
// Keep the RAW bytes: the HMAC is computed over exactly what we received, and
// re-serializing the parsed object would change them.
app.use(express.json({ limit: '64kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

const PORT = process.env.PORT || 3001;
const SECRET = process.env.WEBHOOK_SECRET || '';
const SIGNING_SECRET = process.env.CORONIUM_WEBHOOK_SECRET || '';
const LOG_FILE = process.env.LOG_FILE || './coronium-events.log';

if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, '');

function signatureMatches(raw, secret, header) {
    if (!header) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
}

app.post('/coronium/webhook', (req, res) => {
    // Optional shared-secret check
    if (SECRET) {
        const got = req.query.key;
        if (got !== SECRET) {
            console.warn('[webhook] rejected: bad/missing ?key=');
            return res.status(403).send('forbidden');
        }
    }

    // Cryptographic check — proves the POST really came from Coronium.
    if (SIGNING_SECRET && !signatureMatches(req.rawBody || Buffer.alloc(0), SIGNING_SECRET, req.get('x-coronium-signature'))) {
        console.warn('[webhook] rejected: bad X-Coronium-Signature');
        return res.status(401).send('bad signature');
    }

    const body = req.body || {};
    if (!body.event) return res.status(400).send('bad request');

    // Ack first — delivery times out after 5s. A non-2xx is retried (up to 8
    // attempts with backoff), so dedupe on body.event_id before acting.
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
    // Every event nests its fields under `data`. Top-level holds only the
    // envelope: event_id, event, occurred_at, account.
    const data = body.data || {};

    switch (body.event) {
        case 'modem.replaced': {
            console.log(`[event] modem.replaced: ${data.old_modem_id} → ${data.new_modem_id}`);
            //
            // 1) Look up the end-customer who owned the old modem.
            //    Your code knows this because you stamped metadata.customer_id
            //    on the modem when you bought it via:
            //      POST /api/v3/payment/buy-modems-with-crypto-balance
            //      { tariff_id: ..., modemCount: 1,
            //        metadata: "{\"customer_id\":\"acme-007\"}" }
            //
            // 2) Update your CRM / Stripe customer metadata / DB row:
            //      - modem_id          : data.new_modem_id (was data.old_modem_id)
            //      - host              : data.new_modem.host
            //      - http_port         : data.new_modem.http_port
            //      - socks_port        : data.new_modem.socks_port
            //      - proxy_login       : data.new_modem.proxy_login
            //      - proxy_password    : data.new_modem.proxy_password
            //      - tariff_expired_at : data.new_modem.tariff_expired_at
            //
            // 3) Email the customer the new credentials (their old ones are dead).
            //    The new modem is in the same country, with the same remaining
            //    paid time — they don't lose anything, but the URL changes.
            //
            // 4) IMPORTANT: the replacement does NOT inherit the old modem's
            //    metadata. Re-stamp it or the proxy shows up unassigned:
            //      PUT /api/v3/modems/{data.new_modem_id}/set-metadata
            break;
        }

        case 'modem.dead': {
            console.log(`[event] modem.dead: ${data.old_modem_id} (${data.reason})`);
            //
            // No replacement was available. Possible reasons:
            //   - no_stock          : geo is exhausted right now
            //   - pipeline_failed   : provisioning bug — file a ticket with data.old_modem_id
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

        case 'proxy.purchased':
        case 'proxy.renewed':
            // data: { order_id, amount_usd, provider, days, count, proxies[] }
            console.log(`[event] ${body.event}: ${data.count} proxies, $${data.amount_usd}`);
            break;

        case 'proxy.expired':
            // data: { proxy: { proxy_id, modem_id, country, carrier, ... } }
            console.log(`[event] proxy.expired: ${data.proxy?.modem_id}`);
            break;

        case 'webhook.test':
            console.log('[event] webhook.test — endpoint wired correctly');
            break;

        default:
            console.warn('[event] unknown:', body.event);
    }
}
