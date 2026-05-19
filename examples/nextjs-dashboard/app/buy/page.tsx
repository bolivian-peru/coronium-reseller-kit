import { coronium } from '@/lib/coronium';
import { customers } from '@/lib/customers';
import { BuyForm } from './buy-form';

export const dynamic = 'force-dynamic';

export default async function BuyPage({ searchParams }: { searchParams: { customer_id?: string } }) {
    const localCustomers = customers.list();
    let tariffs: any[] = [];
    let err: string | null = null;
    try {
        const r = await coronium.tariffs.listAvailable();
        tariffs = r.data || [];
    } catch (e: any) {
        err = e.message;
    }

    return (
        <main>
            <h1 className="text-2xl font-semibold mb-6">Buy a proxy</h1>
            {err && (
                <div className="card mb-6 border-red-900/60 bg-red-950/40 text-red-200">{err}</div>
            )}
            <BuyForm
                tariffs={tariffs}
                customers={localCustomers}
                defaultCustomerId={searchParams.customer_id}
            />
        </main>
    );
}
