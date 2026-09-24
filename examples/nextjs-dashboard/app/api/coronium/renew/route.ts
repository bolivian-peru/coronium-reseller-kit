import { NextRequest, NextResponse } from 'next/server';
import { coronium, parseMetadata } from '@/lib/coronium';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { modem_id, customer_id, days, lane = 'account_credit', idempotency_key, expected_total_cents, action } = body || {};
    if (typeof modem_id !== 'string' || typeof customer_id !== 'string' ||
        ![1, 7, 30].includes(days) || !['account_credit', 'crypto_btc'].includes(lane) ||
        !['quote', 'renew'].includes(action)) {
        return NextResponse.json({ error: 'Invalid renewal request' }, { status: 400 });
    }
    if (action === 'renew' && (!/^[0-9a-f-]{36}$/i.test(idempotency_key || '') ||
        !Number.isSafeInteger(expected_total_cents))) {
        return NextResponse.json({ error: 'Quote and idempotency key required' }, { status: 400 });
    }

    try {
        const owned = await coronium.proxies.list();
        const proxy = (owned.data || []).find(p => p._id === modem_id);
        if (!proxy || parseMetadata(proxy.metadata).customer_id !== customer_id) {
            return NextResponse.json({ error: 'Proxy is not assigned to this customer' }, { status: 404 });
        }
        const quote = await coronium.payment.renewalQuote(modem_id, days);
        if (action === 'quote') return NextResponse.json(quote);
        if (quote.total_cents !== expected_total_cents) {
            return NextResponse.json({ error: 'Price changed. Get a new quote before renewing.', quote }, { status: 409 });
        }
        const result = await coronium.payment.renew(modem_id, days, lane, idempotency_key);
        if (result.result !== 'ok' || !result.data?.some(p => p._id === modem_id)) {
            return NextResponse.json({ error: 'Renewal is not confirmed. Check the Coronium account and payment state before retrying.', result }, { status: 202 });
        }
        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message, code: error.code, request_id: error.request_id }, { status: error.status || 500 });
    }
}
