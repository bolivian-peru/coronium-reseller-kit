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
                // Metadata is not copied to the replacement by Coronium. Do
                // the remote write first; if it fails, the event remains pending.
                await coronium.proxies.setMetadata(data.new_modem_id, JSON.parse(prior.metadata));
                assignments.replace(data.old_modem_id, data.new_modem_id, prior.customer_id, prior.metadata);
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
