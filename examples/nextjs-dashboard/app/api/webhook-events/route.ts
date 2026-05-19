import { NextResponse } from 'next/server';
import { webhookEvents } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
    return NextResponse.json({ data: webhookEvents.recent(50) });
}
