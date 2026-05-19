/**
 * Reseller home — proxy inventory grouped by end-customer, with health overlay.
 *
 * Server component: fetches everything server-side via the lib/coronium.ts
 * wrapper. No CORONIUM_API_KEY ever touches the browser.
 */
import Link from 'next/link';
import { coronium, Proxy, HealthRow } from '@/lib/coronium';
import { customers } from '@/lib/customers';

export const dynamic = 'force-dynamic';

async function loadDashboardData() {
    const apiKeySet = !!process.env.CORONIUM_API_KEY;
    if (!apiKeySet) {
        return { apiKeySet: false, proxies: [] as Proxy[], healthByModem: new Map() as Map<string, HealthRow>, err: null as string | null };
    }
    try {
        const [proxiesRes, healthRes] = await Promise.all([
            coronium.proxies.list().catch((e) => ({ error: e.message, data: [] as Proxy[] } as any)),
            coronium.proxies.health().catch((e) => ({ error: e.message, modems: [] as HealthRow[] } as any)),
        ]);
        const proxies = proxiesRes?.data || [];
        const healthByModem = new Map<string, HealthRow>();
        for (const h of healthRes?.modems || []) healthByModem.set(h.modem_id, h);
        const err = proxiesRes?.error || healthRes?.error || null;
        return { apiKeySet, proxies, healthByModem, err };
    } catch (e: any) {
        return { apiKeySet, proxies: [] as Proxy[], healthByModem: new Map() as Map<string, HealthRow>, err: e.message };
    }
}

export default async function HomePage() {
    const { apiKeySet, proxies, healthByModem, err } = await loadDashboardData();
    const localCustomers = customers.list();
    const localCustomerById = new Map(localCustomers.map((c) => [c.id, c]));

    if (!apiKeySet) return <SetupScreen />;

    // Group proxies by metadata.customer_id
    const byCustomer = new Map<string, Proxy[]>();
    for (const p of proxies) {
        let cid = '<unassigned>';
        try {
            const md = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
            if (md?.customer_id) cid = md.customer_id;
        } catch { /* ignore */ }
        if (!byCustomer.has(cid)) byCustomer.set(cid, []);
        byCustomer.get(cid)!.push(p);
    }

    const totalActive = [...healthByModem.values()].filter((h) => h.is_alive).length;
    const totalDead = [...healthByModem.values()].filter((h) => h.status === 'dead').length;

    return (
        <main>
            <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
            {err && (
                <div className="card mb-6 border-red-900/60 bg-red-950/40 text-red-200">
                    Couldn't reach Coronium: {err}
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                <div className="kpi"><div className="kpi-label">Proxies owned</div><div className="kpi-value">{proxies.length}</div></div>
                <div className="kpi"><div className="kpi-label">Alive</div><div className="kpi-value text-emerald-400">{totalActive}</div></div>
                <div className="kpi"><div className="kpi-label">Dead</div><div className="kpi-value text-red-400">{totalDead}</div></div>
                <div className="kpi"><div className="kpi-label">Customers</div><div className="kpi-value">{localCustomers.length}</div></div>
            </div>

            {byCustomer.size === 0 && (
                <div className="card text-zinc-400">
                    No proxies yet. <Link className="text-emerald-400 hover:underline" href="/buy">Buy your first one</Link> to get started.
                </div>
            )}

            {[...byCustomer.entries()].map(([cid, list]) => (
                <section key={cid} className="card mb-4">
                    <header className="flex items-baseline justify-between mb-3">
                        <h2 className="text-lg font-medium">
                            {cid === '<unassigned>'
                                ? <span className="text-zinc-500">Unassigned</span>
                                : (
                                    <>
                                        <Link href={`/customers/${cid}`} className="text-emerald-400 hover:underline">{cid}</Link>
                                        {localCustomerById.get(cid)?.name && (
                                            <span className="text-zinc-400 text-sm ml-2">— {localCustomerById.get(cid)!.name}</span>
                                        )}
                                    </>
                                )
                            }
                        </h2>
                        <span className="text-xs text-zinc-500">{list.length} proxy{list.length === 1 ? '' : 'ies'}</span>
                    </header>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide">
                                <th className="py-1.5">Name</th>
                                <th className="py-1.5">IP</th>
                                <th className="py-1.5">Ports</th>
                                <th className="py-1.5">Status</th>
                                <th className="py-1.5">Expires</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((p) => {
                                const h = healthByModem.get(p._id);
                                return (
                                    <tr key={p._id} className="border-t border-zinc-800">
                                        <td className="py-2 font-mono text-xs">{p.name}</td>
                                        <td className="py-2 font-mono text-xs">{p.ext_ip || '—'}</td>
                                        <td className="py-2 font-mono text-xs text-zinc-400">{p.http_port}/{p.socks_port}</td>
                                        <td className="py-2">
                                            {h ? <HealthBadge h={h} /> : <span className="badge badge-muted">unknown</span>}
                                        </td>
                                        <td className="py-2 text-xs text-zinc-400">
                                            {p.tariff_expired_at
                                                ? new Date(p.tariff_expired_at).toISOString().slice(0, 10)
                                                : '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </section>
            ))}
        </main>
    );
}

function HealthBadge({ h }: { h: HealthRow }) {
    const cls =
        h.status === 'active' ? 'badge-success' :
        h.status === 'degraded' ? 'badge-warn' :
        'badge-danger';
    return <span className={`badge ${cls}`} title={h.hint || ''}>{h.status}</span>;
}

function SetupScreen() {
    return (
        <main>
            <h1 className="text-2xl font-semibold mb-4">Setup required</h1>
            <div className="card">
                <p className="mb-4">
                    Set <code className="text-emerald-400">CORONIUM_API_KEY</code> in your <code>.env</code> file. Get
                    your key from <a className="text-emerald-400 hover:underline" href="https://dashboard.coronium.io" target="_blank" rel="noreferrer">dashboard.coronium.io</a>{' '}
                    → Settings → API.
                </p>
                <pre className="bg-zinc-950 border border-zinc-800 rounded p-3 text-xs font-mono">{`# .env
CORONIUM_API_KEY=eyJ...your-jwt...
`}</pre>
                <p className="mt-4 text-sm text-zinc-400">
                    Then restart <code>npm run dev</code> and refresh this page.
                </p>
            </div>
        </main>
    );
}
