# Picking IPv6 lines

How to sell a line with native IPv6 and keep that promise: read the IPv6 count, buy with
`require: ["ipv6"]`, and handle the two refusals. Since OpenAPI 3.3.18.

All three v3 buy routes take the requirement: `/payment/buy-with-account-credit`,
`/payment/buy-modems-with-crypto-balance` and `/payment/buy-with-card/{card_id}`. The
client buy routes outside `/api/v3` take the same `require` list.

## What native IPv6 means

Native IPv6 means the line reaches IPv6-only sites over its own mobile IPv6 address. What we guarantee: every line sold with `require: ["ipv6"]` passed that check through its own proxy port within the last 2 hours, and is checked again just before it is handed over when that check is more than 10 minutes old. What we cannot guarantee: the mobile carrier assigns the IPv6 address per session, so a rotation, restart or reconnect gives the line a new address, and whether it gets IPv6 again is the carrier's decision, not ours; we do not re-check sold lines on a schedule. Sites that offer both IPv4 and IPv6 may still be reached over IPv4. We have not verified OS fingerprint (p0f) control on IPv6 connections. Replacement honours the requirement: `/replace` on a line bought with `require: ["ipv6"]` gives a line with a fresh IPv6 check, or answers `409 ipv6_replacement_unavailable` and changes nothing.

A paid order whose free lines all fail that final check waits as a delayed order until a
line passes it; it is never filled with a line without IPv6.

Tell your own customers the same. Do not promise IPv6 after a rotation, and do not promise
that a dual-stack site sees IPv6.

## Step 1: read the IPv6 count

```bash
curl "https://api.coronium.io/api/v3/free-modems?country_id=<country _id>&carrier_id=<carrier _id>"
```

```json
{ "data": [
  { "country_id": "<country _id>", "carrier_id": "<carrier _id>", "region_id": "<region _id>",
    "count": 12, "p0f_count": 4, "p0f_ipv6_count": 2, "openvpn_count": 12,
    "ipv6_count": 5, "one_time_only_count": 0 } ] }
```

| Field | What a buy can get from this row |
|---|---|
| `ipv6_count` | Lines whose native IPv6 was checked through their own proxy port in the last 2 hours: what `require: ["ipv6"]` can buy. |
| `p0f_ipv6_count` | Lines with both p0f and that IPv6 check: what `require: ["p0f", "ipv6"]` can buy. |

Both are integers, always present (0 when none) and never more than `count`. Until 25 Nov
2026 `ipv6_count` counted the last address seen on the line, which overstated; it now
counts only checked lines.

Per plan, `GET /api/v3/tariffs/available` carries the same number as `ip_stack.ipv6` and
`features.ipv6.count` (`features.ipv6.all` is true when every line of the plan has it).
For the number per region use `/free-modems`.

Pick a `region_id` whose `ipv6_count` (`p0f_ipv6_count` when you also need p0f) is at
least your `modemCount`. Counts are not a reservation: read them again right before
checkout.

## Step 2: buy with `require`

```http
POST /api/v3/payment/buy-with-account-credit
Authorization: Bearer <API key>
Content-Type: application/json
Idempotency-Key: acme-order-0008

{
  "tariff_id": "651941cd5df31c2dd51f9e14",
  "modemCount": 1,
  "region_id": "68e1362859ceffb93de500e5",
  "require": ["ipv6"],
  "max_total_usd": 99,
  "metadata": { "customer_id": "acme-007" }
}
```

For both features on the same line send `"require": ["p0f", "ipv6"]`. The mixed rows are
fine: the requirement picks only checked lines from them.

`200` (account credit; example values):

```json
{
  "result": "ok",
  "charged_usd": 99,
  "currency": "USD",
  "paymentId": "6a4e2c1f9b8d7e6f5a4b3c2d",
  "data": [
    {
      "_id": "69e894e86f1f4736e92202d8",
      "name": "cor_US_5c75faff",
      "proxy_login": "example_login",
      "proxy_password": "example_password",
      "http_port": "8040",
      "socks_port": "5040",
      "ip_address": "203.0.113.7",
      "status": "active",
      "rotation_interval": 0,
      "tariff_id": "651941cd5df31c2dd51f9e14",
      "country_id": "64f0a1b2c3d4e5f60718293a",
      "carrier_id": "6515a3fa0a3b97dc8f2202d8",
      "region_id": "68e1362859ceffb93de500e5",
      "tariff_expired_at": 1779404400000
    }
  ],
  "billing": {
    "schema_version": 1,
    "action": "purchase",
    "lane": "account_credit",
    "currency": "USD",
    "line_items": [
      { "kind": "modem", "modem_id": null, "name": null, "tariff_id": "651941cd5df31c2dd51f9e14",
        "country_id": "64f0a1b2c3d4e5f60718293a", "carrier_id": "6515a3fa0a3b97dc8f2202d8",
        "plan": "month", "days": 30, "pricing_basis": "plan_fixed",
        "quantity": 1, "unit_price_usd": 99, "line_total_usd": 99 }
    ],
    "subtotal_usd": 99,
    "discount": null,
    "charged_usd": 99,
    "balance_before_usd": 500,
    "balance_after_usd": 401,
    "settlement": null
  }
}
```

The buy answer has no IPv6 field: a `200` to a request with `require: ["ipv6"]` is the
confirmation. Store the requirement with your order so you know which customer lines were
sold as IPv6. The other success and pending answers (`202` with `paymentId`, the card and
BTC lanes) are the same as for any buy; see
[billing and reconciliation](billing-and-reconciliation.md).

## Step 3: handle `409 ipv6_unavailable`

Too few checked lines for the order. It comes before any charge, reservation or lock.

`require: ["ipv6"]`:

```json
HTTP 409
{
  "error": "No IPv6-capable proxies are available for this selection right now. Nothing was charged.",
  "code": "ipv6_unavailable",
  "suggested_action": "pick_region_with_ipv6_count_or_retry_later",
  "retryable": false,
  "request_id": "req_3kq9v2LmT0s"
}
```

`require: ["p0f", "ipv6"]` (the code is `ipv6_unavailable` here too, not `p0f_unavailable`):

```json
HTTP 409
{
  "error": "No IPv6-capable proxies with p0f are available for this selection right now. Nothing was charged.",
  "code": "ipv6_unavailable",
  "suggested_action": "pick_region_with_ipv6_count_or_retry_later",
  "retryable": false,
  "request_id": "req_3kq9v2LmT0s"
}
```

What to do: re-read `/free-modems`, offer a region whose `ipv6_count` (or
`p0f_ipv6_count`) covers the order, or ask the buyer whether a line without IPv6 is fine.
Do not loop: the same request gets the same answer until the checks change.

Any other `require` value, or a `require` that is not a list of strings, is
`400 unknown_requirement` with `supported: ["p0f", "ipv6"]`, also before any charge.

### Stripe Link (MPP) checkout

The Stripe Link (MPP) checkout accepts `require: ["ipv6"]` but answers `409 ipv6_unavailable`
before any quote or charge: the lines it sells have no IPv6 check. Buy IPv6 lines on the
account-credit, BTC or saved-card route.

## Replacing an IPv6 line

`POST /api/v3/modems/{id}/replace` on a line bought with `require: ["ipv6"]` gives only a
line with a fresh IPv6 check. The answer then carries `"ipv6": {"required": true, "kept": true}`.

With none available nothing changes and no replacement is used:

```json
HTTP 409
{
  "error": "No replacement with IPv6 is available right now. Your current proxy is unchanged. Try again later, or repeat the request with allow_without_ipv6: true to accept a replacement without IPv6.",
  "code": "ipv6_replacement_unavailable",
  "changed": false,
  "suggested_action": "retry_later_or_allow_without_ipv6",
  "retryable": false,
  "request_id": "req_3kq9v2LmT0s"
}
```

Ask the buyer before you send `{"allow_without_ipv6": true}`: the new line then has no
IPv6 promise (`ipv6.kept: false`). An automatic replacement of a dead IPv6 line does the
same and sends `modem.dead` with `no_ipv6_stock`. Replacements of other lines prefer a line
with a fresh IPv6 check when one is free in the same pool; that is a preference, not a
guarantee.

## The "IPv6 native" badge

The Coronium dashboard shows "IPv6 native" only for lines with a fresh IPv6 check, as
"IPv6 native" when every line in the selection has it and "IPv6 native · 2 of 5" when only
some do. Its "I need IPv6" tick sends the same requirement as `require: ["ipv6"]`. Use the
same rule in your storefront: base an IPv6 badge on `ipv6_count` or `ip_stack.ipv6`, and
show a plain badge only when it equals `count` (or `features.ipv6.all` is true). See
[feature badges](feature-badges.md).

`features.native_ipv6` on an owned line in `GET /account/proxies` is a different field: it
says whether the last address recorded for the line is a global IPv6 address. It is not
the purchase check. Use it for a line badge,
not as proof that the line was sold with IPv6.
