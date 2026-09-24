import Link from 'next/link';
import { coronium, parseMetadata, Proxy, HealthRow } from '@/lib/coronium';
import { customers } from '@/lib/customers';
import { notFound } from 'next/navigation';
import { RenewForm } from './renew-form';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const customer = customers.get(id);
    if (!customer) notFound();

    let proxies: Proxy[] = [];
    let healthByModem = new Map<string, HealthRow>();
    let err: string | null = null;

    try {
        const [proxiesRes, healthRes] = await Promise.all([
            coronium.proxies.list(),
            coronium.proxies.health().catch(() => ({ modems: [] as HealthRow[] } as any)),
        ]);
        proxies = (proxiesRes.data || []).filter(
            (p) => parseMetadata(p.metadata).customer_id === id
        );
        for (const h of healthRes?.modems || []) healthByModem.set(h.modem_id, h);
    } catch (e: any) {
        err = e.message;
    }

    return (
        <main>
            <nav className="text-sm text-zinc-500 mb-2">
                <Link href="/customers" className="hover:text-zinc-300">← Customers</Link>
            </nav>
            <h1 className="text-2xl font-semibold">{customer.name}</h1>
            <p className="text-zinc-400 text-sm mt-1">
                <code>{customer.id}</code>
                {customer.email && <> · {customer.email}</>}
                {customer.markup_pct != null && <> · {customer.markup_pct}% markup</>}
            </p>

            {err && (
                <div className="card mt-6 border-red-900/60 bg-red-950/40 text-red-200">{err}</div>
            )}

            <section className="card mt-6">
                <h2 className="text-sm font-medium mb-3 text-zinc-400 uppercase tracking-wide">
                    {proxies.length} active proxy{proxies.length === 1 ? '' : 'ies'}
                </h2>
                {proxies.length === 0 ? (
                    <p className="text-zinc-500 text-sm">
                        No proxies assigned yet. <Link className="text-emerald-400 hover:underline" href={`/buy?customer_id=${customer.id}`}>Buy one for {customer.name}</Link>.
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide">
                                <th className="py-1.5">Name</th>
                                <th className="py-1.5">Connection</th>
                                <th className="py-1.5">Credentials</th>
                                <th className="py-1.5">Status</th>
                                <th className="py-1.5">Expires</th>
                                <th className="py-1.5">Renew</th>
                            </tr>
                        </thead>
                        <tbody>
                            {proxies.map((p) => {
                                const h = healthByModem.get(p._id);
                                const http = p.proxyEndpoints?.http || {
                                    host: p.connection_ip || p.ip_address || '', port: p.http_port,
                                    username: p.proxy_login, password: p.proxy_password,
                                };
                                const socks = p.proxyEndpoints?.socks5 || {
                                    host: p.connection_ip || p.ip_address || '', port: p.socks_port,
                                    username: p.proxy_login, password: p.proxy_password,
                                };
                                return (
                                    <tr key={p._id} className="border-t border-zinc-800">
                                        <td className="py-2 font-mono text-xs">{p.name}</td>
                                        <td className="py-2 font-mono text-xs text-zinc-400">
                                            <div>HTTP {http.host}:{http.port}</div><div>SOCKS5 {socks.host}:{socks.port}</div>
                                        </td>
                                        <td className="py-2 font-mono text-xs text-zinc-400">
                                            <div>HTTP user: {http.username} · password: {http.password}</div>
                                            <div>SOCKS5 user: {socks.username} · password: {socks.password}</div>
                                        </td>
                                        <td className="py-2">
                                            {h
                                                ? <span className={`badge ${h.status === 'active' ? 'badge-success' : h.status === 'degraded' ? 'badge-warn' : 'badge-danger'}`}>{h.status}</span>
                                                : <span className="badge badge-muted">unknown</span>}
                                        </td>
                                        <td className="py-2 text-xs text-zinc-400">
                                            {p.tariff_expired_at ? new Date(p.tariff_expired_at).toISOString().slice(0, 10) : '—'}
                                        </td>
                                        <td className="py-2"><RenewForm modemId={p._id} customerId={customer.id} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </section>
        </main>
    );
}
