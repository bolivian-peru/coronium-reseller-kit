# Pricing & markup

What to charge your customers on top of the wholesale Coronium price.

## The economics

You pay Coronium wholesale (the prices on `/api/v3/tariffs/available`). You set your retail price. The delta is your margin.

Typical retail markups in the mobile-proxy reseller market:

| Geo | Wholesale (1 modem-month) | Common retail | Markup |
|---|---|---|---|
| US T-Mobile 5G | $69 | $89 – $129 | 1.3× – 1.9× |
| US Verizon | $58 | $79 – $99 | 1.4× – 1.7× |
| US AT&T | $49 | $69 – $89 | 1.4× – 1.8× |
| UK EE / Three | $49 | $69 – $89 | 1.4× – 1.8× |
| DE Vodafone | $49 | $69 – $89 | 1.4× – 1.8× |
| AU Telstra | $49 | $69 – $89 | 1.4× – 1.8× |
| Rare geo (Georgia, etc.) | $69 | $99 – $149 | 1.4× – 2.2× |

These are 2026 figures from public reseller catalogues (proxy-cheap.com, mobile-proxy-sites). Your actual margin depends on:

- **Support quality.** If you handle 24/7 chat in your customer's language, you can charge 2× the wholesale. If you're API-only with email support, stay at 1.3×.
- **Trial / first-month discount.** Most customers won't sign up at full price. Plan for ~50% conversion from trial → paid.
- **Refund rate.** Mobile modems are flaky. Plan for ~5-10% of customers asking for a refund within their first month. Build that into your margin.
- **Payment-processing fees.** If you accept Stripe, that's 2.9% + $0.30. Crypto is cheaper but tax-complicated. Subtract from your margin.

## Don't undercut

A common mistake: new resellers price at wholesale + 10% to "build volume". This is a death spiral — you cover no support cost, no churn, no payment fees, and your margin doesn't justify the operational overhead.

**Floor: 1.3× wholesale.** Below that you're losing money on every customer.

## Trial pricing

Free trial converts at ~5%. Paid trial ($1-5 for 24h or 3 days) converts at ~25-40% because the buyer has self-selected. Use paid trials.

```js
// Example: $5 for 3-day trial → $89/month after
const trialPrice = 5;
const monthlyPrice = 89;
const wholesaleMonthly = 69;

// Conversion math:
//   100 trials × $5 = $500 revenue
//   30 of those convert to monthly @ $89 = $2670/mo recurring
//   Of those, you owe Coronium 30 × $69 = $2070 wholesale
//   Your gross margin: $600/mo + the $500 trial revenue (one-time, but it covers ~7 trials' worth of wholesale = $483)
//
// Net per cohort: ~$617 first month, ~$600/mo recurring on retained 30 customers
```

## Subscription vs pay-per-use

Coronium charges monthly per modem. You can resell:

- **Monthly subscription** (simplest). Match Coronium's billing cadence. Customer pays you on the 1st, you pay Coronium from balance throughout the month.
- **Pay-per-use** with hourly billing. Wrap each modem in a meter, bill customer per hour they actively use it. More work, higher prices possible, but you carry the inventory risk between sessions.
- **Bundle** (e.g. "10 modems for $499/month"). Bulk discount. Common for agency customers.

## Pricing display

Show wholesale → retail in your dashboard so YOU can see the margin per customer. Don't show wholesale to customers; they don't need it and it just opens a price-haggling conversation.

In the example `nextjs-dashboard` we surface `markup_pct` per customer for the reseller's own reference. Customers see only their retail price.

## When to renegotiate with Coronium

If you're doing $5k+ MRR on Coronium, ping support — there are volume tiers available beyond the public pricing. We'd rather give you a 10-15% discount and keep you growing than push you to a competitor.

Contact: <hello@coronium.io> with your account email + current MRR.
