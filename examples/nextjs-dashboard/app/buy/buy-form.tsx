'use client';

import { useMemo, useState } from 'react';

export function BuyForm({
    tariffs,
    customers,
    defaultCustomerId,
}: {
    tariffs: any[];
    customers: any[];
    defaultCustomerId?: string;
}) {
    const inStock = useMemo(() => tariffs.filter((t) => (t.stock ?? 0) > 0), [tariffs]);
    const countries = useMemo(() => {
        const set = new Map<string, { code: string; name: string }>();
        for (const t of inStock) {
            if (t.country_code && !set.has(t.country_code)) {
                set.set(t.country_code, { code: t.country_code, name: t.country_name || t.country_code });
            }
        }
        return [...set.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [inStock]);

    const [country, setCountry] = useState('');
    const [tariff_id, setTariffId] = useState('');
    const [customer_id, setCustomerId] = useState(defaultCustomerId || '');
    const [count, setCount] = useState(1);
    const [tag, setTag] = useState('');
    const [needP0f, setNeedP0f] = useState(false);
    const [lane, setLane] = useState<'account_credit' | 'crypto_btc'>('account_credit');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [err, setErr] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const tariffsForCountry = useMemo(
        () => inStock.filter((t) => t.country_code === country),
        [inStock, country]
    );
    const selectedTariff = useMemo(
        () => tariffs.find((t) => t._id === tariff_id),
        [tariffs, tariff_id]
    );
    // The API's own count: what a buy with require: ["p0f"] can get on this plan.
    const p0fCount: number = selectedTariff?.features?.p0f?.count ?? 0;

    async function buy(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        setNotice(null);
        setResult(null);
        // The estimate shown below is the approved total: Coronium refuses with
        // 409 price_changed (nothing charged) if its own total is higher.
        const max_total_usd = selectedTariff ? Math.round(Number(selectedTariff.price) * count * 100) / 100 : undefined;
        const payload = { tariff_id, modemCount: count, customer_id, tag: tag || null, lane, need_p0f: needP0f && p0fCount > 0, max_total_usd };
        const serialized = JSON.stringify(payload);
        const storageKey = `coronium-pending-buy:${serialized}`;
        let intent: { key: string; createdAt: number } | null = null;
        try { intent = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { /* stale storage */ }
        if (intent && Date.now() - intent.createdAt > 23 * 60 * 60 * 1000) {
            setErr('This order is older than the API replay window. Check Coronium payments and assigned proxies before starting a new order.');
            setBusy(false);
            return;
        }
        if (!intent) {
            intent = { key: crypto.randomUUID(), createdAt: Date.now() };
            sessionStorage.setItem(storageKey, JSON.stringify(intent));
        }
        try {
            const r = await fetch('/api/coronium/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, idempotency_key: intent.key }),
            });
            const body = await r.json();
            if (r.status === 202 && body?.payment_id) {
                // Charged, still provisioning: not an error. Keep the idempotency key.
                setNotice(`Charged, proxies are still being provisioned. Payment ${body.payment_id}: follow GET /payments/${body.payment_id}/status and do not start a new order for this selection.`);
                return;
            }
            if (body?.refunded === true) {
                // 503 OUT_OF_STOCK / UPSTREAM_DEGRADED after an immediate refund: nothing
                // was charged and the API released the idempotency key, so a new order is safe.
                sessionStorage.removeItem(storageKey);
                setNotice('Not charged (refunded to balance). Pick another plan or retry shortly.');
                return;
            }
            if (r.status === 409 && body?.code === 'price_changed') {
                sessionStorage.removeItem(storageKey);
                throw new Error(`The price is now $${Number(body.quote?.total_usd).toFixed(2)}. Nothing was charged. Reload the page to see current prices before buying.`);
            }
            if (r.status === 202) throw new Error(body?.error || 'Purchase status is uncertain; check the account before retrying.');
            if (!r.ok && body?.payment_id) throw new Error(`${body?.error || `Failed (${r.status})`} Payment ${body.payment_id}: charged - check GET /payments/${body.payment_id}/status before starting a new order.`);
            if (!r.ok) throw new Error(body?.error || `Failed (${r.status})`);
            sessionStorage.removeItem(storageKey);
            setResult(body);
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    }

    if (customers.length === 0) {
        return (
            <div className="card">
                You need at least one customer first. <a href="/customers" className="text-emerald-400 hover:underline">Add a customer →</a>
            </div>
        );
    }

    return (
        <>
            <form onSubmit={buy} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Country</span>
                    <select className="input" value={country} onChange={(e) => { setCountry(e.target.value); setTariffId(''); }} required>
                        <option value="">- pick a country -</option>
                        {countries.map((c) => (
                            <option key={c.code} value={c.code}>{c.name}</option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Tariff</span>
                    <select className="input" value={tariff_id} onChange={(e) => setTariffId(e.target.value)} required disabled={!country}>
                        <option value="">{country ? '- pick a plan -' : 'pick a country first'}</option>
                        {tariffsForCountry.map((t) => (
                            <option key={t._id} value={t._id}>
                                {t.name} - ${t.price} · stock {t.stock}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Customer</span>
                    <select className="input" value={customer_id} onChange={(e) => setCustomerId(e.target.value)} required>
                        <option value="">- pick customer -</option>
                        {customers.map((c) => (
                            <option key={c.id} value={c.id}>{c.id} - {c.name}</option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Count</span>
                    <input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
                </label>

                <label className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Tag (optional - goes into metadata)</span>
                    <input className="input" placeholder="eg tiktok-batch, april-campaign" value={tag} onChange={(e) => setTag(e.target.value)} />
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Funding</span>
                    <select className="input" value={lane} onChange={(e) => setLane(e.target.value as typeof lane)}>
                        <option value="account_credit">Account credit (USD)</option>
                        <option value="crypto_btc">BTC wallet</option>
                    </select>
                </label>

                {selectedTariff && (
                    <label className="md:col-span-2 flex items-center gap-2 text-sm text-zinc-300">
                        <input type="checkbox" checked={needP0f && p0fCount > 0} disabled={p0fCount === 0}
                            onChange={(e) => setNeedP0f(e.target.checked)} />
                        Need OS fingerprint (p0f) - available on {p0fCount} of {selectedTariff.stock ?? 0}
                    </label>
                )}

                {selectedTariff && (
                    <div className="md:col-span-2 text-sm text-zinc-400">
                        Estimated wholesale: <strong className="text-zinc-100">${(selectedTariff.price * count).toFixed(2)}</strong> · final charge is confirmed by Coronium
                    </div>
                )}

                <div className="md:col-span-2 flex items-center justify-between">
                    {notice && <span className="text-amber-300 text-sm">{notice}</span>}
                    {err && <span className="text-red-400 text-sm">{err} Retry with the same selection to check the original order before starting another.</span>}
                    <button className="btn" type="submit" disabled={busy || !tariff_id || !customer_id}>
                        {busy ? 'Buying…' : `Buy ${count} ${count === 1 ? 'proxy' : 'proxies'}`}
                    </button>
                </div>
            </form>

            {result?.data && (
                <div className="card mt-6 border-emerald-700/60 bg-emerald-900/20">
                    <h2 className="font-medium mb-3 text-emerald-300">✓ {result.data.length} {result.data.length === 1 ? 'proxy' : 'proxies'} provisioned</h2>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-zinc-950 border border-zinc-800 rounded p-3">{JSON.stringify(result.data, null, 2)}</pre>
                </div>
            )}
        </>
    );
}
