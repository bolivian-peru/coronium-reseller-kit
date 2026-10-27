'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// HTML forms only send GET or POST, so a DELETE needs fetch() from a client component.
export function DeleteButton({ id }: { id: string }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const router = useRouter();

    async function remove() {
        if (!confirm(`Delete customer ${id}?`)) return;
        setBusy(true);
        setErr(null);
        try {
            const r = await fetch(`/api/customers?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            const body = await r.json().catch(() => null);
            // 409: the customer still has assigned proxies; reassign them first.
            if (!r.ok) throw new Error(body?.error || `Failed (${r.status})`);
            router.refresh();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <span className="inline-flex flex-col items-end gap-1">
            <button className="btn-danger text-xs" type="button" disabled={busy} onClick={remove}>
                {busy ? 'Deleting…' : 'Delete'}
            </button>
            {err && <span className="text-red-400 text-xs max-w-xs text-right">{err}</span>}
        </span>
    );
}
