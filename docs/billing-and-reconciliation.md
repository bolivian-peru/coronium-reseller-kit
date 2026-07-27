# Billing, carrier and webhook receipt

Everything you need to reconcile a purchase or renewal **from the response alone** — no
second API call, no database lookup.

Applies to the two balance lanes, which is what resellers use:

| Endpoint | Lane |
|---|---|
| `POST /api/v3/payment/buy-with-account-credit` | `account_credit` |
| `POST /api/v3/payment/renew-with-account-credit` | `account_credit` |
| `POST /api/v3/payment/buy-modems-with-crypto-balance` | `crypto_btc` |
| `POST /api/v3/payment/renew-modems-with-crypto-balance` | `crypto_btc` |

---

## The 200 response

```jsonc
{
  "result": "ok",
  "charged_usd": 9.9,          // convenience mirror of billing.charged_usd
  "currency": "USD",
  "data": [ /* the proxies you just bought or renewed */ ],
  "billing": { /* see below */ },
  "webhook": { /* see below */ }
}
```

`result`, `charged_usd`, `currency` and `data` have never changed shape. `billing` and
`webhook` are additive — safe to ignore if you don't need them.

---

## `billing` — what you were charged, and why

```jsonc
{
  "schema_version": 1,
  "action": "purchase",             // or "renewal"
  "lane": "account_credit",         // or "crypto_btc"
  "currency": "USD",

  "line_items": [
    {
      "modem_id": "6a5f…",          // null on purchase (stock isn't chosen yet)
      "plan": "30-Day Plan",
      "days": 30,
      "pricing_basis": "tariff",    // tariff | plan_fixed | legacy_per_day
      "quantity": 1,
      "unit_price_usd": 99,
      "line_total_usd": 99
    }
  ],

  "subtotal_usd": 99,               // price BEFORE coupon
  "discount": {                     // null when no coupon applied
    "code": "SAVE10",
    "type": "percent",              // percent | fixed
    "value": "10%",
    "amount_usd": 9.9
  },
  "charged_usd": 89.1,              // price AFTER coupon — what actually left your balance

  "balance_before_usd": 500,        // account_credit lane; null on crypto
  "balance_after_usd": 410.9,

  "settlement": null                // crypto lane only; see below
}
```

### Price with and without coupon

This is the part you asked for, explicitly:

- **without coupon** → `billing.subtotal_usd`
- **discount applied** → `billing.discount.amount_usd` (and `.code` / `.type` / `.value`)
- **with coupon / actually charged** → `billing.charged_usd`

### Invariants — these always hold to the cent

```
Σ line_items[].line_total_usd == subtotal_usd
subtotal_usd - (discount.amount_usd || 0) == charged_usd
balance_before_usd - charged_usd == balance_after_usd
charged_usd == top-level charged_usd
```

Sub-cent rounding residue is folded onto the **last** line item, so the sum always
reconciles exactly — you never have to tolerate a 1-cent drift.

`discount.amount_usd` is the **observed** delta (`subtotal - charged`), not a
recomputation of the coupon rule. If a coupon partially applies, the number still ties out.

### Coupons only apply on the `account_credit` lane

On `crypto_btc`, `discount` is **always `null`** and `subtotal_usd == charged_usd`. That is
reported truthfully rather than hidden — if you need coupons, use the credit lane.

### `settlement` (crypto lane only)

```jsonc
"settlement": {
  "asset": "BTC",
  "amount_btc": 0.00021437,
  "exchange_rate_usd_per_btc": 92150.44,
  "balance_before_btc": 0.01337,
  "balance_after_btc": 0.01315563
}
```
USD figures are 2dp, BTC 8dp. `balance_before_usd` / `balance_after_usd` are `null` here
because the lane settles in BTC.

### When `billing` is absent

Only on a genuine `200`. It never appears on `4xx`, `5xx`, or a `503`-with-refund. If you
got a non-2xx, there is nothing to reconcile — no money moved.

---

## `carrier` — required for correct renewal pricing

Every proxy in `data[]`, and every proxy from `GET /api/v3/account/proxies`, now carries:

```jsonc
"carrier": { "_id": "67c8417b…", "name": "T-Mobile Premium", "code": "TMOBPREM" }
```

`null` when it cannot be resolved. The key is always present, so branch on
`proxy.carrier === null`, never on `undefined`.

> **Why this matters.** Coronium bills a renewal against **that modem's own tariff**.
> Before 2026-07-27 the API returned only a bare `carrier_id` with no name, because
> carriers live embedded inside the country document and nothing resolved them. If your
> renewal-options logic filters by carrier, that filter silently never fired and you could
> offer the cheapest same-country plan across **all** carriers — e.g. quoting a $99/mo
> France Free modem at the $79/mo LycaMobile price, with your cost floor blind to the real
> cost. Filter on `carrier._id`, and price against the plan for that carrier.

---

## `webhook` — will an event arrive for this order?

```jsonc
"webhook": {
  "configured": true,
  "event": "proxy.purchased",       // or "proxy.renewed"
  "event_id": "3f1a…-uuid",
  "status": "queued",
  "delivery": "pending"
}
```

| Field | Meaning |
|---|---|
| `configured` | `false` ⇒ you have no `https` webhook URL registered, so **no event is coming**. Fix with `PUT /api/v3/account/webhook`. |
| `event_id` | The id the delivered event will carry. **Correlate on this**, and dedupe on it. |
| `status` | About our **outbox**: `queued` (durably recorded) · `not_configured` · `disabled` · `error` |
| `delivery` | The outbox row's state at response time — normally `pending`, because delivery happens after this response is already on the wire. |

**`status: "queued"` does not mean delivered.** It means the event is durably stored and the
delivery worker owns it. Treat the webhook POST as the delivery signal; treat `event_id` as
the correlation key.

This exists so "Coronium never sent it" and "our receiver is down" stop looking identical.
If `configured` is `false`, stop debugging your receiver — nothing was ever going to arrive.

---

## Reconciling in practice

```js
const r = await buy({ tariff_id, modemCount: 1, coupon: { coupon_name: 'SAVE10' } });

// what you paid, and the margin you have to price against
const cost   = r.billing.charged_usd;
const listed = r.billing.subtotal_usd;
const saved  = r.billing.discount?.amount_usd ?? 0;

// prove the math without a DB call
console.assert(listed - saved === cost);
console.assert(r.billing.balance_before_usd - cost === r.billing.balance_after_usd);

// price the eventual renewal against the RIGHT product
const carrier = r.data[0].carrier;          // {_id, name, code}

// know whether to expect a webhook, and what to match it on
if (r.webhook.configured) awaitEvent(r.webhook.event_id);
else console.warn('no webhook URL registered — register one or poll instead');
```

---

## Related

- [webhook-integration.md](webhook-integration.md) — envelope, signature, event catalogue, retries
- [pricing-markup.md](pricing-markup.md) — turning `charged_usd` into your customer price
- Live API reference: <https://api.coronium.io/api-docs>
