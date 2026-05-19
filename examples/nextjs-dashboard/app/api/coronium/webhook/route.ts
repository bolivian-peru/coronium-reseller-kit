/**
 * POST /api/coronium/webhook
 *
 * Receives modem-lifecycle events from Coronium. Two event types in v1:
 *
 *  - modem.replaced — old_modem_id → new_modem_id, new_modem.{...full creds}
 *  - modem.dead     — auto-swap failed, new_modem_id is null + reason
 *
 * Ack 200 IMMEDIATELY then process. The Coronium delivery service times out
 * after 5s and does not retry; if you take too long the email fallback fires.
 *
 * If you set WEBHOOK_SECRET in .env, we verify the ?key= query param matches.
 * Otherwise we accept all POSTs (you should secure the route URL itself).
 */
import { NextRequest, NextResponse } from 'next/server';
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

    let body: any = null;
    try { body = await req.json(); } catch { /* empty body */ }
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

async function processEvent(body: any) {
    switch (body.event) {
        case 'modem.replaced':
            console.log(`[webhook] modem.replaced: ${body.old_modem_id} → ${body.new_modem_id}`);
            // TODO (you, the reseller):
            //  1. Look up your end-customer by their previous modem_id (you stamped
            //     this via metadata.customer_id when you bought the original).
            //  2. Update your CRM / Stripe customer metadata / KV with new_modem_id
            //     and new_modem.{host, http_port, socks_port, proxy_login, proxy_password}.
            //  3. Email the customer with the new credentials. The old credentials
            //     no longer work.
            //
            // Don't re-fetch from Coronium — the event payload already includes
            // the full new_modem block.
            break;

        case 'modem.dead':
            console.log(`[webhook] modem.dead: ${body.old_modem_id} (${body.reason})`);
            // TODO:
            //  1. Flag the modem in your local state.
            //  2. Notify the end-customer; offer them a manual replacement or refund.
            //  3. Optionally: schedule a retry of POST /modems/{old_modem_id}/replace
            //     when stock returns (no_stock is the common reason).
            break;

        default:
            console.warn('[webhook] unknown event:', body.event);
    }
}
