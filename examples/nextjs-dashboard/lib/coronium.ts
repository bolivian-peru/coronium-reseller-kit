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
        'X-Coronium-Proxy-Credentials': 'separate-protocol-v1',
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
        // Every /api/v3 4xx/5xx carries the reseller error envelope:
        // { error, code, suggested_action, request_id, documentation_url? }.
        // `error` is the human string, `code` the machine identifier. Quote
        // request_id (also on the X-Request-Id header) when opening a ticket.
        const err: any = new Error(body?.error || `Coronium ${r.status}`);
        err.status = r.status;
        err.code = body?.code;
        err.suggested_action = body?.suggested_action;
        err.request_id = body?.request_id || r.headers.get('x-request-id');
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
    rotation_interval?: number;  // SECONDS between auto-rotations; 0 = disabled
    isOnline?: boolean;
    carrier?: { _id: string; name: string; code?: string } | null;
    proxyEndpoints?: {
        provider: 'pocketproxy';
        http?: Endpoint;
        socks5?: Endpoint;
        capabilities?: { autoRenew?: boolean; replace?: boolean; openvpn?: boolean; p0f?: boolean };
    };
}

export interface Endpoint { host: string; port: number | string; username: string; password: string }

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
    charged_usd: number;
    currency: 'USD';
    data: Proxy[];
    /** Itemized breakdown so you can reconcile the charge without a second call. */
    billing: {
        schema_version: number;
        action: 'purchase' | 'renewal';
        lane: string;
        currency: 'USD';
        line_items: Array<{ kind: string; name: string | null; plan?: string; days?: number; quantity: number; unit_price_usd: number; line_total_usd: number }>;
        subtotal_usd: number;
        discount: { code?: string; amount_usd?: number } | null;
        charged_usd: number;
        balance_before_usd: number | null;
        balance_after_usd: number | null;
        settlement: { asset: string; amount_btc?: number; exchange_rate_usd_per_btc?: number } | null;
    };
}

// ─── API surface ─────────────────────────────────────────────────────────
export const coronium = {
    account: {
        get: () => call<any>('/account'),
    },
    proxies: {
        list: () => call<{ data: Proxy[] }>('/account/proxies'),
        health: () => call<HealthResponse>('/account/proxies/health'),
        /**
         * Rotate a modem's IP. This call is SYNCHRONOUS — it holds the request
         * open until the carrier has actually handed out a new IP, then tells
         * you what happened.
         *
         * THE TRAP: it answers 200 whether or not the IP changed. Branch on
         * `rotated`, never on the HTTP status:
         *   { result: 'ok', rotated: true,  ip: '<new IP>', message }
         *   { result: 'ok', rotated: false, ip: '<unchanged IP>', message }
         *
         * `rotated: false` is a FAILED rotation returned with a 200. Treating
         * a 2xx as success is the single most common integration bug here.
         */
        rotate: (id: string) =>
            call<{ result: string; rotated: boolean; ip: string | null; message: string }>(
                `/modems/${id}/restart`,
                { method: 'POST' }
            ),
        replace: (id: string) =>
            call<any>(`/modems/${id}/replace`, { method: 'POST' }),
        /**
         * Auto-rotate every N SECONDS. Minimum 60; 0 disables. Sending minutes
         * here (e.g. 5 meaning "5 minutes") is rejected with a 400 — anything
         * between 1 and 59 is invalid.
         */
        setRotationInterval: (id: string, seconds: number) =>
            call<{ result: string; data: { _id: string; name: string; rotation_interval: number } }>(
                `/modems/${id}/set-rotation-interval`,
                { method: 'PUT', body: JSON.stringify({ rotation_interval: seconds }) }
            ),
        /** Re-stamp the customer-mapping metadata on an existing proxy. */
        setMetadata: (id: string, metadata: Record<string, any>) =>
            call<{ result: string }>(`/modems/${id}/set-metadata`, {
                method: 'PUT',
                body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
            }),
    },
    tariffs: {
        listAvailable: () => call<{ data: Tariff[] }>('/tariffs/available'),
    },
    payment: {
        /**
         * Buy `modemCount` proxies on the tariff. Country and carrier come from
         * the TARIFF — sending them in the body does nothing.
         *
         * `idempotencyKey` must be ONE stable key per buy intent, reused across
         * every retry of that intent. Replaying it within 24h returns the
         * original response (with `X-Idempotency-Replay: true`) instead of
         * provisioning — and charging — a second time. Generate it once, at the
         * point the human clicks Buy, never per HTTP attempt.
         */
        buy: (
            args: { tariff_id: string; modemCount: number; metadata?: Record<string, any> },
            lane: 'account_credit' | 'crypto_btc',
            idempotencyKey: string
        ) =>
            call<BuyResult>(lane === 'account_credit' ? '/payment/buy-with-account-credit' : '/payment/buy-modems-with-crypto-balance', {
                method: 'POST',
                // metadata is a String column server-side — send it pre-stringified
                // so it round-trips as the same JSON you sent.
                body: JSON.stringify({
                    tariff_id: args.tariff_id,
                    modemCount: args.modemCount,
                    ...(args.metadata ? { metadata: JSON.stringify(args.metadata) } : {}),
                }),
                headers: { 'Idempotency-Key': idempotencyKey },
            }),
        renewalQuote: (modemId: string, days: number) =>
            call<{ currency: 'USD'; total_usd: number; total_cents: number; line_items: any[] }>('/payment/renewal-quote', {
                method: 'POST', body: JSON.stringify({ modems: [{ modem_id: modemId, days }] }),
            }),
        renew: (modemId: string, days: number, lane: 'account_credit' | 'crypto_btc', idempotencyKey: string) =>
            call<BuyResult>(lane === 'account_credit' ? '/payment/renew-with-account-credit' : '/payment/renew-modems-with-crypto-balance', {
                method: 'POST', body: JSON.stringify({ modems: [{ modem_id: modemId, days }] }),
                headers: { 'Idempotency-Key': idempotencyKey },
            }),
    },
    webhook: {
        get: () => call<{ webhook_url: string | null }>('/account/webhook'),
        set: (url: string | null) =>
            call<any>('/account/webhook', {
                method: 'PUT',
                body: JSON.stringify({ webhook_url: url }),
            }),
        /**
         * Fire a real `webhook.test` POST at your registered URL and return the
         * actual delivery result (status code + latency). Use this instead of
         * waiting for a modem to die to find out your endpoint is misconfigured.
         */
        test: () => call<any>('/account/webhook/test', { method: 'POST' }),
    },
};

// ─── Metadata helper ──────────────────────────────────────────────────────
// `metadata` comes back as a JSON string. Parse defensively: it is freeform
// text you control, so a bad write shouldn't crash a list render.
export function parseMetadata(raw: string | undefined | null): Record<string, any> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}
