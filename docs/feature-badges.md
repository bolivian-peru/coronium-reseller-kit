# Feature badges: IPv6, OS fingerprint (p0f) and OpenVPN

How to show "IPv6", "OS fingerprint" and "OpenVPN" badges in your own storefront and
customer panel, from fields the API already returns. Checked against the live API on
13 Nov 2026 (OpenAPI 3.3.12): the fields below are unchanged. Full reference: <https://api.coronium.io/api-docs/>.

There are two places a badge can appear, and they read different fields:

| Where | Endpoint | Auth | What a badge means |
|---|---|---|---|
| Plan cards (before buying) | `GET /api/v3/tariffs/available` | none (public) | How many lines in stock for this plan have the feature right now |
| Region picker (before buying) | `GET /api/v3/free-modems` | none (public) | p0f only: how many lines in this region a p0f buy can get |
| Customer's own lines (after buying) | `GET /api/v3/account/proxies` | Bearer API key | Whether this exact line has the feature |

## 1. Plan cards: `GET /api/v3/tariffs/available`

One row per plan (country, carrier, term). A plan can hold mixed stock: some lines with
p0f or IPv6 and some without. Live example of such a row on 13 Nov 2026 (stock and counts
change all the time; read them, never hard-code them):

```json
{
  "_id": "673c2aee724c63eb0714da77",
  "period": "month",
  "price": 149,
  "country_code": "US",
  "stock": 35,
  "ip_stack": { "ipv4": 18, "ipv6": 17, "native_ipv6": false },
  "features": {
    "p0f":     { "count": 17, "all": false },
    "openvpn": { "count": 35, "all": true },
    "ipv6_native": false
  }
}
```

For this row the badges are "IPv6 on 17 of 35", "OS fingerprint on 17 of 35" and "OpenVPN".
A buy with `require: ["p0f"]` gets one of the 17 p0f lines; a buy without it can get either
kind, and IPv6 cannot be selected.

| Badge | Field | Show when | Suggested label |
|---|---|---|---|
| IPv6 | `ip_stack.ipv6` (lines whose exit IP is native global IPv6), `ip_stack.native_ipv6` (true = every line) | `ip_stack.ipv6 > 0` | `native_ipv6: true` -> "IPv6"; otherwise "IPv6 on {ipv6} of {stock}" |
| OS fingerprint (p0f) | `features.p0f.count`, `features.p0f.all` | `count > 0` | `all: true` -> "OS fingerprint"; otherwise "OS fingerprint on {count} of {stock}" |
| OpenVPN | `features.openvpn.count`, `features.openvpn.all` | `count > 0` | `all: true` -> "OpenVPN"; otherwise "OpenVPN on {count} of {stock}" |

`features.ipv6_native` is the same flag as `ip_stack.native_ipv6`; read either.

What a buy can guarantee:

- **p0f** is the only feature a buy can require. Send `"require": ["p0f"]` and the
  checkout gives a p0f line or refuses before charging (409 `p0f_unavailable`). See
  [p0f-and-openvpn.md](p0f-and-openvpn.md). So a "with OS fingerprint" option on your
  checkout must add `require: ["p0f"]`.
- **IPv6 and OpenVPN cannot be required.** When `all` / `native_ipv6` is false, a buy may
  get a line without them. Only show a plain "IPv6" or "OpenVPN" badge when every line
  has it (`native_ipv6: true`, `openvpn.all: true`); otherwise say how many ("on 3 of 16")
  so the customer is not promised something the checkout cannot select.

## 2. Region picker: `GET /api/v3/free-modems`

```json
{ "country_id": "60436110...", "carrier_id": "61eff55b...", "region_id": "62251620...",
  "count": 4, "p0f_count": 0 }
```

Show an "OS fingerprint" badge on a region when `p0f_count > 0`, and send that `region_id`
with `require: ["p0f"]`. This endpoint has no IPv6 or OpenVPN counts; use the plan row for
those.

## 3. The customer's own lines: `GET /api/v3/account/proxies`

Each line carries:

```json
"features": {
  "p0f": { "server_supported": true, "current_os": "", "supported_values": ["..."],
           "vocabulary": "os_profile", "unavailable_reason": null },
  "openvpn": { "available": true, "download_url": "https://..." },
  "native_ipv6": false
}
```

| Badge | Field | Show when |
|---|---|---|
| IPv6 | `features.native_ipv6` | `true` (the line's exit IP is a global IPv6 address) |
| OS fingerprint | `features.p0f.server_supported` | `true`; show `current_os` as the active value, empty = off |
| OpenVPN | `features.openvpn.available` | `true`; link the download to your own backend, which calls `GET /api/v3/modems/{modem_id}/openvpn` |

Never send the customer to `download_url` directly with your API key; fetch the profile
server-side. The OpenVPN answers to handle (503 `openvpn_profile_pending` with
`Retry-After`, 409 `openvpn_not_supported`) are in [p0f-and-openvpn.md](p0f-and-openvpn.md).

## Rules that keep badges honest

- Counts are a snapshot, not a reservation. Refresh them when the page loads and cache for
  at most about a minute.
- Do not add stock or counts across day, week and month plans: the terms share devices.
- Read the counts every time instead of keeping a "this country has p0f" flag. A line can
  leave the p0f count when it stops passing the check, and some carriers never pass it.
- A replacement keeps p0f (or refuses with 409 `p0f_replacement_unavailable`), so a line's
  OS fingerprint badge stays true after `modem.replaced`; re-read the line to refresh
  IPv6 and OpenVPN.
- Never show our carrier or supplier names beyond what the plan row gives you.

## Minimal code

```ts
type Plan = {
  stock: number;
  ip_stack?: { ipv4: number; ipv6: number; native_ipv6: boolean };
  features?: { p0f: { count: number; all: boolean }; openvpn: { count: number; all: boolean }; ipv6_native: boolean };
};

export function planBadges(p: Plan): string[] {
  const out: string[] = [];
  const of = (n: number) => `on ${n} of ${p.stock}`;
  const v6 = p.ip_stack?.ipv6 ?? 0;
  if (v6 > 0) out.push(p.ip_stack?.native_ipv6 ? 'IPv6' : `IPv6 ${of(v6)}`);
  const f = p.features;
  if (f && f.p0f.count > 0) out.push(f.p0f.all ? 'OS fingerprint' : `OS fingerprint ${of(f.p0f.count)}`);
  if (f && f.openvpn.count > 0) out.push(f.openvpn.all ? 'OpenVPN' : `OpenVPN ${of(f.openvpn.count)}`);
  return out;
}

type Line = { features?: { p0f?: { server_supported: boolean; current_os: string };
  openvpn?: { available: boolean }; native_ipv6?: boolean } };

export function lineBadges(l: Line): string[] {
  const out: string[] = [];
  if (l.features?.native_ipv6) out.push('IPv6');
  if (l.features?.p0f?.server_supported) out.push(l.features.p0f.current_os ? `OS: ${l.features.p0f.current_os}` : 'OS fingerprint');
  if (l.features?.openvpn?.available) out.push('OpenVPN');
  return out;
}
```
