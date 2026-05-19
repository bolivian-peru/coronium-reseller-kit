/**
 * Thin typed client around the Coronium reseller REST API.
 *
 * Runs SERVER-SIDE only (Next.js Route Handlers). The JWT in CORONIUM_API_KEY
 * never reaches the browser. If you find yourself importing this from a
 * `'use client'` component, you've made a mistake — refactor through a
 * `/api/coronium/*` route handler.
 */

const BASE = process.env.CORONIUM_API_BASE || 'https://api.coronium.io/api/v3';
const KEY = process.env.CORONIUM_API_KEY;

if (!KEY) {
    // We don't throw here so the dev server still boots; the API key check
    // happens per-request so the UI can show a clear setup screen.
    console.warn('[coronium] CORONIUM_API_KEY not set — paste it into .env to enable API calls');
}

function headers() {
    return {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json',
    };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${BASE}${path}`;
    const r = await fetch(url, {
        ...init,
        headers: { ...headers(), ...(init?.headers || {}) },
        // Next.js: don't cache mutations or per-customer reads.
        cache: 'no-store',
    });
    const text = await r.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    if (!r.ok) {
        const err: any = new Error(body?.error || `Coronium ${r.status}`);
        err.status = r.status;
        err.code = body?.code;
        err.body = body;
        throw err;
    }
    return body as T;
}

// ─── Types (only the fields the dashboard uses) ──────────────────────────
export interface Proxy {
    _id: string;
    name: string;
    IMEI?: string;
    http_port: string;
    socks_port: string;
    proxy_login: string;
    proxy_password: string;
    ext_ip?: string;
    ip_address?: string;
    connection_ip?: string;
    tariff_expired_at?: number;
    metadata?: string;  // freeform JSON string the reseller controls
    country_id?: string;
    rotation_interval?: number;
    isOnline?: boolean;
}

export interface HealthRow {
    modem_id: string;
    name: string;
    ext_ip: string | null;
    http_port: string | null;
    socks_port: string | null;
    status: 'active' | 'degraded' | 'dead' | 'expired';
    is_alive: boolean;
    consecutive_failures: number;
    last_seen_live_ms: number | null;
    tariff_expired_at: number | null;
    recommendation: 'use' | 'skip_for_now' | 'contact_support';
    hint: string | null;
}

export interface HealthResponse {
    modems: HealthRow[];
    summary: { total: number; active: number; degraded: number; dead: number; expired: number };
    generated_at_ms: number;
}

export interface Tariff {
    _id: string;
    name: string;
    price: number;
    period?: string;
    country_id: string;
    country_name?: string;
    country_code?: string;
    carrier_id?: string;
    carrier_name?: string;
    stock?: number;
}

export interface BuyResult {
    result: 'ok';
    data: Array<{ _id: string; name: string; ext_ip: string; http_port: string; socks_port: string; proxy_login: string; proxy_password: string; metadata?: string }>;
}

// ─── API surface ─────────────────────────────────────────────────────────
export const coronium = {
    account: {
        get: () => call<any>('/account'),
        balance: () => call<any>('/account/crypto-balance'),
    },
    proxies: {
        list: () => call<{ data: Proxy[] }>('/account/proxies'),
        health: () => call<HealthResponse>('/account/proxies/health'),
        /**
         * Rotate a modem's IP. Defaults to ?sync=true so the response tells
         * you the truth: 200 = rotated (new_ip in body), 502 = confirmed
         * failure, 503 = worker timeout. Pass {sync: false} for the
         * fire-and-forget legacy behaviour (200 returns instantly on enqueue,
         * does NOT mean the IP changed — your code must verify separately).
         *
         * For automation that branches on rotation success (account-creation
         * bots, anti-detect frameworks, quota-driven loops), keep the default.
         */
        rotate: (id: string, opts?: { sync?: boolean }) => {
            const sync = opts?.sync !== false;  // default true
            const qs = sync ? '?sync=true' : '';
            return call<{result: string; ext_ip?: string; new_ip?: string; code?: string; error?: string}>(
                `/modems/${id}/restart${qs}`,
                { method: 'POST' }
            );
        },
        replace: (id: string) =>
            call<any>(`/modems/${id}/replace`, { method: 'POST' }),
        // setRotationInterval, setMetadata, etc. — add if needed
    },
    tariffs: {
        listAvailable: () => call<{ data: Tariff[] }>('/tariffs/available'),
    },
    payment: {
        buyWithBalance: (args: { tariff_id: string; modemCount: number; metadata?: Record<string, any> }) =>
            call<BuyResult>('/payment/buy-modems-with-crypto-balance', {
                method: 'POST',
                body: JSON.stringify(args),
                headers: { 'Idempotency-Key': cryptoIdempotencyKey(args) },
            }),
    },
    webhook: {
        get: () => call<{ webhook_url: string | null }>('/account/webhook'),
        set: (url: string | null) =>
            call<any>('/account/webhook', {
                method: 'PUT',
                body: JSON.stringify({ webhook_url: url }),
            }),
    },
};

// ─── Idempotency helper ───────────────────────────────────────────────────
// Generates a stable key per (tariff, count, customer) tuple. If the buy POST
// is retried with the same payload within 24h, the backend returns the
// original 2xx response instead of provisioning twice.
function cryptoIdempotencyKey(args: { tariff_id: string; modemCount: number; metadata?: any }): string {
    const seed = `${args.tariff_id}:${args.modemCount}:${JSON.stringify(args.metadata || {})}:${Math.floor(Date.now() / 60000)}`;
    // Simple FNV-1a-ish — good enough for a 1-minute idempotency window.
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return `buy_${(h >>> 0).toString(36)}_${Math.floor(Date.now() / 60000).toString(36)}`;
}
