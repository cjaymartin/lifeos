# Technical Design — Groceries Page Refactor

- **Product:** LifeOS Groceries feature (`src/features/grocery/`)
- **Author:** Architect (Step 2 of 5)
- **Date:** 2026-06-09
- **Inputs:** [`BRD.md`](./BRD.md) (Step 1) — goals G1–G5, FR-x.x, NFRs, SC-1…6, and the 6 open questions
- **Status:** Draft for implementation hand-off (Steps 3–5)
- **Audience:** Implementers; the `to-issues` step that will slice this into tickets

> This document turns the BRD's *what* into a concrete *how*, grounded in the
> actual code. It answers the BRD's open questions, defines additive data-model
> changes, names the modules/functions/endpoints that change, and proposes a
> vertical-slice delivery plan. It does **not** write the code.

---

## 1. The core architectural problem

Everything the user called "out of sync with Walmart" traces to **one fact**:

> The Walmart bulk add-to-cart link (`affil.walmart.com/cart/addToCart?items=…`,
> built in `buildAddToCartUrl`, `types.ts:147`) is **fire-and-forget**. LifeOS
> opens it in a new tab; the user lands on Walmart; LifeOS gets **zero feedback**
> about what actually landed in the real cart. The hard rule forbids logging in
> or reading the user's Walmart cart server-side, so we can **never observe** the
> true cart state.

Today the code papers over this with an **optimistic, all-or-nothing guess**:
clicking "Add to cart" fires the link and, after a 300 ms deferral hack
(`GroceryApp.tsx:928`, documented at `:597`), blanket-sets `addedQty = qty` on
*every* pending line (`carts.ts:34`, `setCartAdded`). "In cart" is therefore a
**guess, not truth** — and when a product is wrong, out of stock, or only
partially added, the guess is wrong, which is exactly the user's pain.

**Design stance:** we cannot observe the real cart, so we **make the guess
honest** by adding one lightweight, user-driven reconciliation interaction after
the handoff, and we **stop silently dropping** items at build time so the user
always sees the full truth of what matched, what substituted, and what didn't.
This is the spine of the refactor; G2/G3/G4/G5 hang off it.

---

## 2. Answers to the BRD's open questions

These are the binding design decisions. Sections 4–6 detail each.

**Q1 — Walmart "what landed" fidelity (FR-1.2/1.3).**
We **can** observe the real cart — but only from the user's *own* interactive,
logged-in session, never by server-side automation (which Walmart's bot defense
blocks; see §4.6). Two layers:
- **Baseline (always works):** after the user follows the add-to-cart link,
  LifeOS shows a **per-line reconciliation panel** — "You sent N items to
  Walmart — uncheck anything that didn't make it." This converts the optimistic
  blanket `addedQty` into **per-line truth** with one interaction, replaces the
  all-or-nothing `mark-added`/`reset-added`, and lets us delete the 300 ms
  deferral hack.
- **Upgrade (§4.6):** a **bookmarklet** (later, a browser extension) reads the
  real cart DOM in the user's session and **auto-fills** that panel — confirmed
  vs. didn't-land becomes a glance, not a chore.
Confirmed lines set `addedQty = qty` (so the next build excludes them → no
duplicate re-adds); unconfirmed lines stay buildable. The bookmarklet is a strict
upgrade *on top of* reconciliation, not a replacement — manual reconcile is the
fallback when it isn't used.

**Q2 — Out-of-stock detection + fallbacks (FR-2.x).**
The `build-carts` agent already fetches and checks the product page for "out of
stock / unavailable" on every `source:"new"` match (SKILL.md Step 2 "Verify on
the product page"). Today it **discards** a dead match. We change it to **capture
2–3 alternative candidate products** instead of discarding, and to emit a
per-line `status`. The agent may pre-select the closest alternative
(`substituted: true`) so the cart stays usable; the UI shows the alternatives
inline for the user to confirm/override. Stock-checking remains best-effort
(bot-gated pages cap confidence at `medium`, as today).

**Q3 — Where substitutions / pins / default-qty live (FR-2.4/3.x).**
- **Substitution memory:** accepting a substitute writes a **learned** (`pinned:
  false`) entry into `product-map.json` under the item's normalized name — the
  existing instant-resolution path (`assembleCarts`, `ops.ts:257`) then reorders
  it for free next time. A learned entry **never overwrites a `pinned: true`**
  one; if a pinned product is out of stock we keep the pin and attach a
  transient `substitute` on the cart line only (the pin may restock).
- **Pins:** unchanged storage (`product-map.json`, `pinned:true`), but pinning
  becomes one-click **from a cart line** (Section 6.3) in addition to URL paste.
- **Default quantity:** new optional `defaultQty?: number` on `GroceryItem` and
  `Staple` (Section 3). No new file; both already exist.
- We avoid the "near-duplicate keys" accretion the BRD flagged by **always
  keying on `normalizeName(item.name)`** (already the convention) and by writing
  learned entries only on *confirmed* outcomes (checkout/substitute-accept),
  not on every speculative match.

**Q4 — Categorization approach (FR-4.x).**
Three additive layers, cheapest first, **no new blocking latency**:
1. A **learned category map** (`category-map.json`, normalizedName → category)
   consulted *before* the keyword heuristic. Written whenever the user overrides
   a category or the categorize agent confirms one. This is the durable fix —
   user overrides stick (FR-4.2) and the agent's good answers persist.
2. **Expanded keyword lists** in `categorizeHeuristic` (`ops.ts:117`) to cover
   today's misses (paper plates/bowls/cups, napkins, cutlery; psyllium/fiber/
   supplement; common meds) — pure data, instant.
3. The existing **async categorize agent** as the final fallback for genuinely
   unknown items — unchanged mechanism, now writes to the learned map so it only
   ever has to decide a given name once.
   We also route `addStaple` through the same resolver so staples stop seeding as
   "Other" (the root cause of milk/ibuprofen/psyllium sitting in "Other").

**Q5 — Unavailability email parsing (FR-5.x).**
Extend the `grocery-purchase-scan` agent to additionally match Walmart emails
signalling **item unavailable / refunded / "we couldn't fulfill" / out of stock**
(subjects/snippets like *"items were unavailable", "refund", "out of stock",
"changes to your order", "item(s) not available"*). It already reads order
emails; we widen the query and add an `unavailable: [...]` array to
`.scan-results.json`, **tied back to the original `orderId`** so the server
re-adds exactly the right item. The server (`loadGroceryState`, `ops.ts:154`)
applies it: re-add the item to the list, mark its `purchases.json` record
`refunded: true`, and **do not** keep a `lastPurchased` for the unfulfilled item
(set the matching staple back to `out`).

**Q6 — Stretch: live cart total (FR-1.6).**
**Include it, cheaply.** The agent already records `price` per line. LifeOS sums
the matched lines' prices and shows an **estimated cart total** on the cart card,
clearly labelled "estimated, before tax & fees." No new fetching; if some lines
lack a price, show "≥ $X (N items unpriced)". Purely additive, low risk.

---

## 3. Data model changes (all additive & back-compatible — NFR-6 / FR-6.4)

No existing field changes meaning; every new field is optional, so current JSON
keeps validating and old files load unchanged.

### 3.1 `types.ts`

```ts
// GroceryItem — add:
defaultQty?: number;        // preferred purchase count; overrides parsed quantity at build

// Staple — add:
defaultQty?: number;        // carried onto the list item when the staple auto-re-adds

// CartMatch — add:
status?: 'ok' | 'out_of_stock' | 'unavailable';   // default 'ok' when absent
alternatives?: ProductCandidate[];                 // ranked fallbacks the agent found
substituted?: boolean;      // agent auto-picked an alternative; UI flags it
// (addedQty stays, but is now set per-line by reconciliation, not blanket)

// PurchaseRecord — add:
refunded?: boolean;         // set when a later unavailability email reverses a purchase

// new:
export interface ProductCandidate {
  productId: string;
  product: string;
  price?: string;
  productUrl?: string;
  size?: string;            // free-form, for the "pick a size" decision
}
```

### 3.2 New content file — `src/content/grocery/category-map.json`

```jsonc
{ "psyllium fiber": "Personal Care", "paper plates": "Household" }  // normalizedName → category
```
Consulted before the keyword heuristic; written on user override and on
categorize-agent confirmation. Mirrors the `product-map.json` pattern (learned
memory keyed by normalized name). Loaders/savers in `ops.ts`.

### 3.3 `.scan-results.json` (agent output) — extended shape

```jsonc
{
  "purchases":   [ /* unchanged: confirmed buys to remove + restock */ ],
  "unavailable": [ { "name": "...", "orderId": "...", "date": "...", "matchedItemIds": ["..."] } ]
}
```
`GroceryState` (the GET payload) is unchanged in shape — these are transient
agent files reconciled server-side.

---

## 4. Goal-by-goal design

### G1 — Reliable cart ↔ Walmart handoff  (FR-1.1–1.6)

**Build (unchanged spine, hardened).** `assembleCarts` (`ops.ts:235`) still
resolves known items instantly from `product-map` and queues unknowns to
`cart-request.json` for the agent. Hardening:
- **FR-1.5 concurrency:** `build-carts.ts` checks `isJobRunning('build-carts')`
  and returns `{status:'running'}` instead of spawning a second agent; the UI
  disables "Build Carts" while `buildState === 'loading'` (state already exists).

**Handoff + reconciliation (the core change).**
- The cart card keeps the bulk add-to-cart `<a href>` (real one-link add, FR-1.1).
- Replace the optimistic blanket `setCartAdded(...true)` on click. Instead, when
  the user returns to the tab (or clicks "I sent these"), show a **reconciliation
  panel** listing the pushed lines, each checked by default. The user unchecks
  any that didn't land. Submitting:
  - checked → `addedQty = qty` (server, per line);
  - unchecked → `addedQty` cleared, line stays buildable.
- **FR-1.2 (know what landed):** the cart card now shows three line states —
  *in cart* (green, `addedQty ≥ qty`), *pending*, *needs attention* (out of
  stock / unmatched). This is real per-line truth, not a guess.
- **FR-1.3 (no duplicate re-adds):** `assembleCarts` already excludes
  `addedQty ≥ qty` lines (`ops.ts:241`); per-line reconciliation makes that
  exclusion *accurate*, so rebuild/return never re-adds a confirmed line.
- **FR-1.4 (resilient handoff):** because reconciliation is explicit, a bot-check
  or partial add is just "uncheck the ones that failed" — no lost state, and the
  fragile 300 ms deferral hack (`:928`) is removed.
- **FR-1.6 (estimated total):** sum line `price`s on the card (Section 2/Q6).
- **Confirmed-purchase learning (feeds G3):** on checkout/reconcile, persist each
  confirmed line's `productId` into `product-map.json` as a learned entry
  (never overwriting a pin). This closes the loop so the next reorder locks onto
  the product the user actually bought.

**Endpoints:** repurpose `POST /api/grocery/carts` to accept
`{ retailer, addedItemIds: string[] }` (per-line) alongside the legacy
`mark-added`/`reset-added` (kept for back-compat during migration).

### G2 — Interactive out-of-stock flow  (FR-2.1–2.4)

**Agent (`build-carts` SKILL.md).** When the verify step finds the chosen product
out of stock/unavailable:
- do **not** discard silently (FR-2.1);
- collect **2–3 ranked alternatives** from the same search results (same-container
  rule already in the skill) → `alternatives: ProductCandidate[]`;
- emit `status:'out_of_stock'`; optionally pre-select the closest alternative as
  the line's product with `substituted:true` (FR-2.3);
- never invent a match — if no alternative is plausible, leave the line with
  `status:'out_of_stock'` and empty `alternatives` (it shows as "needs attention",
  not dropped).

**UI (`GroceryApp.tsx` cart line).** A line with `status:'out_of_stock'` renders
an inline **"Out of stock — pick a substitute"** control listing the
`alternatives` (title · size · price) plus "keep waiting / remove". Picking one:
- updates the line's `productId/product/price` and rebuilds `cartUrl`;
- writes a **learned `product-map` entry** for that item name (FR-2.4 — remembered
  next time), respecting pins per Q3;
- a `substituted:true` line shows a clear "substituted" badge the user can change.

**Endpoint:** `POST /api/grocery/carts/substitute`
`{ retailer, itemId, productId }` (chosen from `alternatives`) → update line +
learn product. (Or fold into the existing `carts` PATCH.)

### G3 — Trustworthy product locking  (FR-3.1–3.5)

- **FR-3.1 / 3.5 easy pinning:** add a one-click **"Always use this"** on every
  cart line (pins the line's `productId` → `product-map`, `pinned:true`) and a
  **"wrong product?"** affordance that reuses the G2 alternatives picker. URL-paste
  pinning (`product-map.ts` POST, `ItemSettings` cog) stays for power use.
- **FR-3.2 pins sacred:** unchanged guarantee — agent skill Step 4 and the
  learned-write paths must never overwrite `pinned:true` (already enforced;
  add a unit test as a regression guard).
- **FR-3.3 prefer last-bought:** the confirmed-purchase learning in G1 means a
  real purchase becomes a learned product-map entry, so the next build reorders
  the exact product instead of re-guessing. Agent priority order is unchanged.
- **FR-3.4 default quantity:** new `defaultQty` (Section 3). `assembleCarts`
  computes `qty = item.defaultQty ?? countQty(item.quantity)` (`ops.ts:210`).
  Editable from the item settings cog; carried staple→list in `syncStapleToList`
  (`ops.ts:337`).

### G4 — Smarter categorization  (FR-4.1–4.3)

- **Resolver order** in a new `resolveCategory(name)`: `category-map.json` hit →
  `categorizeHeuristic` keyword hit → `['Other', false]` (agent fallback). Used
  by item-add (`/api/grocery` POST) **and** `addStaple` (fixes "Other" staples).
- **FR-4.1 expanded keywords:** add to `KEYWORD_CATEGORIES` (`ops.ts:117`):
  Household — `plate, bowl, cup, napkin, cutlery, fork, spoon, knife, paper plate`;
  Personal Care — `psyllium, fiber, supplement, probiotic, antacid, ibuprofen`
  (note: real data has a misspelling "Ibuprofin" — learned map covers
  misspellings the heuristic can't).
- **FR-4.2 overrides persist:** setting a category in the UI writes
  `category-map.json[normalizeName(name)] = category`. Future adds of that name
  resolve instantly and correctly. The categorize agent also writes the map on
  confirm, so each name is decided once.
- **FR-4.3 non-blocking:** map + heuristic are synchronous; only true unknowns
  hit the async agent (mechanism unchanged, `jobs.ts` `categorize`).
- **One-time data cleanup:** a small migration runs `resolveCategory` over the
  current 22 staples to re-file the existing "Other" entries (milk → Dairy,
  paper plates/bowls → Household, etc.).

### G5 — Catch post-order unavailability  (FR-5.1–5.4)

- **Agent (`grocery-purchase-scan` SKILL.md):** widen the Gmail query to include
  unavailability/refund signals; emit `unavailable: [...]` keyed by `orderId`
  (Section 3.3). Keep order-confirmation handling as-is.
- **Server (`loadGroceryState`, `ops.ts:176`):** after applying `purchases`,
  apply `unavailable`:
  - **FR-5.2** re-add the item to `grocery.items` (`source:'scan'`, a note like
    "Walmart: unavailable — reorder") if not already present;
  - **FR-5.1/5.4** if a `purchases.json` record matches the `orderId`+name, set
    `refunded:true` on it (honest history);
  - **FR-5.3** if a matching staple was restocked by that order, set it back to
    `out` and clear/skip the `lastPurchased` for the unfulfilled item.
- **Ordering note:** confirmation and unavailability can arrive in the same scan;
  apply `purchases` first, then `unavailable`, so a refunded item ends net
  back-on-list.

### G1+ — Real-cart capture: bookmarklet → extension  (upgrades FR-1.2/1.3)

**Why not server-side.** The `build-carts` agent runs **headless in the Docker
container**; Walmart sits behind HUMAN/PerimeterX + Akamai fingerprinting that is
purpose-built to block automated/headless browsers (the skill already caps
confidence to `medium` on bot-gated pages). A server-side cart scrape would be the
flakiest "source of truth" in the system. The key insight: **automation gets
blocked, the user does not** — so we read the cart from *inside the user's own
interactive, already-logged-in session* and ferry the data to LifeOS on localhost.

**Hard-rule stance.** Reading your *own* already-authenticated cart is
**observation, not a transaction** — it does not log in, pay, or check out, so it
sits within the absolute rule (which forbids LifeOS *acting* on the user's
behalf). The bookmarklet/extension variants keep **credentials entirely out of
LifeOS**: it never sees a password or session cookie, only the resulting line
items. This is the deciding reason to prefer them over a Playwright-with-profile
or cookie-replay approach (both of which would put the user's Walmart session
inside LifeOS and still fight bot detection).

**Phase 1 — Bookmarklet (this refactor).**
- A small JS bookmarklet the user keeps in their bookmarks bar. While on
  `walmart.com/cart`, they click it; it reads the rendered cart line items
  (product title, productId from the `/ip/<id>` links, qty, price) from the DOM
  and `POST`s them to a LifeOS localhost endpoint.
- **Ingest endpoint:** `POST /api/grocery/carts/observed`
  `{ retailer:'walmart', items:[{ productId, product?, qty?, price? }] }`.
  Server matches observed `productId`s against the current Walmart cart's
  `CartMatch` lines and sets `addedQty` accordingly — **present ⇒ `addedQty =
  observed qty`; absent ⇒ `addedQty` cleared (didn't land)**. Unknown productIds
  in the cart are surfaced as "also in your cart (not from this list)" info only.
- **Parser:** a tolerant DOM scrape (Walmart markup shifts), keyed on the stable
  `/ip/<itemId>` pattern already parsed by `parseProductUrl` (`ops.ts:75`); if the
  page layout defeats it, the bookmarklet posts nothing and the user falls back to
  manual reconciliation — no silent wrong state.
- **CORS/security:** endpoint is localhost-only and behind the existing
  `requireSession` guard; accept only the two retailer hosts' shape. Because the
  bookmarklet runs in the user's tab, no Walmart auth crosses into LifeOS.
- **Result:** the reconciliation panel (G1) opens **pre-filled** — green =
  confirmed in cart, struck-through = didn't make it — so the user glances and
  confirms instead of hand-unchecking.

**Phase 2 — Browser extension (follow-up, tracked not built here).**
Same ingest contract, but an installed extension reads the cart automatically
(e.g. on cart-page load or a toolbar click) and posts to LifeOS, removing the
manual bookmarklet click. Deferred to keep this refactor shippable; filed as a
follow-up issue. The `observed` endpoint is designed so the extension needs **no
server changes** — only a nicer client.

---

## 5. Module / boundary map (what changes where)

The refactor stays entirely within the existing Feature; **no new feature, no
cross-feature coupling**. Shared deep modules (`src/lib/jobs/runner`, auth,
stack-client) are untouched.

| Layer | File | Change |
| --- | --- | --- |
| Types/constants | `src/features/grocery/types.ts` | + `defaultQty`, `CartMatch.status/alternatives/substituted`, `ProductCandidate`, `PurchaseRecord.refunded` |
| Server ops | `src/features/grocery/ops.ts` | category-map load/save + `resolveCategory`; `assembleCarts` qty + concurrency; new `reconcileCartAdds`/`acceptSubstitute`; confirmed-purchase product learning in `checkoutItems`; `unavailable` handling in `loadGroceryState`; staple re-file migration |
| Agent jobs | `src/features/grocery/jobs.ts` | no mechanism change (allowedTools already cover Gmail/web/writes) |
| Skills | `.claude/skills/build-carts/SKILL.md` | out-of-stock → capture alternatives + `status`; keep merge rules |
| Skills | `.claude/skills/grocery-purchase-scan/SKILL.md` | detect unavailability/refunds → `unavailable[]` |
| Browser client | `src/features/grocery/client.ts` | + `reconcileCart`, `acceptSubstitute`, `pinFromLine`, `setCategory`, `setDefaultQty` |
| API routes | `src/pages/api/grocery/carts.ts` | per-line `addedItemIds` reconcile; substitute action |
| API routes | `src/pages/api/grocery/items/[id].ts` | accept `category` (→ learned map) + `defaultQty` patches |
| API routes | `src/pages/api/grocery/product-map.ts` | optional: pin-from-line by `productId` (not just URL) |
| API routes | `src/pages/api/grocery/carts/observed.ts` *(new)* | ingest real-cart line items from the bookmarklet/extension → set per-line `addedQty` |
| Asset | bookmarklet (a `dev/` page or settings snippet) *(new)* | JS that scrapes `walmart.com/cart` DOM in the user's session and POSTs to `/observed` |
| UI | `src/components/grocery/GroceryApp.tsx` | reconciliation panel (auto-fillable from `observed`); out-of-stock substitution control; one-click pin/"wrong product"; estimated total; remove 300 ms hack; category override persistence |

**Hard-rule guard (FR-6.3):** every new flow still only *builds links*; no new
write path logs in, pays, or checks out. The reconciliation panel is explicitly
"the user tells us what they already did," never an automated purchase.

---

## 6. Cross-cutting concerns

- **Atomicity / mid-write reads (NFR-1).** New writes (`category-map.json`,
  learned product-map updates, reconcile) use the existing `writeJson`
  (`ops.ts:31`). Note the repo's known "tolerate mid-write reads" pattern
  (e.g. deliveries e2e); keep all multi-file mutations server-side inside the
  single `loadGroceryState` reconcile pass so the UI never observes a torn state.
- **Migration / back-compat (NFR-6).** Missing `status` ⇒ `'ok'`; missing
  `defaultQty` ⇒ `countQty`; missing `category-map.json` ⇒ `{}`. Old `carts.json`
  with blanket `addedQty` still renders. The staple re-file migration is
  idempotent (only touches `category === 'Other'`).
- **Transparency / undo (NFR-4).** Auto-substitution is *flagged*, not silent;
  scan removals and unavailability re-adds remain visible list changes; the
  reconciliation panel is itself the "what changed" surface.
- **Testability (NFR-7).** Unit tests: `resolveCategory` precedence, learned-map
  write on override, `assembleCarts` qty + concurrency guard, pin-never-overwritten,
  `unavailable` re-add + staple reset, confirmed-purchase learning. E2e
  (sandboxed, agents shimmed): full build → reconcile → no-duplicate rebuild;
  out-of-stock → substitute → remembered; category override persists across add.
  Run `npm test` + `npm run test:e2e`; `npm run build` after structural changes.

---

## 7. Proposed delivery slices (for the `to-issues` step)

Tracer-bullet vertical slices, ordered so each ships value and de-risks the next.
Each slice touches data + ops + API + UI (+ agent/skill where noted) end-to-end.

1. **S1 — Honest handoff & reconciliation (G1 core).** Per-line `addedItemIds`
   reconcile, three-state cart line, estimated total, remove deferral hack,
   concurrency guard. *Delivers SC-1.* Highest priority; unblocks accurate
   "in cart" for everything else.
2. **S2 — Confirmed-purchase product learning + default qty (G3).** Learn
   `productId` on checkout/reconcile; `defaultQty` on item/staple. Small, makes
   reorders lock in. *Delivers SC-3 (partial).*
3. **S3 — Out-of-stock alternatives (G2).** Agent captures `alternatives` +
   `status`; inline substitution UI; remember substitute. *Delivers SC-2.*
   (Agent/skill + UI; depends on S1's line states.)
4. **S4 — One-click product locking (G3 UX).** "Always use this" / "wrong
   product?" from a cart line, reusing S3's picker. *Completes SC-3.*
5. **S5 — Smarter categorization (G4).** `category-map.json` + `resolveCategory`,
   expanded keywords, override persistence, staple re-file migration.
   *Delivers SC-4.* Independent of S1–S4; can run in parallel.
6. **S6 — Unavailability emails (G5).** Scan agent `unavailable[]` + server
   re-add/refund/staple-reset. *Delivers SC-5.* Independent; can run in parallel.
7. **S7 — Real-cart capture bookmarklet (G1+).** `POST /carts/observed` ingest +
   DOM-scraping bookmarklet that auto-fills the reconciliation panel. *Upgrades
   SC-1.* Depends on S1 (needs the per-line `addedQty` model + reconcile panel).
   The browser **extension** is a tracked follow-up (same `observed` contract,
   no server change) — filed as a new issue, not built in this refactor.

**Regression guard (SC-6):** the preserve-list — manual staple toggles, instant
product-map resolution, no-purchase rule, existing schemas — gets explicit unit
tests in S1 and S5.

**Out of scope (tracked):** meal planning / recipe→list (issues **#23**, **#24**);
voice/phone capture; cadence auto-restock; new retailers.

---

## 8. Risks & trade-offs

- **R1 — Reconciliation adds a click.** Mitigation: default-all-checked, single
  submit; it *replaces* the unreliable silent guess, and the user explicitly
  asked to "know what made it vs didn't," so the interaction is the feature.
- **R2 — Walmart page parsing for stock/alternatives is brittle** (bot-gating,
  layout changes). Mitigation: best-effort, same as today's verify step; cap
  confidence and fall to "needs attention" rather than a bad auto-substitute.
- **R3 — Learned-map drift / stale products.** Mitigation: learn only on
  *confirmed* outcomes; pins always win; an out-of-stock learned product surfaces
  the substitution flow, which re-learns.
- **R4 — Email-signal false positives for "unavailable."** Mitigation: require an
  `orderId` tie-back before re-adding; mark `refunded` rather than deleting
  history; user sees the re-added item and can remove it.
- **R5 — `affil.walmart.com` bulk-add link limits** (length, per-item caps,
  affiliate redirects). Mitigation: unchanged from today; the reconcile step is
  exactly what catches a link that only partially applied.
- **R6 — Bookmarklet DOM scrape breaks when Walmart changes markup** (G1+).
  Mitigation: key on the stable `/ip/<itemId>` URL pattern, not CSS classes;
  on parse failure post nothing and fall back to manual reconciliation (never a
  silent wrong state); the scrape is read-only in the user's own session, so it
  neither holds credentials nor trips bot detection.

---

## 9. Traceability — FR → design section

| FR | Design |
| --- | --- |
| FR-1.1 one-link cart | §4 G1 (bulk add-to-cart kept) |
| FR-1.2 what landed | §4 G1 reconciliation + 3-state line; §4.6 G1+ auto-fill from real cart |
| FR-1.3 no duplicate re-adds | §4 G1 (`addedQty` exclusion made accurate); §4.6 confirmed by observed cart |
| FR-1.4 resilient handoff | §4 G1 (per-line uncheck; hack removed) |
| FR-1.5 concurrency | §4 G1 / §5 (`isJobRunning` guard) |
| FR-1.6 estimated total | §2 Q6 / §4 G1 |
| FR-2.1 never drop | §4 G2 (`status:'out_of_stock'`, no discard) |
| FR-2.2 ranked fallbacks | §4 G2 (`alternatives` + inline picker) |
| FR-2.3 auto-pick + flag | §4 G2 (`substituted:true`) |
| FR-2.4 remember substitute | §2 Q3 / §4 G2 (learned product-map) |
| FR-3.1/3.5 easy pinning | §4 G3 (one-click from line) |
| FR-3.2 pins sacred | §4 G3 (guarded + test) |
| FR-3.3 prefer last-bought | §4 G1 confirmed-purchase learning |
| FR-3.4 default qty | §3 / §4 G3 (`defaultQty`) |
| FR-4.1 fix "Other" | §4 G4 (expanded keywords + staple re-file) |
| FR-4.2 overrides persist | §4 G4 (`category-map.json`) |
| FR-4.3 non-blocking | §4 G4 (sync resolver; agent only for unknowns) |
| FR-5.1 detect unavailable | §4 G5 (scan agent widened) |
| FR-5.2 re-add | §4 G5 (server apply) |
| FR-5.3 no false lastPurchased | §4 G5 (staple reset) |
| FR-5.4 consistent w/ auto-removal | §4 G5 (apply purchases then unavailable) |
| FR-6.1–6.4 preserve | §3 / §5 / §6 (additive, guarded, tested) |
```
