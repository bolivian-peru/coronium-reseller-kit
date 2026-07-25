/**
 * POST /api/coronium/webhook
 *
 * Receives account events from Coronium. Every event shares ONE envelope:
 *
 *   {
 *     event_id:    "uuid",              // stable — dedupe on this
 *     event:       "modem.replaced",
 *     occurred_at: "2026-07-25T08:34:53.000Z",
 *     account:     { user_id, email },
 *     data:        { ...event-specific fields }
 *   }
 *
 * The per-event fields live under `data`, NOT at the top level. Reading
 * `body.old_modem_id` gives you undefined — it is `body.data.old_modem_id`.
 *
 * Ack 200 fast (5s timeout), then process. Delivery is durable: up to 8
 * attempts with escalating backoff, so a non-2xx will be redelivered — your
 * handler must be idempotent. Dedupe on `event_id`.
 *
 * Every delivery is signed. Set CORONIUM_WEBHOOK_SECRET (ask Coronium support
 * for yours) and we verify X-Coronium-Signature before trusting the body.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { webhookEvents } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';  // better-sqlite3 needs Node runtime, not Edge

export async function POST(req: NextRequest) {
    // Optional shared-secret check (set WEBHOOK_SECRET in .env)
    const expected = process.env.WEBHOOK_SECRET;
    if (expected) {
        const got = new URL(req.url).searchParams.get('key');
        if (got !== expected) {
            return new NextResponse('forbidden', { status: 403 });
        }
    }

    // Verify the HMAC over the RAW body — re-serializing JSON changes the bytes
    // and the signature will never match.
    const raw = await req.text();
    const secret = process.env.CORONIUM_WEBHOOK_SECRET;
    if (secret && !signatureMatches(raw, secret, req.headers.get('x-coronium-signature'))) {
        return new NextResponse('bad signature', { status: 401 });
    }

    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* empty or malformed body */ }
    if (!body || !body.event) {
        return new NextResponse('bad request', { status: 400 });
    }

    // Persist the raw event first (cheap, fail-safe — even if processing
    // breaks we have the event on disk for replay).
    try { webhookEvents.insert(body); } catch (e) { /* swallow — never block ack */ }

    // Ack the delivery service immediately. Processing continues async below
    // (kept inside the request handler for the example — in production move
    // it to a background queue if processing is heavy).
    queueMicrotask(() => processEvent(body).catch(err =>
        console.error('[webhook] processing failed:', err)
    ));

    return NextResponse.json({ ok: true });
}

function signatureMatches(raw: string, secret: string, header: string | null): boolean {
    if (!header) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
}

async function processEvent(body: any) {
    const data = body.data || {};
    switch (body.event) {
        case 'modem.replaced':
            console.log(`[webhook] modem.replaced: ${data.old_modem_id} → ${data.new_modem_id}`);
            // TODO (you, the reseller):
            //  1. Look up your end-customer by their previous modem_id (you stamped
            //     this via metadata.customer_id when you bought the original).
            //  2. Update your CRM / Stripe customer metadata / KV with new_modem_id
            //     and data.new_modem.{host, http_port, socks_port, proxy_login, proxy_password}.
            //  3. Email the customer with the new credentials. The old credentials
            //     no longer work.
            //
            // The replacement does NOT inherit the original's metadata, so your
            // own record is the only link back to the customer after a swap.
            // Re-stamp it: PUT /modems/{new_modem_id}/set-metadata.
            break;

        case 'modem.dead':
            console.log(`[webhook] modem.dead: ${data.old_modem_id} (${data.reason})`);
            // TODO:
            //  1. Flag the modem in your local state.
            //  2. Notify the end-customer; offer them a manual replacement or refund.
            //  3. Optionally: schedule a retry of POST /modems/{old_modem_id}/replace
            //     when stock returns (no_stock is the common reason).
            break;

        case 'proxy.purchased':
        case 'proxy.renewed':
            // data: { order_id, amount_usd, provider, days, count, proxies[] }
            console.log(`[webhook] ${body.event}: ${data.count} proxies, $${data.amount_usd}`);
            break;

        case 'proxy.expired':
            // data: { proxy }
            console.log(`[webhook] proxy.expired: ${data.proxy?.modem_id}`);
            break;

        case 'webhook.test':
            console.log('[webhook] test event received — your endpoint is wired correctly');
            break;

        default:
            console.warn('[webhook] unknown event:', body.event);
    }
}
