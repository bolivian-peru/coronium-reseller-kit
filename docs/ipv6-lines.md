# IPv6 lines

Three steps. Nothing else is needed.

1. **See it.** `GET /api/v3/free-modems?country_id=<id>` - every row has `ipv6_count`: how many
   units in that row have IPv6 measured working. Pick a row where `ipv6_count` covers your `modemCount`.
2. **Buy it.** Add `"require": ["ipv6"]` to any buy call (`/payment/buy-with-account-credit`,
   `/payment/buy-modems-with-crypto-balance`, `/payment/buy-with-card/{card_id}`). You get a line with
   IPv6, or `409 ipv6_unavailable` before anything is charged.
3. **Keep it.** A line bought this way is only ever replaced by another IPv6 line. If none is free,
   replace answers `409 ipv6_replacement_unavailable` and your current line stays as it is.

Request:

```http
POST /api/v3/payment/buy-with-account-credit
Authorization: Bearer <API key>
Content-Type: application/json

{ "tariff_id": "651941cd5df31c2dd51f9e14", "modemCount": 1,
  "region_id": "68e1362859ceffb93de500e5", "require": ["ipv6"] }
```

`200`: the normal purchase answer (`result: "ok"`, `data[]` with the line). The `200` is the
confirmation; there is no separate IPv6 field.

`409` when no IPv6 unit is free:

```json
{ "error": "No IPv6-capable proxies are available for this selection right now. Nothing was charged.",
  "code": "ipv6_unavailable", "retryable": false }
```

**Also available:**
- `"require": ["p0f", "ipv6"]` needs both on the same unit; its count is `p0f_ipv6_count`.
- `{"allow_without_ipv6": true}` on replace accepts a line without IPv6. Ask the buyer first.

**Good to know:**
- A rotation or restart gives the line a new address. Whether it has IPv6 again is up to the carrier.
- The Stripe Link (MPP) checkout does not take `require: ["ipv6"]` yet (409); use account credit, crypto balance or card.

**Older names, kept for compatibility:** `native_ipv6`, `features.ipv6`, `ip_stack.ipv6` and
`features.ipv6.all` on unit rows say the same thing as `ipv6_count`. New code only needs `ipv6_count`.
`features.native_ipv6` on an owned line is the last address seen, not the purchase check.
Without `require`, a buy works exactly as before.
