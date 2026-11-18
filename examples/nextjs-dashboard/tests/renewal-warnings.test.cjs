const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const filename = path.join(__dirname, '../app/api/coronium/renew/route.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const warning = { modem_id: 'modem-a', code: 'NODE_LINE_NOT_SERVING', message: 'No working connection for over 24 hours.' };

async function request(action, warnings, acknowledged) {
    let renewals = 0;
    const quote = { total_usd: 5, total_cents: 500, ...(warnings ? { warnings } : {}) };
    const coronium = {
        proxies: { list: async () => ({ data: [{ _id: 'modem-a', metadata: '{"customer_id":"customer-a"}' }] }) },
        payment: {
            renewalQuote: async () => quote,
            renew: async () => {
                renewals++;
                return { result: 'ok', data: [{ _id: 'modem-a' }] };
            },
        },
    };
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: name => {
        if (name === 'next/server') return { NextResponse: Response };
        if (name === '@/lib/coronium') return { coronium, parseMetadata: JSON.parse };
        throw Error('Unexpected module ' + name);
    } });
    const response = await exports.POST({ json: async () => ({
        modem_id: 'modem-a', customer_id: 'customer-a', days: 30, action,
        idempotency_key: '00000000-0000-4000-a000-000000000001',
        expected_total_cents: 500, acknowledged_warnings: acknowledged,
    }) });
    return { response, body: await response.json(), renewals };
}

test('quote returns the per-line advisory before approval', async () => {
    const { response, body, renewals } = await request('quote', [warning]);
    assert.equal(response.status, 200);
    assert.deepEqual(body.warnings, [warning]);
    assert.equal(renewals, 0);
});

test('a new or changed advisory returns the fresh quote before charging', async () => {
    for (const old of [undefined, [], [{ ...warning, message: 'Earlier warning' }]]) {
        const { response, body, renewals } = await request('renew', [warning], old);
        assert.equal(response.status, 409);
        assert.equal(body.code, 'renewal_warning_changed');
        assert.deepEqual(body.quote.warnings, [warning]);
        assert.equal(renewals, 0);
    }
});

test('explicit confirmation permits renewal with or without warnings', async () => {
    for (const warnings of [[warning], [], undefined]) {
        const { response, renewals } = await request('renew', warnings, warnings);
        assert.equal(response.status, 200);
        assert.equal(renewals, 1);
    }
});
