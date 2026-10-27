import { NextRequest, NextResponse } from 'next/server';
import { coronium } from '@/lib/coronium';
import { assignments, customers } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    let body: any = null;
    try { body = await req.json(); } catch {}
    const { tariff_id, modemCount = 1, customer_id, tag, idempotency_key, lane = 'account_credit', need_p0f = false, max_total_usd } = body || {};

    if (!tariff_id || !customer_id) {
        return NextResponse.json(
            { error: 'tariff_id and customer_id are required' },
            { status: 400 }
        );
    }
    if (!Number.isInteger(modemCount) || modemCount < 1 || modemCount > 20 ||
        !/^[0-9a-f-]{36}$/i.test(idempotency_key || '') ||
        !['account_credit', 'crypto_btc'].includes(lane) ||
        typeof need_p0f !== 'boolean' ||
        (max_total_usd != null && (typeof max_total_usd !== 'number' || !Number.isFinite(max_total_usd) || max_total_usd <= 0)) ||
        (tag != null && (typeof tag !== 'string' || tag.length > 128))) {
        return NextResponse.json({ error: 'Invalid count, lane, tag, max_total_usd or idempotency key' }, { status: 400 });
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
                // Replacements carry it to the new proxy; keep a local index
                // anyway - see docs/metadata-strategy.md.
                metadata,
                // Every unit must have OS fingerprint (p0f) control. With none in
                // stock the API answers 409 p0f_unavailable and charges nothing.
                ...(need_p0f ? { require: ['p0f' as const] } : {}),
                // Optional: the total the operator approved. Above it Coronium answers
                // 409 price_changed with a fresh quote and charges nothing.
                ...(max_total_usd != null ? { max_total_usd } : {}),
            },
            lane,
            idempotency_key
        );
        for (const proxy of result.data || []) assignments.upsert(proxy._id, customer_id, JSON.stringify(metadata));
        if (result.result !== 'ok' || !Array.isArray(result.data) || result.data.length !== modemCount) {
            // HTTP 202 {message, paymentId, charged_usd} from Coronium: the balance
            // was charged and the proxies are still being provisioned.
            const paymentId = (result as any)?.paymentId;
            return NextResponse.json({
                error: paymentId
                    ? 'Charged, proxies are still being provisioned.'
                    : 'Purchase is not confirmed. Check the Coronium account and payment state before starting a new order.',
                provisioning: !!paymentId,
                payment_id: paymentId, charged_usd: (result as any)?.charged_usd,
                result,
            }, { status: 202 });
        }
        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json(
            // p0f_unavailable (409): this plan has no p0f unit right now; pick a plan
            // whose features.p0f.count > 0 or untick "need p0f". Nothing was charged.
            // A 503 OUT_OF_STOCK / UPSTREAM_DEGRADED with refunded: true also carries
            // paymentId, but nothing was charged (refunded at once) and a new order
            // is safe. Otherwise PAYMENT_DELIVERY_UNCONFIRMED (503) or a 500 with
            // paymentId means the balance was charged: pass it on so the operator
            // can follow the order with GET /payments/{id}/status.
            {
                error: e.message, code: e.code, reason: e.body?.reason, suggested_action: e.suggested_action, request_id: e.request_id,
                quote: e.body?.quote,
                payment_id: e.body?.paymentId, charged_usd: e.body?.charged_usd, refunded: e.body?.refunded,
            },
            { status: e.status || 500 }
        );
    }
}
