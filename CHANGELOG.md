# Changelog

Each entry names the Coronium API version (OpenAPI at <https://api.coronium.io/api-docs/>)
the kit was checked against. "Breaking" means an answer you may already handle changed;
"Additive" needs no client change.

## 2026.10.24b - synced with OpenAPI 3.3.5

Documentation only; no API behaviour changed and no example code changed. These live routes
are now in the OpenAPI reference with parameters, answers and refusals:
`PUT /modems/{id}/set-white-list`, `GET /modems/{id}/usage`, `POST`/`GET /modems/{id}/speed-test`
(Coronium Node lines, see [stock and credentials](docs/stock-and-credentials.md)),
`POST /modems/{id}/openvpn/revoke`, `GET`/`POST /account/pool/saved`,
`DELETE /account/pool/saved/{id}`, `POST /account/pool/saved/{id}/url` and
`GET /pool/stock/carriers/{country}`.

## 2026.10.24 - synced with OpenAPI 3.3.4

Kit version 2026.10.24. Example packages `0.2.0`.

### API changes since the last kit sync (live 20-23 Oct 2026)

Breaking:

- **Replacing a p0f line keeps p0f** (3.3.2, 22 Oct). A line bought with `require: ["p0f"]`,
  or one with an OS set, is replaced only by a p0f line, with its OS re-applied. With none
  available, `POST /modems/{id}/replace` answers `409 p0f_replacement_unavailable`
  (`suggested_action` `retry_later_or_allow_without_p0f`, `changed: false`) and nothing
  changes. Send `{"allow_without_p0f": true}` to accept a line without p0f. Before, it gave
  any line. The automatic swap sends `modem.dead` with the new `reason` `no_p0f_stock`.
- **`features.p0f.provider` removed** (3.3.2). So is `provider` on `p0f-options` and
  `set-os`. Use `vocabulary` (`os_profile`, `tcp_stack` or `null`) and take values from
  `supported_values` / `options`. `set-os` refusals no longer carry `apiMode` or `hint`.
- **A line on a network that rewrites the OS signature** reads
  `features.p0f.server_supported: false` with no values, and `set-os` answers
  `400 p0f_unsupported_on_server`.
- **`IMEI` and `portId` deprecated** (20 Oct). On the replace answer and the `modem.replaced`
  webhook they now carry the proxy `_id`, never a hardware or port id, and are removed on
  **2026-11-19**. The replace answer carries `deprecated`. Key on `_id`.
- **`/signup` and `/get-token` never reveal whether an account exists** (22 Oct). Sign-up
  answers `200 {"result":"ok"}` for an address that already has an account (it used to be
  `400`). Login answers `401 Invalid email or password.` for an unknown address and for a
  wrong password (it used to be `404 User not found` or `Invalid password.`).

Additive:

- `features.p0f.unavailable_reason` on every line: `mobile_network`, `line` or `null` (3.3.3).
- `features.p0f.vocabulary` on every line (3.3.2).
- A replaced p0f line adds `p0f` (`{required, kept, os, os_applied, pending?, note?}`) to the
  replace answer and to `modem.replaced`.
- Coronium Node rows: `provider: "coronium_node"` (top level and in `proxyEndpoints`) is the
  one documented provider value. Other labels stay opaque.
- OpenAPI 3.3.4 (documentation only): corrected auth, replace and proxy-list examples.

### Kit changes

Fixes (the kit said something that is not true):

- Replacements **keep** your `metadata`. AGENTS.md, llms.txt, the webhook receiver and the
  dashboard worker said they do not. Re-stamping stays as a harmless safety net.
- Removed `deposit.confirmed` from the reseller event list: it is never sent to a reseller URL.
  Confirm top-ups with `GET /account`.
- `modem.dead` reasons now match the API: added `no_p0f_stock`, `provider_unsupported`,
  `no_owner`, `config_error`, `move_<code>` (`unknown` stays).
- Rotation: only classic proxies answer `200` with `rotated`. Rows with `proxyEndpoints`
  answer `202` with `pending: true`. Poll `GET /modems/{id}/rotation-status`. README, AGENTS,
  llms.txt and the quickstart said "always 200".
- Webhook signing secret: create it yourself with `POST /account/webhook/secret/rotate`.
  The docs said to ask support.
- Out of stock is `409` with `code: "no_stock"` (the quickstart and failure table said
  `409 OUT_OF_STOCK`).
- `verify-integration.mjs` no longer adds day, week and month stock together in the
  per-country summary. Those terms share devices.
- Dashboard: a line moved in place (`new_modem_id === old_modem_id`) no longer loses its
  customer assignment.
- `docs/pricing-markup.md`: removed the made-up wholesale price table and a named company.
  Prices now come from `/tariffs/available` at runtime. Volume pricing follows the published
  terms: 10% at 10+ lines, 15% at 25+ lines, as a code from hello@coronium.io.

Additive:

- `lib/coronium.ts`: `replace(id, {allow_without_p0f})` with a typed `ReplaceResult`,
  `rotationStatus`, `p0fOptions`, `setOs`, `RotateResult` with `pending`, and
  `features.p0f.vocabulary` / `unavailable_reason`. Removed the `IMEI` field from `Proxy`:
  the proxy list never returns it.
- `verify-integration.mjs` checks that every line carries `features.p0f.vocabulary` and
  `unavailable_reason` and no `provider`, and counts the rows that rotate asynchronously.
- `docs/p0f-and-openvpn.md`: setting the OS, the `set-os` refusal table, replacing a p0f line,
  and one-download OpenVPN on Coronium Node rows.
- `docs/stock-and-credentials.md`: a line-type summary and a Coronium Node section.
- `docs/webhook-integration.md`: opt-in history events (`proxy.added`, `proxy.removed`,
  `proxy.updated`), moved lines, `data.p0f`.

## Earlier

Before this file existed the kit was synced on 21 Oct 2026 (OpenAPI 3.3.1: p0f stock per
region, `require: ["p0f"]` on buy, OpenVPN pending retry). See the git history.
