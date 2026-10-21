# OS fingerprint (p0f) and OpenVPN

Two per-line features that not every unit has. The API tells you which units have
them before you buy, lets you require one at checkout, and tells you exactly why a
download is refused. Live since 21 Oct 2026. Full reference:
<https://api.coronium.io/api-docs/>.

## 1. Find stock with p0f

Both reads are public and read-only. Neither is a reservation.

Per region, from `/free-modems`:

```bash
curl 'https://api.coronium.io/api/v3/free-modems?country_id=*'
```

```json
{ "data": [
  { "country_id": "64c658f3...", "carrier_id": "66680f4d...", "region_id": "65609445...",
    "count": 3, "p0f_count": 3 },
  { "country_id": "651941cd...", "carrier_id": "6519b209...", "region_id": "68f0ae3...",
    "count": 5, "p0f_count": 0 }
] }
```

`p0f_count` is how many of `count` a buy with `require: ["p0f"]` and that `region_id`
can get. It is counted with the same test the checkout uses, so a region showing
`p0f_count > 0` is one the checkout can fill.

Per plan, from `/tariffs/available`:

```json
"features": {
  "p0f":     { "count": 11, "all": false },
  "openvpn": { "count": 34, "all": true },
  "ipv6_native": false
}
```

`count` is the number of units in the plan's stock with the feature; `all` is true
only when every unit has it. Do not sum plan stock across day, week and month: the
terms share devices.

p0f counts only units whose OS change has been seen on the wire. A unit can leave the
count when it stops passing that check, and some carriers never pass p0f at all, so
read the count each time instead of caching a "this country has p0f" flag.

## 2. Buy with p0f

Add `require: ["p0f"]` to the body. It works on all three v3 buy routes:
`/payment/buy-with-account-credit`, `/payment/buy-modems-with-crypto-balance` and
`/payment/buy-with-card/{card_id}`. The older spelling `wantP0f: true` still works.
Pin the region with `region_id` when you picked it from a `/free-modems` row.

```bash
curl -X POST https://api.coronium.io/api/v3/payment/buy-with-account-credit \
  -H "Authorization: Bearer $CORONIUM_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"tariff_id":"<tariff with features.p0f.count > 0>","modemCount":1,
       "region_id":"<region with p0f_count > 0>","require":["p0f"],
       "metadata":"{\"customer_id\":\"acme-007\"}"}'
```

```js
// examples/nextjs-dashboard/lib/coronium.ts
await coronium.payment.buy(
  { tariff_id, modemCount: 1, region_id, require: ['p0f'], metadata: { customer_id } },
  'account_credit', idempotencyKey);
```

Refusals come before any charge or reservation:

```json
HTTP 409
{ "error": "No p0f-capable proxies are available for this plan right now. Nothing was charged.",
  "code": "p0f_unavailable", "reason_code": "P0F_UNAVAILABLE",
  "suggested_action": "pick_region_with_p0f_count_or_retry_later",
  "retryable": false, "request_id": "req_..." }
```

```json
HTTP 400
{ "error": "Unknown purchase requirement. \"require\" must be a list of: p0f. Nothing was charged.",
  "code": "unknown_requirement", "reason_code": "UNKNOWN_REQUIREMENT",
  "supported": ["p0f"], "suggested_action": "use_supported_requirements",
  "retryable": false, "request_id": "req_..." }
```

- `p0f_unavailable`: choose a region or plan whose count is above zero, or try later.
  Do not loop: the same request gets the same answer until stock changes.
- `unknown_requirement`: `require` must be a list holding only `"p0f"`. Any other
  value, or a non-list, is refused so a typo never buys a unit without the feature.

After purchase, set the OS with `PUT /modems/{id}/set-os` and read the options with
`GET /modems/{id}/p0f-options`. Each line's `features.p0f.supported_values` lists
what it accepts.

## 3. Download OpenVPN

Check the line first: `features.openvpn.available` on `GET /account/proxies`. When it
is `false`, the download refuses.

```bash
curl -fsS -H "Authorization: Bearer $CORONIUM_API_KEY" \
  https://api.coronium.io/api/v3/modems/<modem_id>/openvpn -o line.ovpn
```

Answers:

- `200` - the `.ovpn` file.
- `503 openvpn_profile_pending`, with a `Retry-After` header (120 s) - a line set up
  in the last 2 hours whose profile is still being issued. Wait for `Retry-After` and
  retry the **same** line. It is usually ready within minutes. **Never replace the
  line for this**: a new line starts a new wait.
- `409 openvpn_not_supported` - this line has no OpenVPN (`features.openvpn.available`
  is false). Do not retry.
- `400 openvpn_disabled` - OpenVPN is switched off for this line. Do not retry;
  contact support if you need it.
- `502 openvpn_unavailable` - the profile could not be fetched. Retry once later,
  then contact support with the `request_id`.

```js
// examples/nextjs-dashboard/lib/coronium.ts: retries pending, stops on the rest
const profile = await coronium.proxies.openvpn(modemId);
```

## 4. Error envelope

Every `/api/v3` error carries `error`, `code`, `suggested_action`, `retryable` and
`request_id` (also the `X-Request-Id` header), plus `reason_code` when the original
code was renamed. Branch on `code`; quote `request_id` to support.
