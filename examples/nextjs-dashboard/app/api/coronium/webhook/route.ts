import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { webhookEvents } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const secret = process.env.CORONIUM_WEBHOOK_SECRET;
    if (!secret) return new NextResponse('Webhook signing secret is not configured', { status: 503 });

    const raw = await req.text();
    const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
    const supplied = Buffer.from(req.headers.get('x-coronium-signature') || '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return new NextResponse('Invalid signature', { status: 401 });
    }

    let event: any;
    try { event = JSON.parse(raw); } catch { return new NextResponse('Invalid JSON', { status: 400 }); }
    if (typeof event?.event_id !== 'string' || !event.event_id || typeof event.event !== 'string' ||
        !event.data || typeof event.data !== 'object') {
        return new NextResponse('Invalid event envelope', { status: 400 });
    }

    try {
        const inserted = webhookEvents.insert(event);
        // Commit the event before acknowledging delivery. The reconciliation
        // worker processes the durable inbox after this request.
        return NextResponse.json({ ok: true, duplicate: !inserted });
    } catch (error) {
        console.error('[webhook] durable insert failed:', error);
        return new NextResponse('Unable to persist event', { status: 503 });
    }
}
