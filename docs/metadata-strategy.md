# Customer mapping via the `metadata` field

How to track which Coronium modem belongs to which of your end-customers — without a sidecar database that drifts out of sync.

## The mechanism

Every Modem record in Coronium has a freeform `metadata` field. It's a JSON string. **You control it.** Coronium stores it verbatim and returns it on every `/account/proxies` call.

Stamp it when you buy:

```json
POST /api/v3/payment/buy-modems-with-crypto-balance
{
  "tariff_id": "61ef075c5a33f238ac15a8e7",
  "modemCount": 1,
  "metadata": {
    "customer_id": "acme-007",
    "tag": "tiktok-batch",
    "internal_invoice": "INV-2026-04-1213"
  }
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

## Why this beats a sidecar database

If you stored "modem 69b5… belongs to acme-007" in your own Postgres table, you'd need to keep it in sync across:

- Modem replacements (auto-swap creates a new ID — you'd need a webhook handler to update your table)
- Renewals (creates a new payment row, but modem_id stays — you don't strictly need to update, but easy to mishandle)
- Refunds (modem deleted on Coronium side — your table would have a dangling row)
- Manual admin actions on Coronium side

With `metadata`, the truth lives on the modem record. The webhook handler updates `customer_id → new_modem_id` mapping but the `metadata.customer_id` on the new modem is automatically stamped by Coronium when we provision the replacement (we copy it forward in the swap pipeline).

**Wait — is the metadata copied on auto-swap?** Yes, since 2026-05-19 (the auto-swap pipeline calls the same provisioning logic as a manual `/replace` and the metadata flows through). If you find a swapped modem missing the metadata, file a ticket — that's a regression.

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

Right now, metadata is set on purchase and persists. To update it later (e.g., reassigning a proxy to a different customer), use `PUT /api/v3/modems/:id/set-metadata` (if your account has access) or delete + repurchase.

Most reseller flows don't need to update metadata mid-life — the customer_id stays with the modem until it expires or gets replaced.

## Don't put end-customer auth in metadata

Tempting: "I'll just put a `customer_token` in metadata and use it to authenticate that customer to my dashboard." Don't. Metadata is plaintext, accessible to anyone with your reseller JWT, and not designed for secrets. Run your own auth layer on top.
