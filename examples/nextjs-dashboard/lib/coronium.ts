/**
 * Thin typed client around the Coronium reseller REST API.
 *
 * Runs SERVER-SIDE only (Next.js Route Handlers). The JWT in CORONIUM_API_KEY
 * never reaches the browser. If you find yourself importing this from a
 * `'use client'` component, you've made a mistake - refactor through a
 * `/api/coronium/*` route handler.
 */

const BASE = process.env.CORONIUM_API_BASE || 'https://api.coronium.io/api/v3';
const KEY = process.env.CORONIUM_API_KEY;

// The key is a bearer credential: refuse to send it over plain HTTP. A typo in
// CORONIUM_API_BASE must fail loudly instead of leaking the key in clear text.
if (!/^https:\/\//i.test(BASE) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(BASE + '/')) {
    throw new Error('[coronium] CORONIUM_API_BASE must be an https:// URL');
}

if (!KEY) {
    // We don't throw here so the dev server still boots; the API key check
    // happens per-request so the UI can show a clear setup screen.
    console.warn('[coronium] CORONIUM_API_KEY not set - paste it into .env to enable API calls');
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
        // { error, code, reason_code?, suggested_action, retryable, request_id }.
        // `error` is the human string, `code` the machine identifier. Quote
        // request_id (also on the X-Request-Id header) when opening a ticket.
        const err: any = new Error(body?.error || `Coronium ${r.status}`);
        err.status = r.status;
        err.code = body?.code;
        err.suggested_action = body?.suggested_action;
        err.retryable = body?.retryable;
        // A 503/429 may say when to come back (e.g. openvpn_profile_pending: 120 s).
        const retryAfter = Number(r.headers.get('retry-after'));
        err.retry_after_seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
        err.request_id = body?.request_id || r.headers.get('x-request-id');
        err.body = body;
        throw err;
    }
    return body as T;
}

function couponBody(coupon?: string) {
    return coupon ? { coupon: { coupon_name: coupon } } : {};
}

// ─── Types (only the fields the dashboard uses) ──────────────────────────
export interface Proxy {
    _id: string;
    name: string;
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
    /** Per-line capabilities. `openvpn.available: false` means GET /openvpn will refuse. */
    features?: {
        p0f?: {
            server_supported: boolean;
            current_os: string;
            supported_values: string[];
            /** Which value list the line takes. Replaced `provider` (removed) in OpenAPI 3.3.2. */
            vocabulary: 'os_profile' | 'tcp_stack' | null;
            /** Why there is no OS control: the mobile network rewrites it, or anything else. Null when available. */
            unavailable_reason?: 'mobile_network' | 'line' | null;
        };
        openvpn?: { available: boolean; download_url: string | null };
        native_ipv6?: boolean;
    };
    /**
     * Per-protocol connection details. Present on proxies delivered under a
     * credential contract; absent on legacy rows (use the flat fields then).
     * `provider` is an opaque label that can gain new values at any time -
     * never branch on it. Branch on `capabilities`. The one documented value
     * is `coronium_node` (Coronium Node rows, also a top-level `provider`).
     * A row with proxyEndpoints rotates asynchronously (202, see rotate()).
     */
    proxyEndpoints?: {
        provider: string;
        credentials?: string;
        http?: Endpoint;
        socks5?: Endpoint;
        capabilities?: ProxyCapabilities;
    };
    /** `coronium_node` on Coronium Node rows; absent on other rows. */
    provider?: string;
    /** Last observed serving state, where the provider reports one. Informational. */
    providerState?: string;
    providerObservedAt?: string | number | null;
    /**
     * Informational coverage date. `null` or absent = no cap known. It is not a
     * rental deadline; `POST /payment/renewal-quote` is the authority on whether
     * a term can be renewed.
     */
    renewalCoveredUntil?: string | number | null;
}

/** Every flag is optional and defaults to "not supported". New flags can appear. */
export interface ProxyCapabilities {
    rotate?: boolean;
    customCredentials?: boolean;
    rotationInterval?: boolean;
    whitelist?: boolean;
    autoRenew?: boolean;
    replace?: boolean;
    openvpn?: boolean;
    p0f?: boolean;
    cancel?: boolean;
    manualRenewal?: boolean;
    /** Coronium Node rows: protocols that passed qualification of this device. */
    http?: boolean;
    socks5?: boolean;
    udp?: boolean;
    [flag: string]: boolean | undefined;
}

/** Answer of POST /modems/{id}/replace (200). */
export interface ReplaceResult {
    result: 'ok';
    oldModemId: string;
    /** Equals oldModemId when the line was moved instead of swapped. */
    newModemId: string;
    /**
     * true when the line was moved instead of swapped: same id, login, password
     * and expiry, only the ports may change. Your own replace that moves the
     * line and keeps the same ports sends no modem.replaced event, so this
     * answer is the source of truth.
     */
    moved?: boolean;
    newModem: {
        _id: string; name: string; country_code: string | null; carrier_id: string | null;
        host: string | null; http_port: string; socks_port: string;
        proxy_login: string; proxy_password: string; tariff_expired_at: number; isOnline: boolean;
        /** @deprecated removed 2026-11-19. Not an id you can use on every path; ignore it. */
        IMEI?: string;
        /** @deprecated removed 2026-11-19. Not an id you can use on every path; ignore it. */
        portId?: string;
    };
    /** Only for a p0f line. `kept: false` only after allow_without_p0f. */
    p0f?: { required: boolean; kept: boolean; os: string; os_applied: boolean; pending?: boolean; note?: string };
}

export interface RotateResult {
    result: string;
    /** Classic rows: true only when the IP changed. 202 rows: always false (pending). */
    rotated: boolean;
    ip: string | null;
    message: string;
    /** Present (true) on 202 answers from rows with proxyEndpoints: poll rotationStatus(). */
    pending?: boolean;
    status_url?: string;
    retry_after_seconds?: number;
}

export interface RotationStatus {
    state: 'idle' | 'rotating' | 'done' | 'failed';
    ext_ip?: string | null;
    rotated_at?: number | null;
    /**
     * 'device did not confirm the outcome' on a failed rotation means the line is
     * under review: /restart answers 409 until support resolves it. Ignore the
     * "retry after 2 minutes" hint in that case.
     */
    reset_error?: string | null;
    hint?: string | null;
    [field: string]: unknown;
}

/** Answer of PUT /modems/{id}/set-os (200 applied or noop, or 202 pending). */
export interface SetOsResult {
    result: 'ok';
    data: {
        modemId: string;
        /** The OS value now on the line (empty = pass-through). */
        p0f_os?: string;
        /** Coronium Node rows: the value you asked for. */
        requested_os?: string;
        /** true at 200 when the line already had this value: success, nothing changed. */
        noop?: boolean;
        /** true once the line runs the new OS. */
        applied?: boolean;
        /** true on a 202: sent, not yet confirmed. Do not resend. */
        pending?: boolean;
        request_id?: string;
        vocabulary?: 'os_profile' | 'tcp_stack' | null;
        change?: unknown;
        next_change_in_seconds?: number;
        [field: string]: unknown;
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
    /**
     * Per-feature availability in this plan's stock. `count` = units that have it,
     * `all` = every unit has it. `p0f.count` is exactly what a buy with
     * `require: ["p0f"]` can get on this plan.
     */
    features?: {
        p0f: { count: number; all: boolean };
        openvpn: { count: number; all: boolean };
        ipv6_native: boolean;
    };
}

/** One /free-modems row: available units per country, carrier and region. */
export interface StockRow {
    country_id: string;
    carrier_id: string;
    region_id: string | null;
    count: number;
    /** How many of `count` a buy with `require: ["p0f"]` and this region_id can get. */
    p0f_count: number;
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
        discount: { code?: string; type?: 'percent' | 'fixed'; value?: string; amount_usd?: number } | null;
        charged_usd: number;
        balance_before_usd: number | null;
        balance_after_usd: number | null;
        settlement: { asset: string; amount_btc?: number; exchange_rate_usd_per_btc?: number } | null;
    };
}

// /account/proxies/health is not real-time (most lines refresh every 30 minutes
// server-side), so serve one answer for 60 s to every page instead of calling
// it on each render. A failed call is not cached.
const HEALTH_TTL_MS = 60_000;
let healthMemo: { at: number; promise: Promise<HealthResponse> } | null = null;
function cachedHealth(): Promise<HealthResponse> {
    if (healthMemo && Date.now() - healthMemo.at < HEALTH_TTL_MS) return healthMemo.promise;
    const memo = { at: Date.now(), promise: call<HealthResponse>('/account/proxies/health') };
    memo.promise.catch(() => { if (healthMemo === memo) healthMemo = null; });
    healthMemo = memo;
    return memo.promise;
}

// ─── API surface ─────────────────────────────────────────────────────────
export const coronium = {
    account: {
        get: () => call<any>('/account'),
    },
    proxies: {
        list: () => call<{ data: Proxy[] }>('/account/proxies'),
        /** Cached for 60 s in this process: poll it at most once a minute. */
        health: () => cachedHealth(),
        /**
         * Rotate a modem's IP. This call is SYNCHRONOUS - it holds the request
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
         *
         * A row with `proxyEndpoints` answers 202 at once with
         * `{ rotated: false, pending: true }`: poll rotationStatus() every
         * 5-10 s until `done` or `failed`. Never resubmit while pending.
         *
         * Refusals change nothing:
         * - 429 (`rotation_too_soon` / `rotation_cooldown`, classic rows and
         *   rows with proxyEndpoints that are not Coronium Node rows): wait
         *   err.retry_after_seconds (Retry-After), then try again once.
         * - 409 modem_expired (renew_first): renew the line; do not retry.
         * - 409 rotate_unavailable + check_proxy_health: the line is offline; do not loop.
         * - 502 rotation_unconfirmed: the rotation was submitted; poll
         *   rotationStatus(), do not resend.
         * - 409 on a Coronium Node row: read err.code and err.suggested_action.
         *   - First check the message. If err.message contains 'no confirmed
         *     outcome', the line is under review. Stop rotating and contact
         *     support with err.request_id. Retrying never clears it, whatever
         *     suggested_action says.
         *   - modem_rotation_in_progress: poll rotationStatus().
         *   - rotate_unavailable + retry_after_2_minutes: retry once after 120 s.
         *     This refusal has no Retry-After, so err.retry_after_seconds is undefined.
         *   - rotate_unavailable + check_capabilities: the line cannot rotate now; do not loop.
         *   - rental_conflict: reload the proxy list.
         * - 503 on a Coronium Node row (code modem_rotation_in_progress, error
         *   'Rotation unavailable'): rotation is unavailable right now. Do not
         *   poll rotationStatus(); try later.
         * - rotationStatus(): state 'failed' with reset_error 'device did not
         *   confirm the outcome' is the review case above, not "retry after 2 minutes".
         *
         * `requestId` (UUIDv4): generate it with crypto.randomUUID() once per user
         * action and reuse it on network retries, so a retry replays the recorded
         * command instead of issuing a second one. Only rows with proxyEndpoints
         * read it; classic rows ignore it.
         */
        rotate: (id: string, requestId?: string) =>
            call<RotateResult>(`/modems/${encodeURIComponent(id)}/restart`, {
                method: 'POST',
                body: JSON.stringify(requestId ? { request_id: requestId } : {}),
            }),
        rotationStatus: (id: string) =>
            call<RotationStatus>(`/modems/${id}/rotation-status`),
        /**
         * Replace a broken proxy. Remaining time and metadata move to the new one.
         * A p0f line is replaced only by a p0f line; with none available this
         * throws 409 `p0f_replacement_unavailable` and nothing changes. Pass
         * `allow_without_p0f: true` only after your buyer agreed to lose p0f.
         * Key on `newModemId`; ignore newModem.IMEI / portId (deprecated). A
         * `moved: true` answer kept the same id: refetch the line for its ports.
         *
         * Other failures, all with nothing changed:
         * - 400 "No free modems!" (envelope code internal_error, not no_stock):
         *   no replacement in stock now. Retry later, don't loop.
         * - 400 "Your replacements count ran out for today!": daily limit.
         * - 500 "Replacement failed ... Your current proxy is unchanged.": no line
         *   arrived in time and the order was closed; no second line appears later.
         * - 409 request_in_progress: another action on this line is running.
         * - Some lines cannot be replaced through the API and answer 409: either
         *   code action_unsupported (check proxyEndpoints.capabilities.replace
         *   first when proxyEndpoints is present), or code internal_error and an
         *   error that says to contact support. Do not retry these; open a ticket.
         * - 409 "This proxy is being moved right now": a move of this line is
         *   running. Refetch the line in a few minutes; do not resend in parallel.
         * - 500 "The replacement needs a check by support": nothing charged. Do
         *   not retry; open a ticket with err.request_id.
         */
        replace: (id: string, opts: { allow_without_p0f?: boolean } = {}) =>
            call<ReplaceResult>(`/modems/${id}/replace`, {
                method: 'POST',
                body: JSON.stringify(opts.allow_without_p0f ? { allow_without_p0f: true } : {}),
            }),
        /** OS values this line accepts. */
        p0fOptions: (id: string) =>
            call<{ result: string; data: { modemId: string; supported: boolean; vocabulary: 'os_profile' | 'tcp_stack' | null; options: string[]; current: string; next_change_in_seconds: number } }>(
                `/modems/${id}/p0f-options`
            ),
        /**
         * Set the OS fingerprint ('' turns it off).
         * 200 = applied (data.applied: true, or data.noop: true when the line already
         * had that value). 202 with data.pending: true = sent
         * to the line and not yet confirmed: do NOT resend (that answers 409
         * p0f_change_in_progress); read p0f_os on proxies.list() later. Pass the
         * same `requestId` (UUIDv4) on a network retry to get the same answer.
         * Refusals change nothing: 400 p0f_unsupported_on_server,
         * 400 p0f_os_unsupported_on_this_server or p0f_os_not_supported_on_server
         * (body.allowed), 429 one change per 5 minutes, 502 p0f_not_applied
         * (retry in a minute), 404 p0f_unavailable (contact support),
         * 409 p0f_proxy_offline (retry later), 409 rental_conflict.
         */
        setOs: (id: string, os: string, requestId?: string) =>
            call<SetOsResult>(`/modems/${encodeURIComponent(id)}/set-os`, {
                method: 'PUT',
                body: JSON.stringify(requestId ? { os, request_id: requestId } : { os }),
            }),
        /**
         * Download the line's .ovpn profile (text). Check `features.openvpn.available`
         * on the line first: when it is false the call refuses.
         *
         * A line set up in the last 2 hours may still be getting its profile:
         * 503 `openvpn_profile_pending` with `Retry-After` (120 s). Wait and retry
         * the SAME line. Never replace it for this - a new line starts a new wait.
         * Stop (do not retry) on 409 `openvpn_not_supported` and 400
         * `openvpn_disabled`. 502 `openvpn_unavailable` is worth one later retry.
         * Coronium Node lines download their profile once. After it is
         * downloaded or the password changes, this call answers 409
         * `vpn_revoke_required`. Call revokeOpenvpn(), repeating it while it
         * answers 409 `vpn_revoke_pending`, then download again. 409
         * `vpn_not_ready` with suggested_action `retry_later` means wait and
         * retry; with `check_capabilities` it means this line has no OpenVPN
         * right now.
         */
        openvpn: async (id: string, { maxAttempts = 4 } = {}): Promise<string> => {
            for (let attempt = 1; ; attempt++) {
                const r = await fetch(`${BASE}/modems/${encodeURIComponent(id)}/openvpn`, {
                    headers: { Authorization: `Bearer ${KEY}` }, cache: 'no-store',
                });
                if (r.ok) return r.text();
                let body: any = null;
                try { body = await r.json(); } catch { /* not JSON */ }
                const wait = Number(r.headers.get('retry-after')) || 120;
                if (body?.code === 'openvpn_profile_pending' && attempt < maxAttempts) {
                    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 600) * 1000));
                    continue;
                }
                const err: any = new Error(body?.error || `Coronium ${r.status}`);
                Object.assign(err, { status: r.status, code: body?.code, suggested_action: body?.suggested_action,
                    request_id: body?.request_id || r.headers.get('x-request-id'), retry_after_seconds: wait });
                throw err;
            }
        },
        /**
         * Coronium Node lines only: revoke the download-once OpenVPN profile so a new one can be downloaded.
         * Idempotent: on 409 `vpn_revoke_pending` send the same request again until it answers cleanupConfirmed: true.
         * 409 `vpn_not_ready` here means the rental changed or no profile can be revoked: refresh the proxy list.
         * Other line types answer 409 and nothing changes.
         */
        revokeOpenvpn: (id: string) =>
            call<{ result: 'ok'; cleanupConfirmed: true }>(`/modems/${encodeURIComponent(id)}/openvpn/revoke`, { method: 'POST' }),
        /**
         * Auto-rotate every N SECONDS. Minimum 60; 0 disables. Sending minutes
         * here (e.g. 5 meaning "5 minutes") is rejected with a 400 - anything
         * between 1 and 59 is invalid. On a line whose
         * proxyEndpoints.capabilities.rotationInterval is false, the call answers
         * 409 action_unsupported and changes nothing. Use rotate() for on-demand
         * rotation instead. Rows with proxyEndpoints take whole minutes only (a
         * multiple of 60, max 2592000; 90 is a 400), answer 409 when the device
         * is offline and 502 when the change is not confirmed (refresh before
         * retrying), and return {result, applied: true, data: {_id, rotation_interval}}.
         */
        setRotationInterval: (id: string, seconds: number) =>
            call<{ result: string; applied?: boolean; data: { _id: string; name?: string; rotation_interval: number } }>(
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
    stock: {
        /** Grouped by country, carrier and region. Public. Not a reservation. */
        byRegion: (query: { country_id?: string; carrier_id?: string; region_id?: string; period?: 'day' | 'week' | 'month' } = {}) => {
            const params = new URLSearchParams({ country_id: '*', ...query } as Record<string, string>);
            return call<{ data: StockRow[] }>(`/free-modems?${params}`);
        },
    },
    payment: {
        /**
         * Buy `modemCount` proxies on the tariff. Country and carrier come from
         * the TARIFF - sending them in the body does nothing.
         *
         * `idempotencyKey` must be ONE stable key per buy intent, reused across
         * every retry of that intent. Replaying it within 24h returns the
         * original response (with `X-Idempotency-Replay: true`) instead of
         * provisioning - and charging - a second time. Generate it once, at the
         * point the human clicks Buy, never per HTTP attempt.
         */
        buy: (
            args: {
                tariff_id: string; modemCount: number; metadata?: Record<string, any>; coupon?: string;
                /** Pin the region. Pick one whose /free-modems row has stock (or p0f_count when requiring p0f). */
                region_id?: string;
                /**
                 * Features every proxy in the order must have. Only `p0f` exists today.
                 * No qualifying unit: 409 `p0f_unavailable`, nothing charged or reserved.
                 * Any other value: 400 `unknown_requirement` (`supported: ["p0f"]`).
                 */
                require?: Array<'p0f'>;
                /**
                 * The most the buyer approved, in USD. If the server's total is
                 * higher the API answers 409 `price_changed` with a fresh `quote`
                 * and charges nothing: show it and ask again.
                 */
                max_total_usd?: number;
            },
            lane: 'account_credit' | 'crypto_btc',
            idempotencyKey: string
        ) =>
            call<BuyResult>(lane === 'account_credit' ? '/payment/buy-with-account-credit' : '/payment/buy-modems-with-crypto-balance', {
                method: 'POST',
                // metadata is a String column server-side - send it pre-stringified
                // so it round-trips as the same JSON you sent.
                body: JSON.stringify({
                    tariff_id: args.tariff_id,
                    modemCount: args.modemCount,
                    ...(args.region_id ? { region_id: args.region_id } : {}),
                    ...(args.require?.length ? { require: args.require } : {}),
                    ...(args.metadata ? { metadata: JSON.stringify(args.metadata) } : {}),
                    // Coupons apply on both balance lanes. The charged price
                    // is whatever `billing.charged_usd` says - never compute it.
                    ...(args.coupon ? { coupon: { coupon_name: args.coupon } } : {}),
                    ...(args.max_total_usd != null ? { max_total_usd: args.max_total_usd } : {}),
                }),
                headers: { 'Idempotency-Key': idempotencyKey },
            }),
        renewalQuote: (modemId: string, days: number, coupon?: string) =>
            call<{ currency: 'USD'; total_usd: number; total_cents: number; line_items: any[] }>('/payment/renewal-quote', {
                method: 'POST', body: JSON.stringify({ modems: [{ modem_id: modemId, days }], ...couponBody(coupon) }),
            }),
        /**
         * Pass the same coupon you quoted with, or the charge will differ from the quote.
         * `maxTotalUsd` binds the charge to the approved quote: above it the API
         * answers 409 `price_changed` with a fresh `quote` and charges nothing.
         * Other refusals: 400 insufficient_balance, 409 renewal_already_pending
         * (already paid, still applying: do not retry), 429 renewal_burst (wait
         * 10 minutes), 409 duplicate_request (read `reason`; keep the same key).
         */
        renew: (modemId: string, days: number, lane: 'account_credit' | 'crypto_btc', idempotencyKey: string, coupon?: string, maxTotalUsd?: number) =>
            call<BuyResult>(lane === 'account_credit' ? '/payment/renew-with-account-credit' : '/payment/renew-modems-with-crypto-balance', {
                method: 'POST', body: JSON.stringify({
                    modems: [{ modem_id: modemId, days }], ...couponBody(coupon),
                    ...(maxTotalUsd != null ? { max_total_usd: maxTotalUsd } : {}),
                }),
                headers: { 'Idempotency-Key': idempotencyKey },
            }),
    },
    payments: {
        /**
         * Follow one payment, for example after a 503 PAYMENT_DELIVERY_UNCONFIRMED
         * or a 500 that carried `paymentId`: the balance was charged, so check
         * this before starting a new order.
         */
        status: (id: string) => call<any>(`/payments/${encodeURIComponent(id)}/status`),
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
