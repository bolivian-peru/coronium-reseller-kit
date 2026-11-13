# Customer mapping via the `metadata` field

How to track which Coronium modem belongs to each end-customer, including after an auto-swap.

## The mechanism

Every modem can carry optional `metadata` that maps it to your end-customer. Buy and update requests accept a JSON object or a string. Objects are JSON-serialized before storage; strings are preserved. `GET /account/proxies` returns the stored string, not a parsed object. A plain string need not contain JSON, so parse defensively.

Attach it when you buy. Both `{"customer_id":"acme-007"}` as an object and its serialized string are accepted. This example uses the string form:

```json
POST /api/v3/payment/buy-modems-with-crypto-balance
{
  "tariff_id": "<tariff _id from GET /api/v3/tariffs/available>",
  "modemCount": 1,
  "max_total_usd": 97,
  "metadata": "{\"customer_id\":\"acme-007\",\"tag\":\"tiktok-batch\",\"internal_invoice\":\"INV-2026-04-1213\"}"
}
```

`max_total_usd` is the total the buyer approved (tariff `price` x `modemCount`). If the price moved above it, the answer is `409 price_changed` and nothing was charged.

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

Keep the same `Idempotency-Key` and exact body when retrying one purchase. Save its order/payment ID, returned modem IDs and complete intended metadata in your own durable store. An already-delivered retry must preserve edits made after delivery; it is not a way to restore the original metadata. An omitted, null or missing metadata value alone says nothing about whether the payment or delivery completed.

## Keep a durable mapping alongside metadata

Metadata makes the current proxy row self-describing, but it is not your only receipt.
Keep an order/payment/modem-to-customer index and a durable signed webhook inbox.
A modem can leave your account before your worker processes its replacement event;
metadata can also be edited or missing on an older line. Retain the original purchase
receipt and complete metadata value for reconciliation.

## Replacements keep metadata

Replacements copy metadata and remaining paid time, including across chains (A → B → C).
After a signed `modem.replaced` event, reconcile the old and new IDs from your durable
index, then fetch `GET /account/proxies` for the current owned row and connection details.
Do not automatically re-stamp the replacement: a later intentional edit could otherwise
be overwritten. Backfill your local index from current proxy rows before starting an
existing account's webhook worker.

## Recover a missing mapping without buying again

1. Match the purchase receipt or verified replacement chain to the exact modem ID and
   your local end-customer record. An IP, port or device name is not enough.
2. Fetch the current `GET /account/proxies` row and verify it is still in your account.
   If it is gone, the receipt conflicts, or its metadata maps it to someone else, stop
   for review. Do not edit a recycled line or guess the customer.
3. If the mapping is confirmed missing, submit the complete intended metadata through
   `PUT /modems/{id}/set-metadata`. Preserve all intended keys, not just `customer_id`.
   This replaces the field and has no compare-and-set guard; serialize your own edits
   and stop if you cannot establish the current value safely.
4. After `200 {"result":"ok"}`, read the owned row again and verify the stored value.

Missing metadata is not proof of a failed purchase. Reconcile the original payment
status and delivered modem IDs; never place another order, invent a new idempotency
key, or replay an old payment just to repair metadata. Existing missing values are
not automatically backfilled by a fix to new purchases.

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
- Anything secret - metadata is returned in plaintext to any API call with your JWT
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

`PUT /api/v3/modems/{id}/set-metadata` with `{"metadata": "<json string>"}` or `{"metadata": {"customer_id": "acme-007"}}` replaces the entire field. There is no partial merge or compare-and-set guard. Send the complete intended value, then verify it through `GET /account/proxies`.

Use it for intentional mapping edits or the verified recovery procedure above. A replacement event alone is not a reason to write metadata again.

## Don't put end-customer auth in metadata

Tempting: "I'll just put a `customer_token` in metadata and use it to authenticate that customer to my dashboard." Don't. Metadata is plaintext, accessible to anyone with your reseller JWT, and not designed for secrets. Run your own auth layer on top.
