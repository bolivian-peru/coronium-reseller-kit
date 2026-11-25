# Feature badges: IPv6, OS fingerprint (p0f) and OpenVPN

How to show "IPv6", "OS fingerprint" and "OpenVPN" badges in your own storefront and
customer panel, from fields the API already returns. Checked against OpenAPI 3.3.18
(25 Nov 2026). Full reference: <https://api.coronium.io/api-docs/>.

There are two places a badge can appear, and they read different fields:

| Where | Endpoint | Auth | What a badge means |
|---|---|---|---|
| Plan cards (before buying) | `GET /api/v3/tariffs/available` | none (public) | How many lines in stock for this plan have the feature right now |
| Region picker (before buying) | `GET /api/v3/free-modems` | none (public) | p0f only: how many lines in this region a p0f buy can get |
| Region picker, since OpenAPI 3.3.16 | `GET /api/v3/free-modems` | none (public) | Also `openvpn_count`, `ipv6_count` and `one_time_only_count`: how many lines in this region have OpenVPN, IPv6 ([IPv6 lines](ipv6-lines.md)), or are one-time rentals |
| Customer's own lines (after buying) | `GET /api/v3/account/proxies` | Bearer API key | Whether this exact line has the feature |

## 1. Plan cards: `GET /api/v3/tariffs/available`

One row per plan (country, carrier, term). A plan can hold mixed stock: some lines with
p0f and some without. Live example of such a row on 13 Nov 2026 (stock and counts
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

For this row the badges are "OS fingerprint on 17 of 35" and "OpenVPN". A buy with
`require: ["p0f"]` gets one of the 17 p0f lines, and a buy without it can get any kind.
Badge IPv6 per region from `ipv6_count` (section 2).

| Badge | Field | Show when | Suggested label |
|---|---|---|---|
| OS fingerprint (p0f) | `features.p0f.count`, `features.p0f.all` | `count > 0` | `all: true` -> "OS fingerprint"; otherwise "OS fingerprint on {count} of {stock}" |
| OpenVPN | `features.openvpn.count`, `features.openvpn.all` | `count > 0` | `all: true` -> "OpenVPN"; otherwise "OpenVPN on {count} of {stock}" |

Both tariff and regional stock rows may also carry `dataAllowanceNote`. Its
`gbPerMonth` and `text` describe the lowest declared monthly allowance among
the units that have a declaration. `count` counts those units and `all` says
whether all units have a declaration. With mixed stock, identify the count.
An absent note means the allowance is unspecified.

What a buy can guarantee:

- **p0f** can be required. Send `"require": ["p0f"]` and the checkout gives a p0f line or
  refuses before charging (409 `p0f_unavailable`). See
  [p0f-and-openvpn.md](p0f-and-openvpn.md). So a "with OS fingerprint" option on your
  checkout must add `require: ["p0f"]`.
- **IPv6** can be required: an "I need IPv6" option must add `"require": ["ipv6"]`. See
  [IPv6 lines](ipv6-lines.md).
- **OpenVPN cannot be required.** When `openvpn.all` is false, a buy may get a line
  without it. Only show a plain "OpenVPN" badge when every line has it; otherwise say how
  many ("on 3 of 16") so the customer is not promised something the checkout cannot select.
  You can guarantee OpenVPN per region instead: buy with a `region_id` whose `/free-modems`
  row has `openvpn_count == count`. See
  [Guaranteeing features per region](stock-and-credentials.md#guaranteeing-features-per-region).

## 2. Region picker: `GET /api/v3/free-modems`

```json
{ "country_id": "60436110...", "carrier_id": "61eff55b...", "region_id": "62251620...",
  "count": 4, "p0f_count": 0 }
```

Show an "OS fingerprint" badge on a region when `p0f_count > 0`, and send that `region_id`
with `require: ["p0f"]`.

Since OpenAPI 3.3.16 every row also carries `openvpn_count`, `ipv6_count` and
`one_time_only_count` (integers, always present, never more than `count`):

```json
{ "country_id": "60436110...", "carrier_id": "61eff55b...", "region_id": "62251620...",
  "count": 4, "p0f_count": 0, "p0f_ipv6_count": 0, "openvpn_count": 4, "ipv6_count": 4,
  "one_time_only_count": 1 }
```

| Badge on a region | Show when | Suggested label |
|---|---|---|
| OpenVPN | `openvpn_count > 0` | `openvpn_count == count` -> "OpenVPN"; otherwise "OpenVPN on {openvpn_count} of {count}" |
| One-time rental | `one_time_only_count > 0` | "{one_time_only_count} of {count} one-time (no auto-renew)" |

**IPv6 badge:** base it on `ipv6_count`, and show a plain "IPv6" badge only when it equals `count` (otherwise "IPv6 on {ipv6_count} of {count}"); see [IPv6 lines](ipv6-lines.md).

A plain "OpenVPN" badge on a region is a promise the checkout keeps only when the buy
sends that `region_id`. An order with `autoRenew: true` can get at most
`count - one_time_only_count` units from the row. Full table:
[Guaranteeing features per region](stock-and-credentials.md#guaranteeing-features-per-region).

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
| IPv6 | `features.native_ipv6` | `true` (the last address seen, not the purchase check; see [IPv6 lines](ipv6-lines.md)) |
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
  OS fingerprint badge stays true after `modem.replaced`. An IPv6 line keeps IPv6 the same
  way ([IPv6 lines](ipv6-lines.md)). Re-read the line to refresh IPv6 and OpenVPN.
- Never show our carrier or supplier names beyond what the plan row gives you.

## Minimal code

```ts
type Plan = {
  stock: number;
  features?: { p0f: { count: number; all: boolean }; openvpn: { count: number; all: boolean } };
};

export function planBadges(p: Plan): string[] {
  const out: string[] = [];
  const of = (n: number) => `on ${n} of ${p.stock}`;
  const f = p.features;
  if (f && f.p0f.count > 0) out.push(f.p0f.all ? 'OS fingerprint' : `OS fingerprint ${of(f.p0f.count)}`);
  if (f && f.openvpn.count > 0) out.push(f.openvpn.all ? 'OpenVPN' : `OpenVPN ${of(f.openvpn.count)}`);
  return out;
}

type Region = { count: number; ipv6_count: number };

export function regionIpv6Badge(r: Region): string | null {
  if (r.ipv6_count <= 0) return null;
  return r.ipv6_count === r.count ? 'IPv6' : `IPv6 on ${r.ipv6_count} of ${r.count}`;
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
