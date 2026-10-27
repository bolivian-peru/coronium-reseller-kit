/**
 * Standalone Coronium webhook receiver - Node + Express.
 *
 * For resellers who already have a backend / CRM and just want to wire in
 * the auto-swap event flow without adopting a full dashboard framework.
 *
 * Run it:
 *
 *   npm install
 *   curl -X POST https://api.coronium.io/api/v3/account/webhook/secret/rotate \
 *     -H "Authorization: Bearer $CORONIUM_API_KEY"   # secret is shown once, store it
 *   CORONIUM_WEBHOOK_SECRET=<secret from POST /api/v3/account/webhook/secret/rotate, shown once> node server.js
 *
 * Then register your URL with Coronium:
 *
 *   curl -X PUT https://api.coronium.io/api/v3/account/webhook \
 *     -H "Authorization: Bearer $CORONIUM_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d "{\"webhook_url\":\"https://your.host/coronium/webhook\"}"
 *
 * This accepts events into a durable JSONL inbox. Wire your own idempotent
 * CRM worker before promising automatic customer notifications.
 */

import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { openSync, writeSync, fsyncSync, readFileSync, closeSync } from 'fs';

const app = express();
// Keep the RAW bytes: the HMAC is computed over exactly what we received, and
// re-serializing the parsed object would change them.
app.use(express.json({ limit: '64kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

const PORT = process.env.PORT || 3001;
const SIGNING_SECRET = process.env.CORONIUM_WEBHOOK_SECRET || '';
const LOG_FILE = process.env.LOG_FILE || './coronium-events.log';

if (!SIGNING_SECRET) throw new Error('CORONIUM_WEBHOOK_SECRET is required');
const seen = new Set();
const log = openSync(LOG_FILE, 'a+');
for (const line of readFileSync(LOG_FILE, 'utf8').split('\n')) {
    if (!line) continue;
    try { seen.add(JSON.parse(line).event_id); } catch { /* Incomplete tail after an interrupted write. */ }
}

function signatureMatches(raw, secret, header) {
    if (!header) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
}

app.post('/coronium/webhook', (req, res) => {
    // Cryptographic check - proves the POST really came from Coronium.
    if (!signatureMatches(req.rawBody || Buffer.alloc(0), SIGNING_SECRET, req.get('x-coronium-signature'))) {
        console.warn('[webhook] rejected: bad X-Coronium-Signature');
        return res.status(401).send('bad signature');
    }

    const body = req.body || {};
    if (typeof body.event_id !== 'string' || !body.event_id || typeof body.event !== 'string' || !body.data) {
        return res.status(400).send('bad request');
    }
    if (seen.has(body.event_id)) return res.json({ ok: true, duplicate: true });

    try {
        // Acknowledge only after the event reaches durable storage.
        writeSync(log, JSON.stringify({ received_at: Date.now(), ...body }) + '\n');
        fsyncSync(log);
        seen.add(body.event_id);
    } catch (error) {
        console.error('[webhook] event persistence failed:', error);
        return res.status(503).send('event not stored');
    }
    res.json({ ok: true });

    // This is an inbox example. Your CRM worker must process/replay the log;
    // the sample logger below does not update customers or claim delivery.
    setImmediate(() => processEvent(body).catch((e) => console.error('[webhook] err:', e)));
});

app.get('/healthz', (_req, res) => res.send('ok'));

app.listen(PORT, () => {
    console.log(`[webhook] listening on :${PORT}`);
    console.log(`[webhook] expose /coronium/webhook through HTTPS on your public host`);
});

process.on('SIGTERM', () => { closeSync(log); process.exit(0); });

// ─── Your business logic goes here ──────────────────────────────────────
async function processEvent(body) {
    // Every event nests its fields under `data`. Top-level holds only the
    // envelope: event_id, event, occurred_at, account.
    const data = body.data || {};

    switch (body.event) {
        case 'modem.replaced': {
            console.log(`[event] modem.replaced: ${data.old_modem_id} → ${data.new_modem_id}`);
            //
            // Key on data.new_modem_id (always present on modem.replaced). It
            // equals data.old_modem_id when the line was moved instead of
            // swapped: same login, password and expiry, only the ports may
            // change. Your own /replace that moves the line and keeps the same
            // ports sends no event. The automatic swap sends one, and a second
            // one (other shape) when the ports changed: dedupe. A line moved
            // automatically after ~30 min offline sends one only when the
            // ports changed, in the { id, login, ... } shape only.
            //
            // new_modem comes in two shapes. Your own /replace on a classic line
            // and the automatic swap (also when it moved the line) send { _id,
            // proxy_login, proxy_password, tariff_expired_at, ... }. A replacement
            // by support and the notice for a moved line whose ports changed
            // send { id, login, password, expires_at, http_url, socks_url, ... },
            // plus socks_host / socks_login / socks_password when SOCKS5 differs.
            // Read both spellings; never log the result (it holds passwords).
            const nm = data.new_modem || {};
            const creds = {
                modem_id: data.new_modem_id || nm._id || nm.id,
                host: nm.host,
                http_port: nm.http_port,
                socks_port: nm.socks_port,
                socks_host: nm.socks_host || nm.host,
                login: nm.proxy_login ?? nm.login,
                password: nm.proxy_password ?? nm.password,
                socks_login: nm.socks_login ?? nm.proxy_login ?? nm.login,
                socks_password: nm.socks_password ?? nm.proxy_password ?? nm.password,
                expires_at: nm.tariff_expired_at ?? nm.expires_at,
            };
            const needsRefetch = !creds.host || !creds.login || !creds.http_port || !creds.socks_port;
            //
            // 1) Look up the end-customer who owned the old modem.
            //    Your code knows this because you stamped metadata.customer_id
            //    on the modem when you bought it via:
            //      POST /api/v3/payment/buy-modems-with-crypto-balance
            //      { tariff_id: ..., modemCount: 1,
            //        metadata: "{\"customer_id\":\"acme-007\"}" }
            //
            // 2) If needsRefetch (new_modem missing, or host, login or ports
            //    empty), re-read the line with GET /api/v3/account/proxies by
            //    data.new_modem_id first. Confirming it there is good practice
            //    anyway before you hand out credentials.
            //
            // 3) Update your CRM / DB row from `creds`, mapping
            //    data.old_modem_id -> creds.modem_id. Store passwords encrypted.
            //
            // 4) Notify the customer with the current connection details.
            //    The line is in the same country, with the same remaining paid
            //    time - they don't lose anything, but the details may change.
            //
            // 5) The replacement keeps your metadata. Re-stamping is a harmless
            //    safety net for lines replaced before October 2026:
            //      PUT /api/v3/modems/{data.new_modem_id}/set-metadata
            //
            // Do not rely on new_modem.IMEI / portId (deprecated, removed on
            // 2026-11-19). A replaced p0f line adds
            // data.p0f = { required, kept, os, os_applied, pending?, note? }.
            if (needsRefetch) console.log(`[event] modem.replaced: refetch ${creds.modem_id} from /account/proxies`);
            break;
        }

        case 'modem.dead': {
            console.log(`[event] modem.dead: ${data.old_modem_id} (${data.reason})`);
            //
            // No replacement was available. Possible reasons:
            //   - no_stock             : geo is exhausted right now
            //   - no_p0f_stock         : p0f line, no p0f replacement. Ask the buyer
            //                            before replacing with { allow_without_p0f: true }
            //   - pipeline_failed      : provisioning failed - file a ticket with data.old_modem_id
            //   - provider_unsupported : this line type is not replaced automatically - ticket
            //   - shared_modem, tariff_orphan, no_owner, modem_not_found,
            //     config_error, move_<code>, unknown : not replaced - ticket if it persists
            //   Treat any other value as "not replaced".
            //
            // Recommended:
            //   1) Flag the modem in your local state.
            //   2) Notify the end-customer. Call POST /replace yourself only if
            //      the line's proxyEndpoints.capabilities.replace is not false.
            //   3) Retry on a schedule only while the answer is a stock shortage
            //      (400 "No free modems!") or 409 p0f_replacement_unavailable
            //      (after the buyer agreed to lose p0f). Stop at once on any other
            //      409 (code action_unsupported, or internal_error with a
            //      "contact support" error) and open a support ticket instead.
            break;
        }

        case 'proxy.purchased':
        case 'proxy.renewed':
            // data: { order_id, amount_usd, provider, days, count, proxies[] }
            console.log(`[event] ${body.event}: ${data.count} proxies, $${data.amount_usd}`);
            break;

        case 'proxy.purchase_failed':
            // data: { order_id, amount_usd, requested, reason_code, retryable, refund }
            // Read data.refund before any retry: a refunded order went back to balance.
            console.log(`[event] proxy.purchase_failed: ${data.order_id} (${data.reason_code})`);
            break;

        case 'proxy.expired':
            // data: { proxy: { proxy_id, modem_id, country, carrier, ... } }
            console.log(`[event] proxy.expired: ${data.proxy?.modem_id}`);
            break;

        case 'webhook.test':
            console.log('[event] webhook.test - endpoint wired correctly');
            break;

        default:
            console.warn('[event] unknown:', body.event);
    }
}
