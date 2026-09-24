# Customer mapping via the `metadata` field

How to track which Coronium modem belongs to each end-customer, including after an auto-swap.

## The mechanism

Every Modem record in Coronium has a freeform `metadata` field. It's a JSON string. **You control it.** Coronium stores it verbatim and returns it on every `/account/proxies` call.

Stamp it when you buy. Send it **pre-stringified** — the column is a string server-side, so passing a bare object is not guaranteed to round-trip:

```json
POST /api/v3/payment/buy-modems-with-crypto-balance
{
  "tariff_id": "61ef075c5a33f238ac15a8e7",
  "modemCount": 1,
  "metadata": "{\"customer_id\":\"acme-007\",\"tag\":\"tiktok-batch\",\"internal_invoice\":\"INV-2026-04-1213\"}"
}
```

Read it back:

```json
GET /api/v3/account/proxies
{
  "data": [
    {
      "_id": "69b5926c...",
      "name": "cor_US_NJ_x83",
      "ext_ip": "172.56.171.4",
      ...
      "metadata": "{\"customer_id\":\"acme-007\",\"tag\":\"tiktok-batch\",\"internal_invoice\":\"INV-2026-04-1213\"}"
    }
  ]
}
```

Note: `metadata` comes back as a JSON string, not a parsed object. JSON-parse it on your side.

## Why metadata remains the primary mapping

If you stored "modem 69b5… belongs to acme-007" only in your own database, you'd need to keep it in sync across:

- Renewals (creates a new payment row, but modem_id stays — you don't strictly need to update, but easy to mishandle)
- Refunds (modem deleted on Coronium side — your table would have a dangling row)
- Manual admin actions on Coronium side

With `metadata`, the truth for those cases lives on the modem record itself and `GET /account/proxies` alone tells you who owns what.

## ⚠️ The one case metadata does NOT cover: auto-swap

**Metadata is NOT copied onto the replacement modem.** The swap transfers the remaining paid time and nothing else — the new modem's `metadata` is empty. If you rely on metadata alone, every auto-swapped proxy silently becomes `<unassigned>` and you lose the link to your customer exactly when you most need it.

Handle it in your `modem.replaced` webhook:

```ts
// After you've updated your own record old_modem_id → new_modem_id:
await coronium.proxies.setMetadata(data.new_modem_id, { customer_id: customer.id });
```

Because of this, keep a **minimal durable** `old_modem_id → customer_id + metadata` index and a signed webhook inbox. Backfill the index from current proxy metadata before an existing account begins receiving swap events. Treat metadata as the primary self-describing mapping, and the index as recovery state when the old modem disappears before the event is processed.

## What to put in metadata

Whatever you need to track. Recommended fields:

```json
{
  "customer_id": "acme-007",
  "tag": "campaign-x",
  "purchased_at": 1779192208000,
  "internal_invoice_id": "INV-...",
  "use_case": "tiktok-automation"
}
```

Don't put:

- Credentials (already in the modem record itself)
- Anything secret — metadata is returned in plaintext to any API call with your JWT
- Anything large (we don't enforce a hard limit but >2 KB is wasteful)

## Querying

There's no `?metadata.customer_id=X` filter on `/account/proxies` (yet). For now: fetch the full list and filter client-side:

```ts
const list = await coronium.proxies.list();
const acmeProxies = list.data.filter((p) => {
    try {
        const md = JSON.parse(p.metadata || '{}');
        return md.customer_id === 'acme-007';
    } catch { return false; }
});
```

For >1000 proxies the filter becomes noticeable. At that scale, build an in-memory cache (LRU 5min) of `customer_id → [modem_id]` in your dashboard backend.

## Updating metadata after purchase

`PUT /api/v3/modems/{id}/set-metadata` with `{"metadata": "<json string>"}` replaces it wholesale (there is no partial merge — send the complete object). It accepts a bare object too and stringifies it for you, but sending a string keeps buy and update paths identical.

You need this in two situations: reassigning a proxy to a different customer, and re-stamping a replacement after an auto-swap (see above).

## Don't put end-customer auth in metadata

Tempting: "I'll just put a `customer_token` in metadata and use it to authenticate that customer to my dashboard." Don't. Metadata is plaintext, accessible to anyone with your reseller JWT, and not designed for secrets. Run your own auth layer on top.
