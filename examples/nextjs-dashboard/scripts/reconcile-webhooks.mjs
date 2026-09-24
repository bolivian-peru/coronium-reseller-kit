const user = process.env.RESELLER_ADMIN_USER;
const password = process.env.RESELLER_ADMIN_PASSWORD;
const base = process.env.RESELLER_INTERNAL_URL || 'http://127.0.0.1:3000';

if (!user || !password) throw new Error('Set RESELLER_ADMIN_USER and RESELLER_ADMIN_PASSWORD');

let running = false;
async function tick() {
    if (running) return;
    running = true;
    try {
        const response = await fetch(new URL('/api/coronium/reconcile', base), {
            method: 'POST',
            headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` },
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`Reconciliation HTTP ${response.status}`);
        const result = await response.json();
        if (result.needsReview) console.warn('[webhooks] events need review:', result.needsReview);
    } catch (error) {
        console.error('[webhooks] reconciliation failed:', error.message);
    } finally { running = false; }
}

await tick();
setInterval(tick, 30000);
