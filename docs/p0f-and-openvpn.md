# OS fingerprint (p0f) and OpenVPN

Two per-line features that not every unit has. The API tells you which units have
them before you buy, lets you require one at checkout, and tells you exactly why a
download is refused. Synced with OpenAPI 3.3.5 (24 Oct 2026). Full reference:
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
  "code": "p0f_unavailable",
  "suggested_action": "pick_region_with_p0f_count_or_retry_later",
  "retryable": false, "request_id": "req_..." }
```

```json
HTTP 400
{ "error": "Unknown purchase requirement. \"require\" must be a list of: p0f. Nothing was charged.",
  "code": "unknown_requirement",
  "supported": ["p0f"], "suggested_action": "use_supported_requirements",
  "retryable": false, "request_id": "req_..." }
```

- `p0f_unavailable`: choose a region or plan whose count is above zero, or try later.
  Do not loop: the same request gets the same answer until stock changes.
- `unknown_requirement`: `require` must be a list holding only `"p0f"`. Any other
  value, or a non-list, is refused so a typo never buys a unit without the feature.

## 3. Set the OS on a line

Each line in `GET /account/proxies` carries:

```json
"features": {
  "p0f": {
    "server_supported": true,
    "current_os": "",
    "supported_values": ["ios:2", "windows:1", "..."],
    "vocabulary": "os_profile",
    "unavailable_reason": null
  },
  "openvpn": { "available": true, "download_url": "https://..." },
  "native_ipv6": false
}
```

- `supported_values` is what `set-os` accepts on this line. Values differ between line
  types, so never hard-code a list.
- `vocabulary` names the value list: `os_profile` (such as `ios:2`) or `tcp_stack`
  (such as `Win10`), `null` when the line has no OS control. It replaced
  `features.p0f.provider`, which is gone.
- `unavailable_reason` says why a line has no OS control: `mobile_network` (the line's
  mobile network rewrites the signature, so no OS change can show) or `line` (any other
  reason). `null` when OS control is available.
- `current_os` (and the older top-level `p0f_os`) is the active value; empty means
  pass-through.

Read the options, then set one (`""` turns it off):

```bash
curl -H "Authorization: Bearer $CORONIUM_API_KEY" \
  https://api.coronium.io/api/v3/modems/<modem_id>/p0f-options
# -> {"result":"ok","data":{"modemId":"...","supported":true,"vocabulary":"os_profile",
#      "options":[...],"current":"","next_change_in_seconds":0}}

curl -X PUT https://api.coronium.io/api/v3/modems/<modem_id>/set-os \
  -H "Authorization: Bearer $CORONIUM_API_KEY" -H 'Content-Type: application/json' \
  -d '{"os":"<a value from options>"}'
```

`set-os` refusals. Nothing is changed in any of them:

| Status | `code` | Meaning |
|---|---|---|
| 400 | `p0f_unsupported_on_server` | This line has no OS control. Hide the control |
| 400 | `p0f_os_unsupported_on_this_server` | The value is not in this line's list; the body carries `allowed` |
| 429 | generic | One change per 5 minutes per proxy. Wait `Retry-After` |
| 502 | `p0f_not_applied` | The change could not be applied or the line's state could not be read. Retry in a minute |
| 404 | `p0f_unavailable` | OS changes are not available on this line right now. Contact support |

## 4. Replacing a p0f line

A line bought with `require: ["p0f"]`, or one with an OS set, is replaced only by a p0f
line, and its OS is applied to the new one. This holds for your own
`POST /modems/{id}/replace`, a replacement by support and the automatic swap of a dead line.

```json
HTTP 200
{ "result": "ok", "oldModemId": "...", "newModemId": "...",
  "newModem": { "_id": "...", "host": "...", "http_port": "...", "socks_port": "...",
                "proxy_login": "...", "proxy_password": "...", "tariff_expired_at": 1779404400000 },
  "p0f": { "required": true, "kept": true, "os": "ios:2", "os_applied": true } }
```

While a just-created port is still registering, `p0f` adds `pending: true` and a `note`;
the OS is applied automatically within about 10 minutes.

With no p0f line available:

```json
HTTP 409
{ "error": "No replacement with OS fingerprint (p0f) control is available right now. Your current proxy is unchanged. ...",
  "code": "p0f_replacement_unavailable", "suggested_action": "retry_later_or_allow_without_p0f",
  "changed": false, "retryable": false, "request_id": "req_..." }
```

Nothing changed and no replacement was used. Retry later, or, **only with your buyer's
consent**, resend with a body of `{"allow_without_p0f": true}` to accept a line without
p0f (the answer then says `p0f.kept: false`). An automatic swap in the same situation
sends `modem.dead` with `reason: "no_p0f_stock"` instead of replacing.

```js
// examples/nextjs-dashboard/lib/coronium.ts
await coronium.proxies.replace(modemId);                              // keeps p0f or throws 409
await coronium.proxies.replace(modemId, { allow_without_p0f: true }); // buyer agreed
```

## 5. Download OpenVPN

Check the line first: `features.openvpn.available` on `GET /account/proxies`. When it
is `false`, the download refuses.

```bash
curl -fsS -H "Authorization: Bearer $CORONIUM_API_KEY" \
  https://api.coronium.io/api/v3/modems/<modem_id>/openvpn -o line.ovpn
```

Answers:

- `200` - the `.ovpn` file.
- `503 openvpn_profile_pending` (`retry_with_backoff`, `retryable: true`), with a
  `Retry-After: 120` header - a line set up
  in the last 2 hours whose profile is still being issued. Wait for `Retry-After` and
  retry the **same** line. It is usually ready within minutes. **Never replace the
  line for this**: a new line starts a new wait.
- `409 openvpn_not_supported` (`check_capabilities`, `retryable: false`) - this line has no OpenVPN (`features.openvpn.available`
  is false). Do not retry.
- `400 openvpn_disabled` (`contact_support`, `retryable: false`) - OpenVPN is switched off for this line. Do not retry;
  contact support if you need it.
- `502 openvpn_unavailable` (`contact_support`, `retryable: true`) - the profile could not be fetched. Retry once later,
  then contact support with the `request_id`.

```js
// examples/nextjs-dashboard/lib/coronium.ts: retries pending, stops on the rest
const profile = await coronium.proxies.openvpn(modemId);
```

Coronium Node rows (top-level `provider: "coronium_node"`) differ: the profile
**downloads once**. Store the file. A second download, a lost download or a password change
answers `409 vpn_revoke_required`; call `POST /modems/{id}/openvpn/revoke` (no body), then
download again. `409 vpn_not_ready` means OpenVPN is not available on that rental yet.

## 6. Error envelope

Every `/api/v3` error carries `error`, `code`, `suggested_action`, `retryable` and
`request_id` (also the `X-Request-Id` header). `reason_code` appears only when the
API renamed the original code (for example `no_stock` carries `reason_code:
"OUT_OF_STOCK"`). None of the p0f or OpenVPN codes on this page carry one. Branch on
`code`; quote `request_id` to support.
