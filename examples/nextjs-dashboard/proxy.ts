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
        // Browsers attach cached Basic credentials to cross-site requests, so a
        // state-changing call must prove it came from this dashboard's own pages.
        const origin = req.headers.get('origin');
        if (origin && !allowedOrigins(req).has(origin)) return new NextResponse('Invalid origin', { status: 403 });
        const site = req.headers.get('sec-fetch-site');
        if (site && site !== 'same-origin' && site !== 'none') return new NextResponse('Invalid origin', { status: 403 });
    }
    const response = NextResponse.next();
    // Pages here show proxy passwords and carry a Buy button: never cache them,
    // never let another site frame them, never leak the URL in a Referer.
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}

// The origin the browser actually used. Under `next start` req.nextUrl.origin is the
// listen address (http://localhost:<port>), not the public URL behind a reverse proxy,
// so also accept the origin built from the forwarded or Host headers and, when set,
// RESELLER_PUBLIC_URL. A cross-site page cannot forge these: its Origin is its own.
function allowedOrigins(req: NextRequest) {
    const allowed = new Set<string>([req.nextUrl.origin]);
    const first = (value: string | null) => value?.split(',')[0].trim() || '';
    const proto = first(req.headers.get('x-forwarded-proto')) || req.nextUrl.protocol.replace(/:$/, '');
    const host = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host'));
    if (host) allowed.add(`${proto}://${host}`);
    const configured = process.env.RESELLER_PUBLIC_URL;
    if (configured) {
        try { allowed.add(new URL(configured).origin); } catch { /* Ignore a malformed value. */ }
    }
    return allowed;
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
