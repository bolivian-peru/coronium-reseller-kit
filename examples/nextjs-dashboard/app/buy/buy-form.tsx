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
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [err, setErr] = useState<string | null>(null);

    const tariffsForCountry = useMemo(
        () => inStock.filter((t) => t.country_code === country),
        [inStock, country]
    );
    const selectedTariff = useMemo(
        () => tariffs.find((t) => t._id === tariff_id),
        [tariffs, tariff_id]
    );

    async function buy(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        setResult(null);
        try {
            const r = await fetch('/api/coronium/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tariff_id, modemCount: count, customer_id, tag: tag || null }),
            });
            const body = await r.json();
            if (!r.ok) throw new Error(body?.error || `Failed (${r.status})`);
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
                        <option value="">— pick a country —</option>
                        {countries.map((c) => (
                            <option key={c.code} value={c.code}>{c.name}</option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Tariff</span>
                    <select className="input" value={tariff_id} onChange={(e) => setTariffId(e.target.value)} required disabled={!country}>
                        <option value="">{country ? '— pick a plan —' : 'pick a country first'}</option>
                        {tariffsForCountry.map((t) => (
                            <option key={t._id} value={t._id}>
                                {t.name} — ${t.price} · stock {t.stock}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Customer</span>
                    <select className="input" value={customer_id} onChange={(e) => setCustomerId(e.target.value)} required>
                        <option value="">— pick customer —</option>
                        {customers.map((c) => (
                            <option key={c.id} value={c.id}>{c.id} — {c.name}</option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Count</span>
                    <input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
                </label>

                <label className="flex flex-col gap-1 md:col-span-2">
                    <span className="text-xs uppercase text-zinc-400 tracking-wide">Tag (optional — goes into metadata)</span>
                    <input className="input" placeholder="eg tiktok-batch, april-campaign" value={tag} onChange={(e) => setTag(e.target.value)} />
                </label>

                {selectedTariff && (
                    <div className="md:col-span-2 text-sm text-zinc-400">
                        Total wholesale: <strong className="text-zinc-100">${(selectedTariff.price * count).toFixed(2)}</strong> · charged to your Coronium balance
                    </div>
                )}

                <div className="md:col-span-2 flex items-center justify-between">
                    {err && <span className="text-red-400 text-sm">{err}</span>}
                    <button className="btn" type="submit" disabled={busy || !tariff_id || !customer_id}>
                        {busy ? 'Buying…' : `Buy ${count} proxy${count === 1 ? '' : 'ies'}`}
                    </button>
                </div>
            </form>

            {result?.data && (
                <div className="card mt-6 border-emerald-700/60 bg-emerald-900/20">
                    <h2 className="font-medium mb-3 text-emerald-300">✓ {result.data.length} proxy{result.data.length === 1 ? '' : 'ies'} provisioned</h2>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-zinc-950 border border-zinc-800 rounded p-3">{JSON.stringify(result.data, null, 2)}</pre>
                </div>
            )}
        </>
    );
}
