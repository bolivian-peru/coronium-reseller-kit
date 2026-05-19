import { NextRequest, NextResponse } from 'next/server';
import { coronium } from '@/lib/coronium';
import { customers } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    let body: any = null;
    try { body = await req.json(); } catch {}
    const { tariff_id, modemCount = 1, customer_id, tag } = body || {};

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
        const result = await coronium.payment.buyWithBalance({
            tariff_id,
            modemCount: Number(modemCount) || 1,
            // The metadata field is YOUR customer-mapping layer. Coronium
            // stores it verbatim and returns it on every /account/proxies
            // call. Use it instead of a sidecar database.
            metadata: { customer_id, tag: tag || null, bought_at: Date.now() },
        });
        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json(
            { error: e.message, code: e.code, body: e.body },
            { status: e.status || 500 }
        );
    }
}
