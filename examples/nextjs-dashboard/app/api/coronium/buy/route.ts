import { NextRequest, NextResponse } from 'next/server';
import { coronium } from '@/lib/coronium';
import { customers } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    let body: any = null;
    try { body = await req.json(); } catch {}
    const { tariff_id, modemCount = 1, customer_id, tag, idempotency_key } = body || {};

    if (!tariff_id || !customer_id) {
        return NextResponse.json(
            { error: 'tariff_id and customer_id are required' },
            { status: 400 }
        );
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
        const result = await coronium.payment.buyWithBalance(
            {
                tariff_id,
                modemCount: Number(modemCount) || 1,
                // The metadata field tags the proxy with YOUR customer id, so
                // /account/proxies alone tells you who each proxy belongs to.
                // It is NOT carried onto the replacement when a dead modem is
                // auto-swapped — see docs/metadata-strategy.md.
                metadata: { customer_id, tag: tag || null, bought_at: Date.now() },
            },
            // The browser generates one key per click and resends it on retry,
            // so a flaky connection can never provision (and charge) twice.
            idempotency_key
        );
        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json(
            { error: e.message, code: e.code, request_id: e.request_id, body: e.body },
            { status: e.status || 500 }
        );
    }
}
