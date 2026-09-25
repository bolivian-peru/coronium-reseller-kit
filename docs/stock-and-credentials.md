# Seeing all eligible inventory

The stock API defaults to the legacy shared-credential contract. PocketProxy can
have different HTTP and SOCKS5 hosts and credentials, so clients must explicitly
support the separate-protocol contract before it is offered for a new purchase.
This is not a separate account balance, permission tier or extra authentication.

Set this on your server-side API client for **both stock and purchase** requests:

```http
X-Coronium-Proxy-Credentials: separate-protocol-v1
```

```bash
curl 'https://api.coronium.io/api/v3/free-modems?country_id=*&period=month' \
  -H 'X-Coronium-Proxy-Credentials: separate-protocol-v1'
curl 'https://api.coronium.io/api/v3/tariffs/available' \
  -H 'X-Coronium-Proxy-Credentials: separate-protocol-v1'
```

Use the exact tariff period (`day`, `week`, `month`). The header includes eligible
PocketProxy inventory alongside the other providers; it does not bypass farmer
consent, health/readiness, sold-device protection or term coverage. Existing owned
proxies remain visible without opt-in.

For delivered PocketProxy proxies, read `proxyEndpoints.http` and
`proxyEndpoints.socks5` independently. Each has `host`, `port`, `username`,
`password`. The old `proxy_login` and `proxy_password` describe HTTP only.
Do not combine those credentials with a SOCKS5 port. Check capabilities before
offering automatic renewal, replacement or provider-specific settings.

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

The [interactive API reference](https://dashboard.coronium.io/api-docs/) includes
the header on stock and purchase operations. Run `examples/verify-integration.mjs`
for a read-only check; it already sends the header. A successful stock read is not
a reservation or proof of a paid purchase. Use an idempotency key per purchase
intent and reconcile the payment response before retrying.
