'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CustomerForm() {
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [markup, setMarkup] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const router = useRouter();

    async function save(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
            const r = await fetch('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    name,
                    email: email || null,
                    markup_pct: markup ? Number(markup) : null,
                    notes: notes || null,
                }),
            });
            const body = await r.json();
            if (!r.ok) throw new Error(body?.error || 'Failed');
            setId(''); setName(''); setEmail(''); setMarkup(''); setNotes('');
            router.refresh();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className="input" placeholder="customer id (eg acme-007)" value={id} onChange={(e) => setId(e.target.value)} required />
            <input className="input" placeholder="display name" value={name} onChange={(e) => setName(e.target.value)} required />
            <input className="input" placeholder="email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" placeholder="markup % (optional, display only)" type="number" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            <input className="input md:col-span-2" placeholder="notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="md:col-span-3 flex items-center justify-between gap-3">
                {err && <span className="text-red-400 text-sm">{err}</span>}
                <button className="btn" type="submit" disabled={busy || !id || !name}>
                    {busy ? 'Saving…' : 'Save customer'}
                </button>
            </div>
        </form>
    );
}
