# Pricing & markup

What to charge your customers on top of the wholesale Coronium price.

## The economics

You pay Coronium the price on `/api/v3/tariffs/available`, less any coupon on your account. Take your real cost from `billing.charged_usd` on each order, not from the list. You set your retail price. The delta is your margin.

Your wholesale cost is the live price on `GET /api/v3/tariffs/available` (public, no auth), per
country, carrier and term. It changes with stock, so read it at runtime instead of copying a
number from any document, this one included:

```bash
curl -s https://api.coronium.io/api/v3/tariffs/available \
  | jq -r '.data[] | select(.stock > 0) | "\(.country_code) \(.carrier_name) \(.period): $\(.price)"'
```

Typical retail multipliers in the mobile-proxy reseller market:

| Positioning | Retail multiplier on your wholesale cost |
|---|---|
| API-only, email support | 1.3x - 1.5x |
| Common carriers (US, UK, DE) with chat support | 1.4x - 1.9x |
| Rare locations | 1.4x - 2.2x |

Your actual margin depends on:

- **Support quality.** If you handle 24/7 chat in your customer's language, you can charge 2× the wholesale. If you're API-only with email support, stay at 1.3×.
- **Short paid plan / first-month discount.** Most customers won't sign up at full price. Plan for ~50% conversion from a short paid plan to monthly.
- **Refund rate.** Mobile modems are flaky. Plan for ~5-10% of customers asking for a refund within their first month. Any refund you grant your own customer comes out of your margin, so build that in.
- **Payment-processing fees.** If you accept Stripe, that's 2.9% + $0.30. Crypto is cheaper but tax-complicated. Subtract from your margin.

## Don't undercut

A common mistake: new resellers price at wholesale + 10% to "build volume". This is a death spiral - you cover no support cost, no churn, no payment fees, and your margin doesn't justify the operational overhead.

**Floor: 1.3× wholesale.** Below that you're losing money on every customer.

## Short paid plans

A no-cost test converts at about 5%. A short paid plan (24 hours or 3 days) converts at about 25-40% because the buyer has self-selected. Offer short paid plans, not no-cost ones. Coronium works the same way: there are no trials, and the 24-hour plan is the paid way to test a location before you resell it.

```js
// Plug in your own numbers: wholesale from /tariffs/available, retail from your price list.
const wholesaleMonthly = tariff.price;            // live, per carrier
const monthlyPrice = Math.ceil(wholesaleMonthly * 1.4);
const shortPlanPrice = shortPlanRetail;           // your 24-hour or 3-day retail price
const shortPlanCost = shortTariff.price;          // live wholesale of that short plan

// Per 100 short-plan buyers, if 30 convert to monthly:
const shortPlanMargin = 100 * (shortPlanPrice - shortPlanCost);
const monthlyMargin = 30 * (monthlyPrice - wholesaleMonthly);
```

## Subscription vs pay-per-use

Coronium charges per line for the tariff period you buy (day, week or month), debited from your balance up front at purchase and at each renewal. You can resell:

- **Monthly subscription** (simplest). Resell Coronium's monthly tariff and renew it each period. Collect from your customer before the renewal debits your balance.
- **Pay-per-use** with hourly billing. Wrap each modem in a meter, bill customer per hour they actively use it. More work, higher prices possible, but you carry the inventory risk between sessions.
- **Bundle** (for example 10 modems for one monthly price). Bulk discount. Common for agency customers.

## Pricing display

Show wholesale → retail in your dashboard so YOU can see the margin per customer. Don't show wholesale to customers; they don't need it and it just opens a price-haggling conversation.

In the example `nextjs-dashboard` we surface `markup_pct` per customer for the reseller's own reference. Customers see only their retail price.

## When to renegotiate with Coronium

Published volume pricing: **10% off at 10 or more lines and 15% off at 25 or more lines**. It is
a coupon code on request from <hello@coronium.io>, not applied automatically: send it with each
order and renewal as `"coupon": {"coupon_name": "..."}`. For larger volumes, ask at the same
address. See
[billing-and-reconciliation.md](billing-and-reconciliation.md) for how the discount shows up
in every response.

Contact: <hello@coronium.io> with your account email and current active-proxy count.
