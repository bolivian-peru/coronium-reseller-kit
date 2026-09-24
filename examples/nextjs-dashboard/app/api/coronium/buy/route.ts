import { NextRequest, NextResponse } from 'next/server';
import { coronium } from '@/lib/coronium';
import { assignments, customers } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    let body: any = null;
    try { body = await req.json(); } catch {}
    const { tariff_id, modemCount = 1, customer_id, tag, idempotency_key, lane = 'account_credit' } = body || {};

    if (!tariff_id || !customer_id) {
        return NextResponse.json(
            { error: 'tariff_id and customer_id are required' },
            { status: 400 }
        );
    }
    if (!Number.isInteger(modemCount) || modemCount < 1 || modemCount > 20 ||
        !/^[0-9a-f-]{36}$/i.test(idempotency_key || '') ||
        !['account_credit', 'crypto_btc'].includes(lane) ||
        (tag != null && (typeof tag !== 'string' || tag.length > 128))) {
        return NextResponse.json({ error: 'Invalid count, lane, tag or idempotency key' }, { status: 400 });
    }

    // Confirm the customer exists in OUR local store before letting them buy.
    // Avoid orphan purchases tagged to non-existent customer_ids.
    if (!customers.get(customer_id)) {
        return NextResponse.json(
            { error: `customer_id "${customer_id}" not found in local store. Create the customer first.` },
            { status: 400 }
        );
    }

    try {
        const metadata = { customer_id, tag: tag || null };
        const result = await coronium.payment.buy(
            {
                tariff_id,
                modemCount,
                // The metadata field tags the proxy with YOUR customer id, so
                // /account/proxies alone tells you who each proxy belongs to.
                // It is NOT carried onto the replacement when a dead modem is
                // auto-swapped — see docs/metadata-strategy.md.
                metadata,
            },
            lane,
            idempotency_key
        );
        for (const proxy of result.data || []) assignments.upsert(proxy._id, customer_id, JSON.stringify(metadata));
        if (result.result !== 'ok' || !Array.isArray(result.data) || result.data.length !== modemCount) {
            return NextResponse.json({
                error: 'Purchase is not confirmed. Check the Coronium account and payment state before starting a new order.',
                result,
            }, { status: 202 });
        }
        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json(
            { error: e.message, code: e.code, request_id: e.request_id },
            { status: e.status || 500 }
        );
    }
}
