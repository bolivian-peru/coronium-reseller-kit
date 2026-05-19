import { webhookEvents } from '@/lib/customers';

export const dynamic = 'force-dynamic';

export default function EventsPage() {
    const events = webhookEvents.recent(50);
    return (
        <main>
            <h1 className="text-2xl font-semibold mb-6">Webhook events</h1>
            <p className="text-sm text-zinc-400 mb-6">
                Auto-swap events from Coronium. Last 50. Endpoint:{' '}
                <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-emerald-400">
                    POST /api/coronium/webhook
                </code>{' '}
                — register it once with{' '}
                <code className="bg-zinc-900 px-1.5 py-0.5 rounded">PUT /api/v3/account/webhook</code>{' '}
                on the Coronium API.
            </p>
            <section className="card">
                {events.length === 0 ? (
                    <p className="text-zinc-500 text-sm">
                        No events yet. They arrive when one of your customers' modems dies and Coronium auto-swaps it.
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide">
                                <th className="py-1.5">Received</th>
                                <th className="py-1.5">Event</th>
                                <th className="py-1.5">Old modem</th>
                                <th className="py-1.5">New modem</th>
                                <th className="py-1.5">Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((e: any) => (
                                <tr key={e.id} className="border-t border-zinc-800">
                                    <td className="py-2 text-xs text-zinc-400">
                                        {new Date(e.received_at).toISOString().slice(0, 19).replace('T', ' ')}
                                    </td>
                                    <td className="py-2">
                                        <span className={`badge ${e.event === 'modem.replaced' ? 'badge-success' : 'badge-warn'}`}>
                                            {e.event}
                                        </span>
                                    </td>
                                    <td className="py-2 font-mono text-xs">{e.old_modem_id?.slice(0, 12) || '—'}</td>
                                    <td className="py-2 font-mono text-xs">{e.new_modem_id?.slice(0, 12) || '—'}</td>
                                    <td className="py-2 text-xs text-zinc-400">{e.reason || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </main>
    );
}
