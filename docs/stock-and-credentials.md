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

The [interactive API reference](https://dashboard.coronium.io/api-docs/) includes
the header on stock and purchase operations. Run `examples/verify-integration.mjs`
for a read-only check; it already sends the header. A successful stock read is not
a reservation or proof of a paid purchase. Use an idempotency key per purchase
intent and reconcile the payment response before retrying.
