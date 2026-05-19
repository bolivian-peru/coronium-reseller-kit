import { NextResponse } from 'next/server';
import { coronium } from '@/lib/coronium';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
    try {
        const tariffs = await coronium.tariffs.listAvailable();
        return NextResponse.json(tariffs);
    } catch (e: any) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status || 500 });
    }
}
