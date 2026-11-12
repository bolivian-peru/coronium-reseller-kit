const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/webhook-processing.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

async function run(current, oldId = 'old') {
    const oldMetadata = JSON.stringify({ customer_id: 'customer-a', tag: 'before' });
    const local = new Map([[oldId, { customer_id: 'customer-a', metadata: oldMetadata }]]);
    const marks = [];
    const replacements = [];
    let remoteWrites = 0;
    const data = { old_modem_id: oldId, new_modem_id: 'new' };
    const stores = {
        customers: { get: id => ['customer-a', 'customer-b'].includes(id) },
        assignments: {
            get: id => local.get(id),
            upsert: (id, customer_id, metadata) => local.set(id, { customer_id, metadata }),
            replace: (...args) => replacements.push(args),
        },
        webhookEvents: {
            pending: () => [{ event_id: 'evt-1', event: 'modem.replaced', raw: JSON.stringify({ data }) }],
            mark: (...args) => marks.push(args),
        },
    };
    const api = {
        coronium: { proxies: {
            list: async () => ({ data: current ? [current] : [] }),
            setMetadata: async () => { remoteWrites++; },
        } },
        parseMetadata: raw => {
            try { const value = JSON.parse(raw); return value && typeof value === 'object' ? value : {}; }
            catch { return {}; }
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(compiled, {
        exports: module.exports, module,
        require: name => {
            if (name === './customers') return stores;
            if (name === './coronium') return api;
            throw new Error(`Unexpected dependency: ${name}`);
        },
    });
    const result = await module.exports.reconcileWebhooks();
    return { result, marks, replacements, remoteWrites };
}

test('preserves metadata edited after purchase instead of re-stamping a stale snapshot', async () => {
    const metadata = JSON.stringify({ customer_id: 'customer-a', tag: 'edited', other_key: 'keep' });
    const got = await run({ _id: 'new', metadata });
    assert.equal(got.remoteWrites, 0);
    assert.equal(got.result.processed, 1);
    assert.equal(got.replacements[0][3], metadata);
    assert.equal(got.marks[0][1], 'processed');
});

for (const metadata of [undefined, null, '', '{}', 'plain string', '{bad-json']) {
    test(`missing or unmapped metadata (${String(metadata)}) requires review without remote writes`, async () => {
        const got = await run({ _id: 'new', metadata });
        assert.equal(got.remoteWrites, 0);
        assert.equal(got.replacements.length, 0);
        assert.equal(got.marks[0][1], 'review');
        assert.equal(got.result.needsReview, 1);
    });
}

test('a different current customer mapping is preserved for review', async () => {
    const got = await run({ _id: 'new', metadata: '{"customer_id":"customer-b"}' });
    assert.equal(got.remoteWrites, 0);
    assert.equal(got.replacements.length, 0);
    assert.equal(got.marks[0][1], 'review');
});

test('a replacement absent from owned inventory is never written or rebound', async () => {
    const got = await run(null);
    assert.equal(got.remoteWrites, 0);
    assert.equal(got.replacements.length, 0);
    assert.equal(got.marks[0][1], 'review');
});

test('a move with the same modem id retains the current metadata', async () => {
    const metadata = '{"customer_id":"customer-a","tag":"current"}';
    const got = await run({ _id: 'new', metadata }, 'new');
    assert.equal(got.remoteWrites, 0);
    assert.equal(got.replacements[0][0], 'new');
    assert.equal(got.replacements[0][1], 'new');
    assert.equal(got.replacements[0][3], metadata);
});
