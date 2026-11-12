import { assignments, customers, webhookEvents } from './customers';
import { coronium, parseMetadata } from './coronium';

export async function reconcileWebhooks() {
    const owned = await coronium.proxies.list();
    for (const proxy of owned.data || []) {
        const metadata = parseMetadata(proxy.metadata);
        if (typeof metadata.customer_id === 'string' && customers.get(metadata.customer_id)) {
            assignments.upsert(proxy._id, metadata.customer_id, proxy.metadata || '{}');
        }
    }

    let processed = 0;
    let needsReview = 0;
    for (const row of webhookEvents.pending()) {
        try {
            const event = JSON.parse(row.raw);
            const data = event.data || {};
            if (row.event === 'modem.replaced') {
                if (!data.old_modem_id || !data.new_modem_id) throw new Error('Replacement IDs missing');
                const prior = assignments.get(data.old_modem_id) || assignments.get(data.new_modem_id);
                if (!prior) throw new Error('Old modem has no customer mapping; operator review required');
                const current = (owned.data || []).find(proxy => proxy._id === data.new_modem_id);
                if (!current || parseMetadata(current.metadata).customer_id !== prior.customer_id) {
                    webhookEvents.mark(row.event_id, 'review', current
                        ? 'Replacement metadata is missing or changed; verify the original receipt before repair'
                        : 'Replacement is not in the current owned inventory; operator review required');
                    needsReview++;
                    continue;
                }
                // Keep current metadata, including edits made since the event. A
                // webhook must never overwrite it with an older local snapshot.
                assignments.replace(data.old_modem_id, data.new_modem_id, prior.customer_id, current.metadata!);
            }
            if (row.event === 'modem.dead' || row.event === 'proxy.purchase_failed') {
                webhookEvents.mark(row.event_id, 'review', 'Customer service review required');
                needsReview++;
                continue;
            }
            webhookEvents.mark(row.event_id, 'processed');
            processed++;
        } catch (error: any) {
            webhookEvents.mark(row.event_id, 'pending', error.message || 'Processing failed');
            needsReview++;
        }
    }
    return { processed, needsReview };
}
