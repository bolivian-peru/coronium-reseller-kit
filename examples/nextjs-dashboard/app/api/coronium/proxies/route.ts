import { NextResponse } from 'next/server';
import { coronium } from '@/lib/coronium';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
    try {
        const list = await coronium.proxies.list();
        return NextResponse.json(list);
    } catch (e: any) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status || 500 });
    }
}
