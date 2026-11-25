# Seeing all eligible inventory

No header is needed to see stock. Without any header you are offered, and sold, units that are verified to accept **one login on both ports** (HTTP and SOCKS5), so the ordinary `proxy_login` / `proxy_password` fields are complete. The header `X-Coronium-Proxy-Credentials: separate-protocol-v1` is optional: send it on stock, tariff and purchase calls to **also** be offered units whose HTTP and SOCKS5 have different hosts or logins, and then read `proxyEndpoints.http` and `proxyEndpoints.socks5` independently (the legacy fields describe HTTP only). Neither mode bypasses supplier consent, health checks or rental-term coverage, and an order with `autoRenew: true` is only filled from units that support it.

This is not a separate account balance, permission tier or extra authentication.
To be offered every eligible unit, set this on your server-side API client for
**both stock and purchase** requests:

```http
X-Coronium-Proxy-Credentials: separate-protocol-v1
```

```bash
curl 'https://api.coronium.io/api/v3/free-modems?country_id=*&period=month' \
  -H 'X-Coronium-Proxy-Credentials: separate-protocol-v1'
curl 'https://api.coronium.io/api/v3/tariffs/available' \
  -H 'X-Coronium-Proxy-Credentials: separate-protocol-v1'
```

Use the exact tariff period (`day`, `week`, `month`). The header adds the
separate-login units to the inventory you are offered; it does not bypass
supplier consent, health/readiness, sold-device protection or term coverage. Existing
owned proxies remain visible with or without the header.

Whenever a delivered proxy carries `proxyEndpoints`, read `proxyEndpoints.http`
and `proxyEndpoints.socks5` independently. Each has `host`, `port`, `username`,
`password`. The old `proxy_login` and `proxy_password` describe HTTP only.
Do not combine those credentials with a SOCKS5 port.

`proxyEndpoints.provider` is an opaque label. New values appear as inventory
sources are added, so never branch on it and never show it to your customers.
Branch on `proxyEndpoints.capabilities` instead (`rotate`, `replace`,
`autoRenew`, `rotationInterval`, `whitelist`, `customCredentials`, `openvpn`,
`p0f`; more can be added). A flag that is absent or `false` means the action is
not offered for that proxy: hide the control rather than letting the call fail.
Proxies without a `proxyEndpoints` object are legacy rows and use the flat
fields.

## Line types at a glance

| | Classic proxy | Row with `proxyEndpoints` (one-time rental) |
|---|---|---|
| Recognise it | No `proxyEndpoints` | `proxyEndpoints` present |
| Rotation | `POST /restart` answers 200 with `rotated`; `429` within 60 s of the last rotation | `POST /restart` answers **202** `pending: true`; poll `GET /modems/{id}/rotation-status` until `done` or `failed`; a refusal changes nothing: `409` (`modem_rotation_in_progress`, `rotate_unavailable`, `modem_expired`), `429 rotation_too_soon` (wait `Retry-After`) or `502 rotation_unconfirmed` (poll, do not resend); `rotate_unavailable` + `check_proxy_health` = offline. Node specifics in [Coronium Node rows](#coronium-node-rows) |
| Renewal | Explicit renewal; auto-renew where offered | Quote and renew explicitly. Owned Node lines with `capabilities.autoRenew` also offer balance renewal |
| Replace | Available | `409`; read `capabilities` |
| OS fingerprint | Where `features.p0f.server_supported` is true | Only when `proxyEndpoints.capabilities.p0f` is true; otherwise `400 p0f_unsupported_on_server`. `set-os` can answer `202` `pending: true` until the line confirms |

A recurring checkout can return `409 auto_renew_unavailable` before charging.
With `suggested_action: retry_without_auto_renew`, offer a one-time purchase and
remove the recurring intent only with the buyer’s approval. With `choose_one_time_plan`,
the plan itself recurs and the buyer needs a different plan. A `503 availability_unchecked`
means availability could not be verified and nothing was charged.

## Coronium Node rows

Coronium Node lines are one-time rentals served from a single device through our gateway.
They are the one documented `provider` value: the row carries a top-level
`provider: "coronium_node"` and the same value in `proxyEndpoints.provider`. Still decide
what to show from `capabilities`, not from the label.

- For an owned Node line advertising `proxyEndpoints.capabilities.autoRenew`, read `GET /modems/{id}/auto-renewal?days=30` and show the offer. With explicit approval send `PUT /modems/{id}/auto-renewal` with `{mode:"balance", autoRenewConsent:true, days:offer.days, expected_price_usd:offer.price_usd}`. Disable with `{mode:"off"}`. A one-time checkout does not enrol the line. A missing offer gives no price to approve. If the price changes, show the new price and ask again. A 404 on this route means it is unavailable for this line.
- Show any `warnings[].message` from the renewal quote before the customer confirms. `NODE_LINE_NOT_SERVING` means the line has been observed down for at least 24 hours. The customer can still renew.
- Use seconds for `rotation_interval`. Zero disables a timer. For a Node line, use the bounds returned in `proxyEndpoints.rotationSchedule` (120 to 86400 in steps of 60) when `capabilities.rotationInterval` is true. A stored schedule can still be turned off. Other timed rows with `proxyEndpoints` accept 60 to 2592000 in steps of 60. Classic rows accept 60 or more.
- One login and password on both ports (`credentials: "shared-protocol-v1"`). `proxy_login`
  is fixed (`cnr_<modem id>`); `PUT /modems/{id}/change-password` takes 8-128 printable
  ASCII characters without spaces.
- `providerState` (`tunnel_connected`, `offline`, `unknown`) and `providerObservedAt`
  (epoch ms) report the device connection. `ext_ip` can be `null` until the device reports.
  When present, `lineHealth` reports `state` (connected, online, offline or no_data),
  a display `label` and the observation time in `checkedAt`.
- Rotation answers 202. Send a UUIDv4 `request_id` in the body to make a retry safe; at
  most one request every two minutes. A refused rotate answers `409` and nothing is queued.
  The body carries `error` (a readable reason), `code` and `suggested_action`.
  - `modem_rotation_in_progress` / `poll_rotation_status`: a rotation is still running, poll
    `GET /modems/{id}/rotation-status` and do not resend.
  - `rotate_unavailable` / `retry_after_2_minutes`: the last request was under 2 minutes ago,
    wait and retry once.
  - `rotate_unavailable` / `check_capabilities`: the proxy is offline or rotation is not
    available right now.
  - `rental_conflict` / `refresh_inventory`: the rental is no longer on this account; reload
    the proxy list.
  - `503` with `error` "Rotation unavailable" (`code` `modem_rotation_in_progress`): rotation
    is unavailable right now. Do not poll `rotation-status`; show it and try later.
  - On a Node row, `proxyEndpoints.rotationState` can be `busy`, `needs_review` or null. A `409 rotate_unavailable` with `suggested_action: retry_later` means the previous IP change is still being confirmed. Refresh status after a minute and keep new rotation requests paused until the hold clears. The status response can say `state: "failed"` and `reset_error: "the IP change is still being confirmed"`. Refresh status again if confirmation is still pending. Contact support with the request ID if it persists.
- The token URL (`GET /modems/rotate-modem-by-token/{token}`) answers `202` with
  `pending: true` and a `status_url` on these rows. Follow `status_url` as returned and do
  not resend. Its refusals are `409`. Their `code` usually reads `modem_rotation_in_progress`
  with `suggested_action` `poll_rotation_status` whatever the reason, and an ended or
  foreign rental can come back as `internal_error`. Ignore both there and read `error`:
  busy, too soon, previous change still being confirmed (check status later), or an active rental required (reload the proxy list). `503` carries the same
  code; treat it as rotation unavailable now.
  Its `status_url` may be on a neutral short-link host (for example
  `https://ipreset.xyz/s/<token>`), outside `/api/v3`. Follow it as returned: it answers
  the same `data` shape, but its errors carry only `error` (no `code`, `suggested_action`
  or `request_id`), so branch on the HTTP status there. To get envelope codes, poll
  `GET https://api.coronium.io/api/v3/modems/get-rotating-modem-status-by-token/{token}`
  with the same token instead. Both answer
  `{data: {status, ext_ip, rotated_at, command, providerState, rotation}}`, not the `state`
  of `rotation-status`. Poll `data.rotation` until `pending` is false: `success: true` is
  done, `needs_review: true` means the IP change is still being confirmed (refresh status later), any other `result`
  is failed.
- `capabilities.http`, `socks5` and `udp` say which protocols passed qualification of this
  exact device. `usage` and `speedTest` enable `GET /modems/{id}/usage` and
  `/modems/{id}/speed-test`. On a line of any other type these routes answer `404 not_found`.
- Offer IP whitelisting only when the owned row advertises `proxyEndpoints.capabilities.whitelist: true` or `features.whitelist.available: true`. When both are absent or false, hide the control and use the line’s login and password. An eligible write replaces the whole list and accepts up to 10 addresses or permitted CIDR entries.
  - Usage returns totals and UTC-day rows for the current rental. `days` runs from 1 to 366 (default 30). Show usage only with `capabilities.usage`. Display the optional `dataAllowanceNote.text` when provided. The declared `gbPerMonth` is informational and does not measure remaining data.
  - Speed test: `POST` (optional UUIDv4 `request_id`) answers `202`; poll `GET` for
    `down_mbps`, `up_mbps`, `latency_ms`. One test per 10 minutes per proxy (`429` with
    `Retry-After`).
- Refused with `409 action_unsupported` and nothing changed: `replace`, `apply-settings`, `test`. `cancel` answers `409 cancel_unsupported`.
- OpenVPN (only when `capabilities.openvpn` is true) downloads once per profile; see
  [p0f and OpenVPN](p0f-and-openvpn.md#5-download-openvpn).
- An expired rental stays on your account for 24 hours so you can renew it with the same
  credentials, but it stops accepting connections at expiry.

Full contract: the line-type section of the [API reference](https://api.coronium.io/api-docs/).

Sending the header on every stock and purchase call is recommended if your client
reads `proxyEndpoints`. It only widens what you are offered.

If stock differs between your integration and the dashboard:

1. Check that your HTTP client and outbound gateway preserve the header on both
   `/free-modems` and `/tariffs/available`, then on the purchase request.
2. Check the effective contract returned in `X-Coronium-Proxy-Credentials` and
   the supported contracts in `X-Coronium-Proxy-Credentials-Supported`.
3. Keep cache entries separate for each header value; honor `Vary`. Tariff results
   have a short server cache and stock can change between requests.
4. Match `country_id`, `carrier_id`, region and rental term. Never use a null
   carrier ID as a wildcard for a named-carrier product. Malformed carrier plans
   are excluded from `/tariffs/available`; historical `/tariffs` is not a stock list.
5. Sum the grouped `/free-modems` counts for inventory totals, not tariff stock:
   day/week/month plans can all reference the same devices.
6. For p0f, read each row's `p0f_count` (and `features.p0f.count` per plan). It is
   what a buy with `require: ["p0f"]` and that `region_id` can get. See
   [p0f and OpenVPN](p0f-and-openvpn.md).
7. For OpenVPN, IPv6 and one-time units, read the same row's `openvpn_count`,
   `ipv6_count` and `one_time_only_count` (OpenAPI 3.3.16). See
   [Guaranteeing features per region](#guaranteeing-features-per-region) and
   [IPv6 lines](ipv6-lines.md).

The [interactive API reference](https://api.coronium.io/api-docs/) includes
the header on stock and purchase operations. Run `examples/verify-integration.mjs`
for a read-only check; it already sends the header. A successful stock read is not
a reservation or proof of a paid purchase. Use an idempotency key per purchase
intent and reconcile the payment response before retrying.

## Guaranteeing features per region

`GET /api/v3/free-modems` returns one row per country, carrier and region. Since OpenAPI 3.3.16 each row has, next to `count` and `p0f_count`:

| Field | Meaning |
|---|---|
| `count` | Units you can buy in this row right now. |
| `p0f_count` | Units with OS fingerprint (p0f) control. |
| `openvpn_count` | Units that can serve OpenVPN. |
| `ipv6_count` | Units with IPv6 measured working: what `require: ["ipv6"]` can buy ([IPv6 lines](ipv6-lines.md)). |
| `one_time_only_count` | One-time rentals: never sold with auto-renew or a monthly subscription. Renew them by modem ID. |
| `dataAllowanceNote` | Only on rows where some unit declares a monthly data allowance: `{gbPerMonth, text, count, all}`. `count` = units in the row that carry the note, `all` = every unit carries it. It is a note, not a limit. |

All counts are integers and always present (0 when none). They come from the same stock list as `count`, so `count` is always at least each of them. On `/tariffs/available` the same facts are per plan across all regions of the carrier: for a one-time plan of the same `period`, the sum of a carrier's `openvpn_count` is `features.openvpn.count`.

What you can guarantee to your customer:

| Feature | How to guarantee it |
|---|---|
| p0f | Buy with `require: ["p0f"]` (or `wantP0f: true`) and the row's `region_id`. This works on mixed rows. You get only p0f units, or a 409 and nothing is charged. |
| OpenVPN | Only buy with a `region_id` whose row has `openvpn_count == count`. No buy flag selects OpenVPN units. |
| IPv6 | Buy with `require: ["ipv6"]`. See [IPv6 lines](ipv6-lines.md). |
| Monthly or auto-renew | An order with `autoRenew: true` never gets a one-time unit. It can get at most `count - one_time_only_count` units from a row. When that is 0, it gets a 409 `auto_renew_unavailable` before any charge (subject to stock at order time). |
| No one-time units | Order from a `region_id` whose row has `one_time_only_count == 0`. There is no safe buy flag for this. `autoRenew: true` also excludes them, but it enrols the line in auto-renewal, so do not use it only as a filter. |
| Anything else | Not guaranteeable from stock (for example a specific IP, speed or ASN). |

One-time units can still be renewed. Renew them by modem ID with `/payment/renew-modems-with-crypto-balance`, `/payment/renew-with-account-credit` or `/payment/renew-with-card/{card_id}`, for 1 to 90 days, while the line is on your account. Three conditions apply:
- The device does not need to be online to renew. If the line has had no working connection for more than 24 hours, the renewal quote can carry a `NODE_LINE_NOT_SERVING` warning.
- A line that has expired and is being reconciled answers 409 `node_renewal_reconciling`. Refresh its status and try again.
- A replaced line is renewed through its replacement.

Stock moves. Read `/free-modems` again right before checkout. The counts are not a reservation, and a unit can be sold between your read and your order.

There is no per-unit stock list on the reseller API. The dashboard's per-unit feed (`/api/v1/modems/count/*`) is not part of the reseller API. Use `GET /api/v3/free-modems`.

`region_id` is honoured by every buy route: card (`/payment/buy-with-card/{card_id}`), crypto balance (`/payment/buy-modems-with-crypto-balance`) and account credit (`/payment/buy-with-account-credit`), on `/api/v3` and on the client routes. A buy only gets units from that region.
