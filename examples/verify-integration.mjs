#!/usr/bin/env node
/**
 * Coronium integration smoke test.
 *
 * Answers the question every reseller has on day one: "is my key actually
 * working, and what can I do with it right now?" - before writing any code.
 *
 *   CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs
 *
 * Read-only by default: it never buys, rotates or changes anything. Add
 * --webhook-test to additionally fire one real signed test event at your
 * registered webhook URL (safe: it only POSTs to a URL you registered).
 *
 * Zero dependencies - Node 18+ built-ins only.
 */

const BASE = process.env.CORONIUM_API_BASE || 'https://api.coronium.io/api/v3';
const KEY = process.env.CORONIUM_API_KEY;
const RUN_WEBHOOK_TEST = process.argv.includes('--webhook-test');

let failures = 0;

const ok = (msg) => console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
const bad = (msg) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`); };
const note = (msg) => console.log(`        ${msg}`);

async function call(path, init) {
    const r = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
            'X-Coronium-Proxy-Credentials': 'separate-protocol-v1', ...(init?.headers || {}) },
    });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    return { status: r.status, body, requestId: r.headers.get('x-request-id') };
}

/** Errors carry {error, code, suggested_action, request_id} - surface all of it. */
function describeError(res) {
    const parts = [`HTTP ${res.status}`, res.body?.error || '(no error string)'];
    if (res.body?.code) parts.push(`code=${res.body.code}`);
    if (res.body?.suggested_action) parts.push(`action=${res.body.suggested_action}`);
    const rid = res.body?.request_id || res.requestId;
    if (rid) parts.push(`request_id=${rid}`);
    return parts.join(' | ');
}

async function main() {
    console.log(`\nCoronium integration check → ${BASE}\n`);

    // 1. Stock is public - proves network/DNS/TLS before we blame the key.
    console.log('1. Reachability + live stock');
    const tariffs = await call('/tariffs/available');
    if (tariffs.status === 200 && Array.isArray(tariffs.body?.data)) {
        const inStock = tariffs.body.data.filter((t) => (t.stock ?? 0) > 0);
        ok(`API reachable - ${inStock.length} tariffs in stock`);
        // Day, week and month plans share devices: count each carrier once
        // (its largest plan stock), never the sum of its terms.
        const byCarrier = new Map();
        for (const t of inStock) {
            const k = `${t.country_code}|${t.carrier_id}`;
            byCarrier.set(k, Math.max(byCarrier.get(k) || 0, t.stock || 0));
        }
        const byCountry = new Map();
        for (const [k, n] of byCarrier) {
            const c = k.split('|')[0];
            byCountry.set(c, (byCountry.get(c) || 0) + n);
        }
        const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        note(top.map(([c, n]) => `${c}:${n}`).join('  '));
        const cheapest = inStock.sort((a, b) => a.price - b.price)[0];
        if (cheapest) note(`cheapest in stock: "${cheapest.name}" $${cheapest.price} → tariff_id ${cheapest._id}`);
    } else {
        bad(`cannot reach the API - ${describeError(tariffs)}`);
        console.log('\n  Stopping: nothing else can pass while the API is unreachable.\n');
        process.exit(1);
    }

    // 2. Region stock and feature counts (public, read-only).
    console.log('\n2. Region stock + feature counts');
    const stock = await call('/free-modems?country_id=*');
    if (stock.status === 200 && Array.isArray(stock.body?.data)) {
        const rows = stock.body.data;
        const shapeOk = rows.every((r) => Number.isInteger(r.count) && Number.isInteger(r.p0f_count)
            && r.p0f_count >= 0 && r.p0f_count <= r.count);
        if (shapeOk) {
            const p0fRows = rows.filter((r) => r.p0f_count > 0);
            ok(`${rows.length} region rows; ${p0fRows.length} hold p0f units (p0f_count > 0)`);
            if (p0fRows[0]) {
                const r = p0fRows[0];
                note(`p0f buy example: tariff for carrier ${r.carrier_id}, body {"region_id":"${r.region_id}","require":["p0f"]}`);
            }
        } else {
            bad('a /free-modems row lacks an integer p0f_count between 0 and count');
        }
    } else {
        bad(`cannot read /free-modems - ${describeError(stock)}`);
    }
    const featureShapeOk = tariffs.body.data.every((t) => {
        const f = t.features;
        return f && Number.isInteger(f.p0f?.count) && typeof f.p0f?.all === 'boolean' && f.p0f.count <= (t.stock ?? 0)
            && Number.isInteger(f.openvpn?.count) && typeof f.openvpn?.all === 'boolean';
    });
    if (featureShapeOk) {
        const withP0f = tariffs.body.data.filter((t) => t.features.p0f.count > 0).length;
        ok(`every tariff carries features.p0f and features.openvpn; ${withP0f} tariffs have p0f stock`);
    } else {
        bad('a /tariffs/available row lacks features.p0f {count, all} or features.openvpn {count, all}');
    }

    if (!KEY) {
        console.log('\n  CORONIUM_API_KEY is not set: the public checks above ran, the account checks did not.\n');
        console.log('  Get your key at https://dashboard.coronium.io → Your Account → API Access, then:');
        console.log('    CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs\n');
        process.exit(1);
    }

    // 3. The key itself.
    console.log('\n3. Authentication');
    const account = await call('/account');
    if (account.status === 200) {
        ok(`key accepted${account.body?.login ? ` - ${account.body.login}` : ''}`);
    } else {
        bad(`key rejected - ${describeError(account)}`);
        note('Copy a fresh JWT from dashboard.coronium.io → Your Account → API Access.');
    }

    // 4. Spending power - a valid key with an empty balance still cannot buy.
    console.log('\n4. Balance');
    if (account.status === 200) {
        ok(`account credit: $${account.body?.accountCredit ?? 0}; BTC and USDT balances available separately`);
        note(`BTC: ${account.body?.btc?.balance ?? 0}; USDT: ${account.body?.usdt?.balance ?? 0}`);
    } else {
        bad('cannot read balances until account authentication succeeds');
    }

    // 5. Inventory + how it maps to your customers.
    console.log('\n5. Your proxies');
    const proxies = await call('/account/proxies');
    if (proxies.status === 200) {
        const list = proxies.body?.data || [];
        ok(`${list.length} proxies on the account`);
        const tagged = list.filter((p) => {
            try { return !!JSON.parse(p.metadata || '{}').customer_id; } catch { return false; }
        });
        note(`${tagged.length} carry a metadata.customer_id, ${list.length - tagged.length} are unattributed`);
        if (list.length > tagged.length) {
            note('Re-stamp unattributed proxies with PUT /modems/{id}/set-metadata.');
        }
        // OpenAPI 3.3.2+: features.p0f carries vocabulary (and 3.3.3 unavailable_reason), never provider.
        const p0fShapeBad = list.filter((p) => !p.features?.p0f || 'provider' in p.features.p0f
            || !('vocabulary' in p.features.p0f) || !('unavailable_reason' in p.features.p0f));
        if (p0fShapeBad.length === 0) {
            const osLines = list.filter((p) => p.features.p0f.server_supported).length;
            ok(`every proxy carries features.p0f.vocabulary and unavailable_reason (${osLines} of ${list.length} have OS control)`);
        } else {
            bad(`${p0fShapeBad.length} proxies have an unexpected features.p0f shape`);
        }
        const asyncRows = list.filter((p) => p.proxyEndpoints).length;
        if (asyncRows) note(`${asyncRows} proxies carry proxyEndpoints: their /restart answers 202, poll rotation-status.`);
        const featureless = list.filter((p) => typeof p.features?.openvpn?.available !== 'boolean');
        if (featureless.length === 0) {
            const vpn = list.filter((p) => p.features.openvpn.available).length;
            ok(`every proxy carries features.openvpn.available (${vpn} of ${list.length} offer OpenVPN)`);
            if (vpn) note('A line set up in the last 2 h may answer 503 openvpn_profile_pending: retry after Retry-After, never replace.');
        } else {
            bad(`${featureless.length} proxies lack features.openvpn.available`);
        }
    } else {
        bad(`cannot list proxies - ${describeError(proxies)}`);
    }

    // 6. Health - the endpoint you poll instead of probing proxies yourself.
    console.log('\n6. Proxy health');
    const health = await call('/account/proxies/health');
    if (health.status === 200) {
        const s = health.body?.summary || {};
        ok(`health readable - active:${s.active ?? 0} degraded:${s.degraded ?? 0} dead:${s.dead ?? 0} expired:${s.expired ?? 0}`);
    } else {
        bad(`cannot read health - ${describeError(health)}`);
    }

    // 7. Webhook - the difference between knowing a modem died and not.
    console.log('\n7. Webhook');
    const webhook = await call('/account/webhook');
    if (webhook.status !== 200) {
        bad(`cannot read webhook config - ${describeError(webhook)}`);
    } else if (webhook.body?.webhook_url) {
        const url = new URL(webhook.body.webhook_url);
        ok(`registered: ${url.origin}${url.pathname}`);
        if (RUN_WEBHOOK_TEST) {
            const test = await call('/account/webhook/test', { method: 'POST' });
            if (test.status === 200) {
                ok(`test event delivered - ${JSON.stringify(test.body)}`);
            } else {
                bad(`test event failed - ${describeError(test)}`);
            }
        } else {
            note('Re-run with --webhook-test to fire a real signed event at it.');
        }
    } else {
        bad('no webhook_url registered - you will not be told when a modem dies');
        note("PUT /account/webhook with {\"webhook_url\":\"https://your-host/...\"} (HTTPS, public).");
    }

    console.log(
        failures === 0
            ? '\n\x1b[32mAll checks passed.\x1b[0m Use account credit or BTC to buy. Keep the same Idempotency-Key on retries.\n'
            : `\n\x1b[31m${failures} check(s) failed.\x1b[0m See the notes above.\n`
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(`\nUnexpected error: ${e.message}\n`);
    process.exit(1);
});
