#!/usr/bin/env node
/**
 * Coronium integration smoke test.
 *
 * Answers the question every reseller has on day one: "is my key actually
 * working, and what can I do with it right now?" — before writing any code.
 *
 *   CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs
 *
 * Read-only by default: it never buys, rotates or changes anything. Add
 * --webhook-test to additionally fire one real signed test event at your
 * registered webhook URL (safe: it only POSTs to a URL you registered).
 *
 * Zero dependencies — Node 18+ built-ins only.
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

/** Errors carry {error, code, suggested_action, request_id} — surface all of it. */
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

    if (!KEY) {
        console.log('  CORONIUM_API_KEY is not set.\n');
        console.log('  Get your key at https://dashboard.coronium.io → Settings → API, then:');
        console.log('    CORONIUM_API_KEY=eyJ... node examples/verify-integration.mjs\n');
        process.exit(1);
    }

    // 1. Stock is public — proves network/DNS/TLS before we blame the key.
    console.log('1. Reachability + live stock');
    const tariffs = await call('/tariffs/available');
    if (tariffs.status === 200 && Array.isArray(tariffs.body?.data)) {
        const inStock = tariffs.body.data.filter((t) => (t.stock ?? 0) > 0);
        ok(`API reachable — ${inStock.length} tariffs in stock`);
        const byCountry = new Map();
        for (const t of inStock) {
            byCountry.set(t.country_code, (byCountry.get(t.country_code) || 0) + (t.stock || 0));
        }
        const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        note(top.map(([c, n]) => `${c}:${n}`).join('  '));
        const cheapest = inStock.sort((a, b) => a.price - b.price)[0];
        if (cheapest) note(`cheapest in stock: "${cheapest.name}" $${cheapest.price} → tariff_id ${cheapest._id}`);
    } else {
        bad(`cannot reach the API — ${describeError(tariffs)}`);
        console.log('\n  Stopping: nothing else can pass while the API is unreachable.\n');
        process.exit(1);
    }

    // 2. The key itself.
    console.log('\n2. Authentication');
    const account = await call('/account');
    if (account.status === 200) {
        ok(`key accepted${account.body?.login ? ` — ${account.body.login}` : ''}`);
    } else {
        bad(`key rejected — ${describeError(account)}`);
        note('Copy a fresh JWT from dashboard.coronium.io → Settings → API.');
    }

    // 3. Spending power — a valid key with an empty balance still cannot buy.
    console.log('\n3. Balance');
    if (account.status === 200) {
        ok(`account credit: $${account.body?.accountCredit ?? 0}; BTC and USDT balances available separately`);
        note(`BTC: ${account.body?.btc?.balance ?? 0}; USDT: ${account.body?.usdt?.balance ?? 0}`);
    } else {
        bad('cannot read balances until account authentication succeeds');
    }

    // 4. Inventory + how it maps to your customers.
    console.log('\n4. Your proxies');
    const proxies = await call('/account/proxies');
    if (proxies.status === 200) {
        const list = proxies.body?.data || [];
        ok(`${list.length} proxies on the account`);
        const tagged = list.filter((p) => {
            try { return !!JSON.parse(p.metadata || '{}').customer_id; } catch { return false; }
        });
        note(`${tagged.length} carry a metadata.customer_id, ${list.length - tagged.length} are unattributed`);
        if (list.length > tagged.length) {
            note('Unattributed proxies are usually auto-swap replacements: metadata is NOT');
            note('copied onto a replacement. Re-stamp with PUT /modems/{id}/set-metadata.');
        }
    } else {
        bad(`cannot list proxies — ${describeError(proxies)}`);
    }

    // 5. Health — the endpoint you poll instead of probing proxies yourself.
    console.log('\n5. Proxy health');
    const health = await call('/account/proxies/health');
    if (health.status === 200) {
        const s = health.body?.summary || {};
        ok(`health readable — active:${s.active ?? 0} degraded:${s.degraded ?? 0} dead:${s.dead ?? 0} expired:${s.expired ?? 0}`);
    } else {
        bad(`cannot read health — ${describeError(health)}`);
    }

    // 6. Webhook — the difference between knowing a modem died and not.
    console.log('\n6. Webhook');
    const webhook = await call('/account/webhook');
    if (webhook.status !== 200) {
        bad(`cannot read webhook config — ${describeError(webhook)}`);
    } else if (webhook.body?.webhook_url) {
        const url = new URL(webhook.body.webhook_url);
        ok(`registered: ${url.origin}${url.pathname}`);
        if (RUN_WEBHOOK_TEST) {
            const test = await call('/account/webhook/test', { method: 'POST' });
            if (test.status === 200) {
                ok(`test event delivered — ${JSON.stringify(test.body)}`);
            } else {
                bad(`test event failed — ${describeError(test)}`);
            }
        } else {
            note('Re-run with --webhook-test to fire a real signed event at it.');
        }
    } else {
        bad('no webhook_url registered — you will not be told when a modem dies');
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
