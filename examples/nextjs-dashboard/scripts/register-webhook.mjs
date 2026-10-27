import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Registers this dashboard's webhook receiver once, then fires a signed test.
// Run it after the dashboard is reachable at RESELLER_PUBLIC_URL over HTTPS and
// CORONIUM_WEBHOOK_SECRET is set (create it with POST /account/webhook/secret/rotate).
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const key = process.env.CORONIUM_API_KEY;
const base = (process.env.CORONIUM_API_BASE || 'https://api.coronium.io/api/v3').replace(/\/+$/, '');
const publicUrl = process.env.RESELLER_PUBLIC_URL;

if (!key) throw new Error('Set CORONIUM_API_KEY');
if (!publicUrl) throw new Error('Set RESELLER_PUBLIC_URL to the public HTTPS URL of this dashboard');
const target = new URL('/api/coronium/webhook', publicUrl).toString();
if (!target.startsWith('https://')) throw new Error(`Webhook URL must be HTTPS: ${target}`);

async function call(path, init = {}) {
    const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(`${init.method || 'GET'} ${path}: HTTP ${response.status} ${body?.error || ''}`.trim());
    return body;
}

const current = await call('/account/webhook');
if (!current?.secret?.exists || !process.env.CORONIUM_WEBHOOK_SECRET) {
    console.error('Create the signing secret first: POST /account/webhook/secret/rotate, put it in .env as CORONIUM_WEBHOOK_SECRET and restart the dashboard.');
    process.exit(1);
}

if (current.webhook_url === target) {
    console.log(`Webhook already registered: ${target}`);
} else {
    await call('/account/webhook', { method: 'PUT', body: JSON.stringify({ webhook_url: target }) });
    console.log(`Webhook registered: ${target}${current.webhook_url ? ` (was ${current.webhook_url})` : ''}`);
}

const test = await call('/account/webhook/test', { method: 'POST' });
console.log('Test delivery:', JSON.stringify(test, null, 2));
