'use client';

import { useState } from 'react';

export function RenewForm({ modemId, customerId }: { modemId: string; customerId: string }) {
    const [days, setDays] = useState(30);
    const [lane, setLane] = useState<'account_credit' | 'crypto_btc'>('account_credit');
    const [quote, setQuote] = useState<{ total_usd: number; total_cents: number } | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    async function submit(action: 'quote' | 'renew') {
        setBusy(true);
        setMessage('');
        const payload = { modem_id: modemId, customer_id: customerId, days, lane };
        const storageKey = `coronium-pending-renew:${JSON.stringify(payload)}`;
        let intent: { key: string; createdAt: number } | null = null;
        if (action === 'renew') {
            try { intent = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { /* stale storage */ }
            if (intent && Date.now() - intent.createdAt > 23 * 60 * 60 * 1000) {
                setMessage('This renewal is older than the API replay window. Check the modem expiry and payment history before starting a new renewal.');
                setBusy(false);
                return;
            }
            if (!intent) {
                intent = { key: crypto.randomUUID(), createdAt: Date.now() };
                sessionStorage.setItem(storageKey, JSON.stringify(intent));
            }
        }
        try {
            const response = await fetch('/api/coronium/renew', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, action, idempotency_key: intent?.key, expected_total_cents: quote?.total_cents }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
            if (action === 'quote') setQuote(data);
            else if (response.status === 202) setMessage(data.error);
            else {
                sessionStorage.removeItem(storageKey);
                setQuote(null);
                setMessage('Renewal confirmed. Refresh to see the new expiry.');
            }
        } catch (error: any) {
            setMessage(error.message);
        } finally { setBusy(false); }
    }

    return <div className="flex flex-col gap-1 min-w-40">
        <div className="flex gap-1">
            <select className="input" value={days} onChange={e => { setDays(Number(e.target.value)); setQuote(null); }}>
                <option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option>
            </select>
            <select className="input" value={lane} onChange={e => { setLane(e.target.value as typeof lane); setQuote(null); }}>
                <option value="account_credit">Credit</option><option value="crypto_btc">BTC</option>
            </select>
        </div>
        <button className="btn" type="button" disabled={busy} onClick={() => submit(quote ? 'renew' : 'quote')}>
            {busy ? 'Checking…' : quote ? `Confirm $${quote.total_usd.toFixed(2)}` : 'Get renewal quote'}
        </button>
        {message && <span className="text-xs text-amber-300">{message}</span>}
    </div>;
}
