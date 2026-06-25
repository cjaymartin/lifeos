# ADR 0001 — Walmart Cart Control: on-demand cart ops

- **Status:** Accepted
- **Date:** 2026-06-25
- **Issue:** abraxas/lifeos#37
- **Branch:** `feat/walmart-cart-control`

## Context

The LifeOS browser extension bridges the user's authenticated Walmart session to
LifeOS. Until now it is **read-only and push-only**: content scripts scrape
`/orders` and `/cart` when the user happens to visit those pages and POST the
results to `/api/grocery/order-history` and `/api/grocery/carts/observed`. There
is no way for LifeOS (or the grocery agent) to *ask* Walmart anything on demand,
and no way to *act* (add/remove a cart line).

We want five capabilities available **at any time**:

1. Get the current Walmart cart.
2. Get item / order history.
3. Get pending Walmart deliveries.
4. Add an item to the cart (by productId + qty).
5. Remove an item from the cart (by productId).

They must feel seamless when the extension is installed and the user is logged
into Walmart, and degrade gracefully to a server-side "local Walmart session"
when the extension is unavailable.

### Why not just server-side automation?

Walmart's bot protection (PerimeterX/Akamai) blocks headless/automated browsers.
The user's own logged-in browser session sails through — which is the whole
reason the extension exists. So the **extension is the preferred executor**; the
server-side Playwright session (the persistent Chrome profile already used by
Settings → Logins) is a best-effort fallback, not the primary path.

## Decision

### Transport: command queue + extension long-poll (with Playwright fallback)

A small server-side **command queue** (`src/content/grocery/.walmart-commands.json`)
holds commands and their results. Flow:

```
UI / agent ──POST /api/grocery/walmart/command──▶ enqueue + wait (server long-poll)
                                                       │
extension background worker                            │ (if a fresh extension poll exists)
   ──GET  /api/grocery/walmart/commands──▶ claim pending command(s)
   ──(act in a Walmart tab)──
   ──POST /api/grocery/walmart/commands/result──▶ store result
                                                       │
front-door call resolves with the result ◀────────────┘
   └─ if no fresh extension poll OR the wait times out ▶ Playwright fallback executes server-side
```

- **`POST /command`** (session-guarded) is the single front door for UI + agent.
  It enqueues, then waits up to a short budget for the extension to complete the
  command, otherwise runs the Playwright fallback. The caller never has to know
  which executor ran.
- **`GET /commands`** (bearer token) is what the extension polls. Claiming a
  command records a `lastPolledAt`, which doubles as **presence**: the front door
  only waits for the extension when a poll was seen recently.
- **`POST /commands/result`** (bearer token) stores `{ ok, result | error }`.

Alternatives considered:

- **Playwright-first, extension mirrors** — rejected: bot detection makes the
  server path unreliable as the primary.
- **Persistent WebSocket/SSE bridge** — rejected: MV3 service-worker lifecycle
  makes long-lived sockets fragile; polling on `chrome.alarms` is robust and
  simple. Revisit if latency becomes a problem.

### Placement: extend the `grocery` feature

The grocery feature already owns `Retailer`, `carts.json`, `order-history.json`,
`product-map.json`, and the `build-carts` agent job. Walmart cart control is the
same domain, so it lives alongside as new ops/routes rather than a new feature.

### Deliveries: both sources

`get-deliveries` prefers a live Walmart account scrape (via the channel) and
falls back to the existing Gmail-based deliveries feed (`deliveries.json`).

### Agent interface: CLI script + skill

`scripts/walmart.mjs` is a thin CLI (`get-cart | get-history | get-deliveries |
add-item | remove-item`) that authenticates with the session bearer token and
hits the localhost front door, printing JSON. The `walmart-cart` skill documents
it so the headless agent can drive Walmart without knowing the transport.

## Guardrails

Same hard rule as `build-carts`: **never** place/submit/checkout an order, log in,
or enter payment/address. Add/remove touch the cart only. No retailer credentials
cross localhost — only product metadata.

## UI surfaces

Three places consume the channel from the browser (all via `groceryClient.walmart.*`):

1. **Built Walmart cart → "Add to cart"** (`GroceryApp`) pushes the pending lines
   into the real cart in one navigation (batch add) and auto-reconciles the
   "in cart" chips from what landed — replacing the open-tab + manual "what made
   it" step. The deep link remains as an "Open link" fallback. Amazon carts are
   unchanged (deep-link + reconcile).
2. **"Live Walmart cart" panel** (`GroceryApp`) — a Sync button that shows the
   real cart on demand, each line removable.
3. **"Walmart live" on Deliveries** (`DeliveriesApp`) — pulls live Walmart
   deliveries, labelled by source (`account` vs `gmail` backup).

`add-item` accepts either a single `productId`/`qty` (agent CLI) or a batch
`items[]` (the UI's "add all pending") — both resolve to one affiliate deep-link
navigation.

## Consequences

- The extension gains a write capability (cart add/remove). It is bumped to a new
  minor version; the in-app installer surfaces the update.
- Walmart DOM scraping/clicking is inherently brittle (as the existing content
  scripts already note). Selectors are written defensively with fallbacks and are
  expected to need occasional maintenance.
- The fallback depends on the Walmart persistent profile being signed in (Settings
  → Logins). When it is signed out and the extension is absent, on-demand ops
  return a clear "no executor available" error.

## Revisiting

If we later want sub-second latency or push semantics, replace the long-poll with
an SSE stream from the server to the extension (keep the same queue + result
shapes). If bot detection eases, the Playwright path could be promoted. This ADR
is the place to record that change.
