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
| Renewal | Explicit renewal; auto-renew where offered | Manual renewal only: `POST /payment/renewal-quote`, then a `/payment/renew-*` route |
| Replace | Available | `409`; read `capabilities` |
| OS fingerprint | Where `features.p0f.server_supported` is true | Only when `proxyEndpoints.capabilities.p0f` is true; otherwise `400 p0f_unsupported_on_server`. `set-os` can answer `202` `pending: true` until the line confirms |

`"autoRenew": true` on a buy is never filled from one-time-rental stock. If only such
units are left the answer is `409 auto_renew_unavailable` (`retry_without_auto_renew`),
before any charge.

## Coronium Node rows

Coronium Node lines are one-time rentals served from a single device through our gateway.
They are the one documented `provider` value: the row carries a top-level
`provider: "coronium_node"` and the same value in `proxyEndpoints.provider`. Still decide
what to show from `capabilities`, not from the label.

- One login and password on both ports (`credentials: "shared-protocol-v1"`). `proxy_login`
  is fixed (`cnr_<modem id>`); `PUT /modems/{id}/change-password` takes 8-128 printable
  ASCII characters without spaces.
- `providerState` (`tunnel_connected`, `offline`, `unknown`) and `providerObservedAt`
  (epoch ms) report the device connection. `ext_ip` can be `null` until the device reports.
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
  - When `error` says the last rotation has no confirmed outcome and is under review, every
    rotate on that line is refused until support resolves it. The code can be either
    `rotate_unavailable` variant, so match on that text. Do not retry it in a loop and do not
    replace. Show the message and contact support with the `request_id`.
- If the device never confirms a rotation, `rotation-status` reports `state: "failed"` with
  `reset_error: "device did not confirm the outcome"`. That is the "under review" case
  above: ignore the status hint's "retry after 2 minutes" and show the line as "rotation
  under review".
- The token URL (`GET /modems/rotate-modem-by-token/{token}`) answers `202` with
  `pending: true` and a `status_url` on these rows. Follow `status_url` as returned and do
  not resend. Its refusals are `409`. Their `code` usually reads `modem_rotation_in_progress`
  with `suggested_action` `poll_rotation_status` whatever the reason, and an ended or
  foreign rental can come back as `internal_error`. Ignore both there and read `error`:
  busy, too soon, "has no confirmed outcome and is under review" (stop and contact
  support), or an active rental required (reload the proxy list). `503` carries the same
  code; treat it as rotation unavailable now.
  Its `status_url` may be on a neutral short-link host (for example
  `https://ipreset.xyz/s/<token>`), outside `/api/v3`. Follow it as returned: it answers
  the same `data` shape, but its errors carry only `error` (no `code`, `suggested_action`
  or `request_id`), so branch on the HTTP status there. To get envelope codes, poll
  `GET https://api.coronium.io/api/v3/modems/get-rotating-modem-status-by-token/{token}`
  with the same token instead. Both answer
  `{data: {status, ext_ip, rotated_at, command, providerState, rotation}}`, not the `state`
  of `rotation-status`. Poll `data.rotation` until `pending` is false: `success: true` is
  done, `needs_review: true` is under review (stop and contact support), any other `result`
  is failed.
- `capabilities.http`, `socks5` and `udp` say which protocols passed qualification of this
  exact device. `whitelist`, `usage` and `speedTest` enable `PUT /modems/{id}/set-white-list`,
  `GET /modems/{id}/usage` and `/modems/{id}/speed-test`. On a line of any other type these
  routes answer `404 not_found`.
  - Whitelist: `{"white_list": [...]}` replaces the list, at most 10 entries, IPv4 `/24`-`/32`
    or IPv6 `/48`-`/128`. Listed addresses connect without a password on `dedicated_port`
    (returned in the answer); `[]` removes password-less access.
  - Usage: `?days=1-366` (default 30) returns `totals` and per-UTC-day rows of the current
    rental only. `capabilities.usage` is false on every line today. A plan whose name ends
    in ` - 20 GB/month only` includes 20 GB of mobile data per month; show usage only when
    `capabilities.usage` is true.
  - Speed test: `POST` (optional UUIDv4 `request_id`) answers `202`; poll `GET` for
    `down_mbps`, `up_mbps`, `latency_ms`. One test per 10 minutes per proxy (`429` with
    `Retry-After`).
- Refused with `409 action_unsupported` and nothing changed: `set-rotation-interval`,
  `replace`, `apply-settings`, `test`. `cancel` answers `409 cancel_unsupported`.
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

The [interactive API reference](https://api.coronium.io/api-docs/) includes
the header on stock and purchase operations. Run `examples/verify-integration.mjs`
for a read-only check; it already sends the header. A successful stock read is not
a reservation or proof of a paid purchase. Use an idempotency key per purchase
intent and reconcile the payment response before retrying.
