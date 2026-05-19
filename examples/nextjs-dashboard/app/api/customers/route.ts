import { NextRequest, NextResponse } from 'next/server';
import { customers } from '@/lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
    return NextResponse.json({ data: customers.list() });
}

export async function POST(req: NextRequest) {
    let body: any = null;
    try { body = await req.json(); } catch {}
    if (!body?.id || !body?.name) {
        return NextResponse.json({ error: 'id and name are required' }, { status: 400 });
    }
    if (!/^[a-z0-9_-]{1,64}$/i.test(body.id)) {
        return NextResponse.json({ error: 'id must be 1-64 chars [a-z0-9_-]' }, { status: 400 });
    }
    customers.upsert({
        id: body.id,
        name: body.name,
        email: body.email,
        markup_pct: body.markup_pct,
        notes: body.notes,
    });
    return NextResponse.json({ ok: true, customer: customers.get(body.id) });
}

export async function DELETE(req: NextRequest) {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    customers.delete(id);
    return NextResponse.json({ ok: true });
}
