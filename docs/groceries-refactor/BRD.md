# Business Requirements Document — Groceries Page Refactor

- **Product:** LifeOS Groceries feature (`src/features/grocery/`)
- **Author:** Product Manager (discovery agent)
- **Date:** 2026-06-09
- **Status:** Draft for architect hand-off (Step 1 of 5)
- **Audience:** Architect (Step 2), implementers (Steps 3–5)

> Scope note: This is a **requirements** document. It states the problem, the
> current state, the prioritized pain points, and what success looks like. It
> deliberately does **not** prescribe a technical solution — that is owned by the
> architect in the next step.

---

## 1. Problem Statement

The Groceries page works on paper — list, staples, categories, agent-built carts,
Gmail purchase scanning — but the **end-to-end shopping flow is more manual than
the user wants**, and the **rendered cart cannot stay in sync with Walmart**.

The single biggest wound, in the user's words: *"Cart building is slow/flaky.
The rendered cart cannot seem to stay in sync with Walmart. The whole experience
end-to-end is more manual than I would prefer."*

Concretely, the cart-build → review → Walmart-handoff → checkout loop loses
fidelity at every seam: products/sizes are matched wrong, out-of-stock items are
**silently dropped** when the user clicks into the cart, the add-to-cart handoff
is clunky and re-adds duplicates, and LifeOS has no idea which items actually
made it into the real Walmart cart. The user ends up finishing the job by hand.

The refactor must make the cart↔Walmart handoff **reliable, transparent, and
low-touch** — within the hard constraint that LifeOS never places orders.

---

## 2. Current-State Summary (from code investigation)

### 2.1 Feature anatomy
LifeOS is a local-first dashboard (Astro UI + local JSON in `src/content/`).
The Groceries feature is a standard LifeOS "Feature" registered in
`src/features/index.ts` as `groceryFeature` (sidebar entry "Groceries",
`/grocery`, no dashboard widget, has a `chat.md` guide).

| Concern | File(s) |
| --- | --- |
| Manifest | `src/features/grocery/feature.ts` |
| Types & constants (browser-safe) | `src/features/grocery/types.ts` |
| Server ops (file I/O, business logic) | `src/features/grocery/ops.ts` |
| Agent job definitions | `src/features/grocery/jobs.ts` |
| Typed browser client | `src/features/grocery/client.ts` |
| Chat guidance | `src/features/grocery/chat.md` |
| Page entry | `src/pages/grocery/index.astro` |
| Main UI (~1168 lines) | `src/components/grocery/GroceryApp.tsx` |
| API routes | `src/pages/api/grocery/*.ts` (index, items/[id], staples, carts, build-carts, build-progress, purchase-scan, checkout, product-map, status) |
| Agent skills | `.claude/skills/build-carts/`, `.claude/skills/grocery-categorize/`, `.claude/skills/grocery-purchase-scan/` |

### 2.2 Data model (the database)
All under `src/content/grocery/`:

- **`grocery.json`** — the list. `{ lastUpdated, items: [...] }`. Each item:
  `id` (kebab-case name + random suffix), `name`, `quantity?` (free-form string —
  "2", "1 lb"), `note?`, `category` (one of 11 fixed), `categoryConfirmed` (bool;
  false ⇒ awaiting categorize agent), `staple` (bool), `checked` (bool), `addedAt`
  (ISO), `source` (`manual|chat|staple|recipe|scan`), `buyFrom?` (`walmart|amazon`).
- **`staples.json`** — `{ staples: [...] }`. Each: `id`, `name`, `category`,
  `status` (`stocked|low|out`), `lastPurchased?` (YYYY-MM-DD), `restockAt?`
  (`low|out|never`), `buyFrom?`. **22 staples today, nearly all `stocked`.**
- **`product-map.json`** — `Record<normalizedName, ProductRef>`. Each ref:
  `retailer`, `productId` (Walmart item ID / Amazon ASIN), `product?` (title),
  `productUrl`, `pinned?` (true ⇒ user-chosen, agents must never overwrite).
- **`purchases.json`** — `{ purchases: [...] }`, append-only history: `date`,
  `name`, `quantity?`, `source` (`walmart|amazon|in-store|scan`), `orderId?`.
- **`carts.json`** — built carts: `{ builtAt, carts: [RetailerCart] }`. Each cart:
  `retailer`, `label`, `cartUrl?` (bulk add-to-cart deep link), `items: [CartMatch]`,
  `unmatched: string[]`, `notes?`. Each `CartMatch`: `itemId`, `name`, `product?`,
  `price?`, `productUrl?`, `productId`, `qty?`, `addedQty?` (how many pushed to the
  real retailer cart, UI-managed), `confidence` (`high|medium|low`),
  `source` (`reorder|new`).
- **Transient agent I/O:** `cart-request.json` (`{ itemIds }`, build input),
  `.categorized.json` (`id→category`), `.scan-results.json` (Gmail matches).
  Server merges and deletes these on the next state load.

### 2.3 Current capabilities
- **List:** quick-add parser ("2 milk", "1 lb beef"), 11 fixed categories with a
  keyword heuristic + async categorize agent for the rest, per-item rename / qty /
  note / star-as-staple / pin-product / restrict-to-retailer / delete, "checked"
  buffer that survives until "Clear checked" (which logs to `purchases.json`).
- **Staples:** manual `stocked→low→out` cycle, `restockAt` policy that auto-adds
  to the list, one-way staple→list sync of name/category/buyFrom/status.
- **Cart building (two-phase):** instant resolution from `product-map.json` (zero
  web lookups), then a `build-carts` agent for the rest (priority: product-map →
  past Walmart order emails → Walmart web search → Amazon fallback → unmatched).
  Walmart-first; Amazon only as fallback. Produces one Walmart cart (+ optional
  Amazon), then a manual review → add-to-cart-link → "I checked out" handoff.
- **Purchase scan:** `grocery-purchase-scan` agent reads Gmail order
  confirmations (~last 7 days), loosely matches to list items, and the server
  **auto-removes** matched items + updates `lastPurchased`.
- **Hard rule (enforced in skill docs + chat.md):** never place orders, never
  enter payment or login. Building carts/links/lists is fine; purchasing is the
  user's own action.

### 2.4 Observed gaps that bear on this refactor
- Cart state is **current-only** and the agent **rewrites `carts.json` wholesale**;
  no notion of "what actually landed in the real Walmart cart."
- Out-of-stock items are **silently dropped** rather than surfaced for a decision.
- `buildAddToCartUrl()` assumes no mid-build qty changes; `addedQty` is the only
  signal of what's been pushed, and concurrent "Build Carts" clicks can clobber.
- Auto-categorize is substring-based and **mis-files routine items into "Other"**
  (today: `fairlife 2% milk`, `paper plates`, `paper bowls`, `Ibuprofin`,
  `psyllium fiber` are all `Other`).
- `product-map.json` accretes near-duplicate keys for the same real product;
  pins are the only authoritative anchor and pinning is one-at-a-time.
- Purchase scan only looks for *order confirmations* — it does **not** catch
  Walmart "item unavailable / refunded" emails.

---

## 3. Prioritized Pain Points (from the user)

Ranked by the user's own emphasis during discovery (P0 = must fix this refactor).

1. **[P0] Cart cannot stay in sync with Walmart; end-to-end is too manual.**
   The core wound. The user wants to *know what made it into the cart vs. what
   didn't*, *stop re-adding duplicates*, and get *one link = the full, accurate
   cart*.
2. **[P0] Out-of-stock items are silently dropped at build time.**
   When the user clicks into the cart, items are just gone. They want an
   interactive *"that item is out of stock — how about these fallbacks?"* flow.
3. **[P0] Wrong product / wrong size matched on reorder.**
   The matcher re-guesses instead of locking onto the exact product. The user
   wants **better pinning** ("identify a *specific* item") that agents never override.
4. **[P0] Auto-categorize is wrong too often.** Routine items land in "Other."
5. **[P1] Post-order unavailability is invisible.** Walmart "item unavailable /
   refunded" emails aren't caught; the user wants those items **re-added to the
   list automatically** so nothing silently falls through.
6. **[P2] Capture-anywhere is desired but secondary.** The user builds/shops on
   **desktop** (primary). Voice and/or phone capture is wanted but explicitly
   *"making it work is more important."* Tracked as a future consideration.

### Things the user explicitly said are FINE — do not touch
- **Manual staple status toggles.** The user prefers explicit control; do **not**
  add cadence-inference or auto-restock-from-history in this refactor.
- **Auto-applying purchase scans.** The user "mostly trusts it." Keep auto-removal
  (the new ask is only to *also* catch unavailability emails).

---

## 4. Goals & Non-Goals

### 4.1 Goals (this refactor)
- **G1 — Reliable cart↔Walmart handoff.** One accurate link that lands the exact
  right products and quantities; no duplicate re-adds; LifeOS reflects what
  actually made it into the cart vs. what didn't.
- **G2 — Interactive out-of-stock handling at build time.** Surface ranked
  fallbacks inline for the user to pick; optionally auto-pick the closest match
  but clearly flag it as a substitution; never silently drop an item.
- **G3 — Trustworthy product locking.** First-class, easy pinning of a *specific*
  product (and per-item default quantity) that the matcher/agents never override;
  prefer the exact last-bought product over re-guessing.
- **G4 — Smarter categorization.** Dramatically reduce mis-files to "Other" for
  routine, recurring items.
- **G5 — Catch post-order unavailability.** Detect Walmart "item unavailable /
  refunded" emails and **re-add** the affected items to the list automatically;
  do not reset a staple's purchase clock for an item that never arrived.

### 4.2 Non-Goals (explicitly out of scope for this refactor)
- **Meal planning / recipe-driven list building.** Deferred by the user. Tracked:
  GitHub issue **#23** ("add ingredients from a recipe") and **#24** ("plan a
  week of meals"). To be spec'd and built later.
- **Voice / phone capture.** Desired but secondary; tracked as a future
  consideration (see Pain Point #6), not a deliverable here.
- **Cadence-based / automatic staple restocking.** User prefers manual toggles.
- **New retailers beyond Walmart + Amazon** (Target, Kroger, Instacart, etc.).
- **Multi-user / shared lists, price-history tracking, list templates,**
  **quantity-unit normalization** — not requested.
- **Placing orders / entering payment / logging in** — permanently forbidden by
  the hard rule; the handoff ends at a pre-filled Walmart cart the user checks out
  themselves.

---

## 5. Functional Requirements

> "The system" = the Groceries feature (UI + API + ops + agents). IDs are for
> traceability into Step 2+ design and tickets.

### 5.1 Cart ↔ Walmart fidelity (G1)
- **FR-1.1** When the user builds a cart, the system shall produce a single
  Walmart add-to-cart link that, when followed, results in the **exact matched
  products at the correct per-item quantities** in the user's real Walmart cart.
- **FR-1.2** The system shall represent, per cart item, whether it has been
  pushed to the real Walmart cart (building on today's `addedQty`/`qty`), and
  shall present this clearly so the user can see **what landed vs. what didn't**.
- **FR-1.3** Rebuilding a cart, re-opening the handoff, or going back shall **not
  re-add items already in the Walmart cart** (no duplicate adds).
- **FR-1.4** The system shall make the add-to-cart → "I checked out" handoff
  resilient to interruptions (e.g. bot checks, partial adds) without losing track
  of cart contents or list state.
- **FR-1.5** Concurrent or repeated "Build Carts" actions shall not clobber an
  in-progress cart or produce conflicting `carts.json` states.
- **FR-1.6** *(Stretch / to validate with architect)* Show the user the cart's
  running total/price in LifeOS before they hand off, so there are no surprises at
  Walmart. Marked stretch because it depends on price-fetch reliability.

### 5.2 Out-of-stock at build time (G2)
- **FR-2.1** The system shall **never silently drop** an item during cart build.
  An item that cannot be added shall remain visible with a clear state
  ("out of stock" / "couldn't add").
- **FR-2.2** For an out-of-stock product, the system shall present **2–3 ranked
  fallback products inline** in the cart view for the user to pick.
- **FR-2.3** The system may **auto-pick the closest in-stock match** to keep the
  cart moving, but shall **clearly flag it as a substitution** the user can
  override.
- **FR-2.4** When the user accepts a substitute, the system **shall remember it**
  for that item for next time (persisted alongside the product mapping).

### 5.3 Product locking & reorder accuracy (G3)
- **FR-3.1** The system shall let the user **pin a specific product** to a grocery
  item quickly and unambiguously (identify the exact retailer product, not just a
  name). Pins are authoritative.
- **FR-3.2** Pinned products shall **never be overridden** by the matcher or any
  agent (preserve and strengthen today's `pinned: true` guarantee).
- **FR-3.3** When an item has prior purchase/order history for a specific product,
  the system shall **prefer that exact last-bought product** over re-guessing.
- **FR-3.4** The system shall support a **per-item default quantity** ("I always
  buy 2 of these") so reorders don't get quantity wrong.
- **FR-3.5** *(To validate)* Where a confident product isn't already pinned/known,
  the system may present a small set of candidate products (size/price) for a
  one-click confirm before/at build time.

### 5.4 Categorization (G4)
- **FR-4.1** The system shall correctly categorize routine, recurring items so
  they do **not** fall into "Other" (today's failures include milk, paper
  plates/bowls, ibuprofen, psyllium fiber).
- **FR-4.2** The user shall retain the ability to override any item's category,
  and overrides shall persist and inform future categorization of the same item.
- **FR-4.3** Category assignment shall not block the user — any categorization
  agent work shall remain async and non-blocking (as today), but with materially
  better accuracy.

### 5.5 Post-order unavailability (G5)
- **FR-5.1** The purchase-scan capability shall additionally detect Walmart
  emails indicating an ordered item was **unavailable / refunded / not fulfilled**.
- **FR-5.2** On detecting an unavailable item, the system shall **re-add that item
  to the grocery list automatically** so the user can re-buy it (elsewhere if
  needed).
- **FR-5.3** If the unavailable item is a staple, the system shall **not reset its
  `lastPurchased` clock** for the unfulfilled item (it never actually arrived).
- **FR-5.4** Auto-removal from order confirmations remains the default (user
  trusts it); the new unavailability handling must be consistent with that —
  i.e. an item refunded after a confirmed order should end up back on the list.

### 5.6 Things to preserve (regression guards)
- **FR-6.1** Manual staple `stocked|low|out` toggles and `restockAt` policy
  behavior remain unchanged.
- **FR-6.2** The instant `product-map.json` resolution path (zero web lookups for
  known items) must be preserved or improved, not regressed.
- **FR-6.3** The HARD RULE — never place orders, enter payment, or log in —
  remains absolute across every new flow.
- **FR-6.4** Existing content-file schemas remain the source of truth; any new
  fields must be additive/back-compatible with current `grocery.json`,
  `staples.json`, `product-map.json`, `purchases.json`, `carts.json`.

---

## 6. Non-Functional Requirements

- **NFR-1 — Local-first integrity.** All state continues to live in
  `src/content/grocery/` JSON; no external database. Writes remain atomic/safe
  against mid-write reads (a known concern elsewhere in the repo).
- **NFR-2 — Desktop-first UX.** Optimize the build/shop experience for desktop
  (the primary surface). Do not regress on phone, but phone/voice capture is not a
  deliverable here.
- **NFR-3 — Responsiveness.** Instant-resolvable cart builds (all items known)
  should feel immediate; agent-backed builds should show live progress (today's
  stream-json feed) and stay within a sensible time budget.
- **NFR-4 — Transparency over silent mutation.** Any automatic list change
  (scan removal, unavailability re-add, substitution) must be **visible and
  reviewable/undoable** — the user tolerates automation only when they can see
  what changed.
- **NFR-5 — Agent safety.** Agents remain read-only against Gmail/web for data;
  the only writes are to LifeOS content files; the no-purchase rule is enforced.
- **NFR-6 — Back-compatibility.** Migrations of existing JSON must be additive and
  not lose current staples, pins, or history.
- **NFR-7 — Testability.** Changes must be covered by the existing suites:
  `npm test` (Vitest) and `npm run test:e2e` (Playwright against a sandboxed copy
  of `src/content/`, agents shimmed). Structural changes require `npm run build`.

---

## 7. Success Criteria

The refactor is successful when the user can say *"I no longer finish the order by
hand."* Concretely:

- **SC-1 (G1):** Building a Walmart cart yields one link that lands the exact right
  products and quantities; the user can see in LifeOS which items made it into the
  cart and which didn't; rebuilding/returning never double-adds. *Measured by a
  clean end-to-end run with zero manual product searches and zero duplicate adds.*
- **SC-2 (G2):** No item is ever silently dropped at build time. Every out-of-stock
  product surfaces ranked fallbacks (or a clearly-flagged auto-substitution) that
  the user can act on in-place; accepted substitutes are remembered.
- **SC-3 (G3):** For items the user has pinned or bought before, the cart uses the
  exact intended product and quantity with no re-guessing; pins are never
  overridden.
- **SC-4 (G4):** Routine recurring items (milk, paper plates/bowls, ibuprofen,
  psyllium fiber, and similar) categorize correctly instead of landing in "Other";
  user overrides stick.
- **SC-5 (G5):** When Walmart reports an item unavailable/refunded, it reappears on
  the grocery list automatically, and an unfulfilled staple does not get a false
  `lastPurchased` update.
- **SC-6 (preserve):** Manual staple toggles, instant product-map resolution, the
  no-purchase hard rule, and existing JSON schemas all continue to work; both test
  suites pass.

---

## 8. Open Questions for the Architect (Step 2)

These surfaced during discovery and are design decisions, not requirements:

1. **Walmart "what landed" fidelity (FR-1.2/1.3):** Given we can't read the user's
   real Walmart cart server-side, how do we reliably reconcile LifeOS's view with
   the actual cart — richer add-to-cart link semantics, a return-confirmation step,
   or a manual reconcile? What's the most robust mechanism inside the hard rule?
2. **Out-of-stock detection at build time (FR-2.x):** How does the `build-carts`
   agent reliably determine stock status and source 2–3 fallbacks (web fetch
   reliability, Walmart page parsing brittleness noted in current code)?
3. **Substitution memory (FR-2.4) & product locking (FR-3.x):** Where do
   substitutions, pins, and per-item default quantities live — extend
   `product-map.json` / item schema, and how do we avoid the near-duplicate-key
   accretion seen today?
4. **Categorization approach (FR-4.x):** Heuristic upgrade vs. learned overrides
   vs. agent — what hits the accuracy bar without reintroducing blocking latency?
5. **Unavailability email parsing (FR-5.x):** What Walmart email signatures denote
   "unavailable/refunded," and how do we tie a refund back to the original
   `orderId`/item to re-add precisely the right thing?
6. **Stretch — live cart total (FR-1.6):** Is reliable price-fetch feasible within
   the time budget, or should this be deferred?

---

## 9. Appendix — Discovery Provenance

- **Code investigation:** Full read of `src/features/grocery/*`,
  `src/pages/api/grocery/*`, `src/components/grocery/GroceryApp.tsx`,
  `src/content/grocery/*`, and the three grocery agent skills.
- **User interview:** 12 structured questions across 3 rounds (worst pain, cart
  flow, categories, device, cart-sync dream-state, product locking, staples,
  scan trust, out-of-stock behavior, unavailability emails, recipes/meals scope,
  in-scope must-haves). Answers are reflected verbatim-in-spirit in Sections 3–4.
- **Deferred features filed:** GitHub issues **#23** (recipe → ingredients) and
  **#24** (weekly meal plan → shopping list).
