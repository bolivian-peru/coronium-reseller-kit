import { NextRequest, NextResponse } from 'next/server';

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export async function proxy(req: NextRequest) {
    if (req.nextUrl.pathname === '/api/coronium/webhook') return NextResponse.next();

    const username = process.env.RESELLER_ADMIN_USER;
    const password = process.env.RESELLER_ADMIN_PASSWORD;
    if (!username || !password) {
        return new NextResponse('Set RESELLER_ADMIN_USER and RESELLER_ADMIN_PASSWORD before using the dashboard.', { status: 503 });
    }

    const authorization = req.headers.get('authorization');
    let supplied = '';
    try {
        if (authorization?.startsWith('Basic ')) supplied = atob(authorization.slice(6));
    } catch { /* Invalid Basic header. */ }
    const separator = supplied.indexOf(':');
    const valid = separator >= 0 && await equal(supplied.slice(0, separator), username)
        && await equal(supplied.slice(separator + 1), password);
    if (!valid) {
        return new NextResponse('Authentication required', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="Coronium reseller operator"', 'Cache-Control': 'no-store' },
        });
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('origin');
        if (origin && origin !== req.nextUrl.origin) return new NextResponse('Invalid origin', { status: 403 });
    }
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

async function equal(a: string, b: string) {
    const encoder = new TextEncoder();
    const [left, right] = await Promise.all([a, b].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
    const x = new Uint8Array(left);
    const y = new Uint8Array(right);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}
