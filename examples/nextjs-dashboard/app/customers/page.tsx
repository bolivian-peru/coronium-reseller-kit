import { customers } from '@/lib/customers';
import Link from 'next/link';
import { CustomerForm } from './customer-form';

export const dynamic = 'force-dynamic';

export default function CustomersPage() {
    const list = customers.list();
    return (
        <main>
            <h1 className="text-2xl font-semibold mb-6">Customers</h1>
            <section className="card mb-6">
                <h2 className="text-sm font-medium mb-3 text-zinc-400 uppercase tracking-wide">Add / update</h2>
                <CustomerForm />
            </section>
            <section className="card">
                <h2 className="text-sm font-medium mb-3 text-zinc-400 uppercase tracking-wide">{list.length} customer{list.length === 1 ? '' : 's'}</h2>
                {list.length === 0 ? (
                    <p className="text-zinc-500 text-sm">No customers yet. Add one above, then buy a proxy on their behalf at <Link className="text-emerald-400 hover:underline" href="/buy">/buy</Link>.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide">
                                <th className="py-1.5">ID</th>
                                <th className="py-1.5">Name</th>
                                <th className="py-1.5">Email</th>
                                <th className="py-1.5">Markup</th>
                                <th className="py-1.5">Notes</th>
                                <th className="py-1.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((c) => (
                                <tr key={c.id} className="border-t border-zinc-800">
                                    <td className="py-2 font-mono text-xs">
                                        <Link href={`/customers/${c.id}`} className="text-emerald-400 hover:underline">{c.id}</Link>
                                    </td>
                                    <td className="py-2">{c.name}</td>
                                    <td className="py-2 text-zinc-400">{c.email || '—'}</td>
                                    <td className="py-2 text-zinc-400">{c.markup_pct != null ? `${c.markup_pct}%` : '—'}</td>
                                    <td className="py-2 text-zinc-400 text-xs">{c.notes?.slice(0, 60) || '—'}</td>
                                    <td className="py-2 text-right">
                                        <DeleteButton id={c.id} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </main>
    );
}

function DeleteButton({ id }: { id: string }) {
    // Server component renders a form that POSTs to DELETE /api/customers?id=…
    // For brevity we keep it as a plain HTML form with a hidden _method override.
    // Real apps: use a client component with confirm() prompt.
    return (
        <form action={`/api/customers?id=${encodeURIComponent(id)}`} method="DELETE" onSubmit={() => undefined}>
            <button className="btn-danger text-xs" type="submit" formMethod="DELETE">Delete</button>
        </form>
    );
}
