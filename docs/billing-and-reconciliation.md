# Billing, carrier and webhook receipt

Everything you need to reconcile a purchase or renewal **from the response alone** - no
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
`webhook` are additive - safe to ignore if you don't need them.

---

## `billing` - what you were charged, and why

```jsonc
{
  "schema_version": 1,
  "action": "purchase",             // or "renewal"
  "lane": "account_credit",         // or "crypto_btc"
  "currency": "USD",

  "line_items": [
    {
      "kind": "modem",
      "modem_id": "6a5f…",          // null on purchase (stock isn't chosen yet)
      "name": null,                 // the line's name on a renewal, null on purchase
      "tariff_id": "65a1…",
      "country_id": "64f0…",
      "carrier_id": "all",          // "all" when the plan is not tied to one carrier
      "plan": "month",              // the term period: day | week | month
      "days": 30,
      "pricing_basis": "plan_fixed", // plan_fixed | legacy_per_day (a purchase is always plan_fixed)
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
  "charged_usd": 89.1,              // price AFTER coupon - what actually left your balance

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

### Invariants - these always hold to the cent

```
Σ line_items[].line_total_usd == subtotal_usd
subtotal_usd - (discount.amount_usd || 0) == charged_usd
balance_before_usd - charged_usd == balance_after_usd
charged_usd == top-level charged_usd
```

Sub-cent rounding residue is folded onto the **last** line item, so the sum always
reconciles exactly - you never have to tolerate a 1-cent drift.

`discount.amount_usd` is the **observed** delta (`subtotal - charged`), not a
recomputation of the coupon rule. If a coupon partially applies, the number still ties out.

### Coupons apply on both balance lanes

Send `"coupon": {"coupon_name": "<code>"}` in the purchase, renewal and renewal-quote body.
It is honoured on `account_credit` and on `crypto_btc`. (Before September 2026 the BTC lane
ignored coupons; if you built against that, re-test.) A missing or expired code does
not necessarily fail the order: it can go through at list price with `discount: null`. So
validate the code up front with `POST /api/v3/coupons/check`, quote before you charge, and
always confirm from `billing.discount` that it was applied before you book your margin.

Any account-specific reseller discount is delivered as a coupon code. Prices returned by
`/tariffs/available` are list prices and never include it, so the discount cannot be applied
twice: `subtotal_usd` is list, `charged_usd` is what you paid.

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

Only on a genuine `200`. It never appears on `202`, `4xx` or `5xx`. That does **not** mean
no money moved - reconcile by `paymentId` whenever an answer carries one:

| Answer | Money | What to do |
|---|---|---|
| `202` with `paymentId` | charged, still provisioning | poll `GET /api/v3/payments/{paymentId}/status`; do not re-order |
| `503 payment_delivery_unconfirmed` with `paymentId` | charged, delivery not verified | same as `202` |
| `503 no_stock` / `upstream_degraded` with `refunded: true` | refunded to your account balance already | safe to retry later or elsewhere |
| `500` with `paymentId` and `refunded: false` | charged, provisioning failed, **no automatic refund in this answer** | check the payment status, open a ticket with the `paymentId`; never re-send the order blindly |
| `4xx`, or `500` without `paymentId` | nothing created, nothing charged | fix and retry |

Refunds always go to your Coronium account balance, never back to a card or wallet.

---

## `carrier` - required for correct renewal pricing

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
> offer the cheapest same-country plan across **all** carriers - e.g. quoting a $99/mo
> plan on one French carrier at another carrier's $79/mo price, with your cost floor blind to the real
> cost. Filter on `carrier._id`, and price against the plan for that carrier.

---

## `webhook` - will an event arrive for this order?

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
| `status` | About our **outbox**: `queued` (durably recorded) · `not_configured` · `error` |
| `delivery` | The outbox row's state at response time - normally `pending`, because delivery happens after this response is already on the wire. |

**`status: "queued"` does not mean delivered.** It means the event is durably stored and the
delivery worker owns it. Treat the webhook POST as the delivery signal; treat `event_id` as
the correlation key.

This exists so "Coronium never sent it" and "our receiver is down" stop looking identical.
If `configured` is `false`, stop debugging your receiver - nothing was ever going to arrive.

---

## Approved price and payment refusals

Send `max_total_usd` on every buy and renew: the total the buyer approved, in USD. For a
renewal take `total_usd` from `POST /payment/renewal-quote`; for a buy, the total you showed
(tariff `price` x `modemCount`, less any coupon). The server compares it with the total it
is about to charge, before any debit.

```js
const q = await renewalQuote({ modems: [{ modem_id, days: 30 }] });
// ... the buyer approves q.total_usd ...
await renew({ modems: [{ modem_id, days: 30 }], max_total_usd: q.total_usd }, { idempotencyKey });
```

| Answer | Meaning | What to do |
|---|---|---|
| `409 price_changed` | The server total is above `max_total_usd`. Nothing was charged; `quote` (`total_usd`, `total_cents`, `line_items`) is the current price | Show `quote.total_usd`, ask again, send the new approval with a new `Idempotency-Key` |
| `400 insufficient_balance` | Account credit is below the total (`reason_code` `INSUFFICIENT_CREDIT`, with `available_usd` and `required_usd`). Nothing was charged | Add funds in the dashboard, then retry |
| `401 "Insufficient crypto balance"` (BTC lane, `code` `internal_error`) | The BTC balance is below the total; `required` and `available` are in BTC. Nothing was charged. Your API key is fine | Fund the BTC balance or use the account-credit lane. Do not regenerate the key |
| `409 duplicate_request` | `new_order_created: false`. `reason`: `idempotency_key_conflict` (key reused with a different body), `recent_identical_request` (same request without a key within 180 s, `Retry-After`), `request_in_progress`, `request_outcome_unknown`, `legacy_request_identity_unknown` | Do not switch to a new key to get past it. Check `GET /account/payments` and `GET /account/proxies` first |
| `409 renewal_already_pending` (account-credit renewal) | A renewal for that line was already paid and is still being applied (`payment_id`). Nothing was charged | Do not retry; follow `GET /payments/{payment_id}/status` |
| `429 renewal_burst` (account-credit renewal) | That line was renewed 3 times in the last 10 minutes. Nothing was charged | Wait 10 minutes, or renew once for a longer term |
| `202` with `paymentId` | Charged, still provisioning | Not an error and not a reason to order again: follow `GET /payments/{paymentId}/status` |

---

## Reconciling in practice

```js
const r = await buy({ tariff_id, modemCount: 1, coupon: { coupon_name: 'SAVE10' } });
if (!r.billing.discount) console.warn('coupon was not applied - charged list price');

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
else console.warn('no webhook URL registered - register one or poll instead');
```

---

## Related

- [webhook-integration.md](webhook-integration.md) - envelope, signature, event catalogue, retries
- [pricing-markup.md](pricing-markup.md) - turning `charged_usd` into your customer price
- Live API reference: <https://api.coronium.io/api-docs>
