import { NextResponse } from 'next/server';
import { reconcileWebhooks } from '@/lib/webhook-processing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
    try {
        return NextResponse.json(await reconcileWebhooks());
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Reconciliation failed' }, { status: 503 });
    }
}
