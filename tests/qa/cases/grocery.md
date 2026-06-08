# QA cases — grocery stack

Automated by `tests/qa/scripts/grocery.qa.mjs`. All mutations stay in the
sandbox; agent jobs hit the claude shim.

### GROC-1 — renders list, quick-add, and staples section
Steps: load `/grocery`.
Expected: Groceries h1, add-an-item input, staples section.
Last pass: 2026-06-06 · Status: pass

### GROC-2 — agent-written carts.json renders without crashing SSR
Steps: seed a cart with no `unmatched` array (the shape /build-carts wrote on 2026-06-06), load `/grocery`.
Expected: page renders the cart; no SSR crash/hang. Regression for the loadCarts normalization fix (issues #8, #9).
Last pass: 2026-06-06 · Status: pass

### GROC-3 — quick-add appends an item, categorized + persisted
Steps: type an item, Enter; poll sandbox grocery.json.
Expected: optimistic render + persisted with a heuristic category.
Last pass: 2026-06-06 · Status: pass

### GROC-4 — check-off toggles and persists
Steps: click "Check off <item>"; poll sandbox file.
Expected: `checked: true` persisted.
Last pass: 2026-06-06 · Status: pass

### GROC-5 — item DELETE removes it
Steps: DELETE `/api/grocery/items/:id`.
Expected: 2xx; item gone from grocery.json.
Last pass: 2026-06-06 · Status: pass

### GROC-6 — item PATCH edits name/category
Steps: POST an item, PATCH name+category, verify, clean up.
Expected: edits persisted.
Last pass: 2026-06-06 · Status: pass

### GROC-7 — staples CRUD round-trips
Steps: POST/PATCH/DELETE `/api/grocery/staples`.
Expected: staples.json reflects each step.
Last pass: 2026-06-06 · Status: pass

### GROC-8 — build-carts resolves product-mapped items instantly
Steps: add an item whose name is in product-map.json, click Build Carts.
Expected: cart line appears in carts.json without queueing the agent.
Last pass: 2026-06-06 · Status: pass

### GROC-9 — purchase-scan trigger handles the shimmed agent gracefully
Steps: click Scan purchases; wait one job-watch cycle.
Expected: no console errors; UI settles.
Last pass: 2026-06-06 · Status: pass

### GROC-10 — checkout clears matched items, restocks staples, drops the cart
Steps: POST `/api/grocery/checkout` for a built cart.
Expected: matched items removed, purchases.json appended, cart gone.
Last pass: 2026-06-06 · Status: pass

### GROC-11 — product-map API edits round-trip
Steps: POST `{name, url}` (walmart /ip/ URL), then DELETE.
Expected: pinned entry appears under the normalized name, then disappears.
Last pass: 2026-06-06 · Status: pass

### GROC-12 — no console errors across the grocery flows above
Expected: zero.
Last pass: 2026-06-06 · Status: pass

### GROC-13 — island SSR crash terminates with a 500, never hangs
Steps: load `/dev/ssr-crash?boom=1` (a fixture island that throws during SSR), then `/dev/ssr-crash` with no flag.
Expected: the throwing load returns HTTP 500 + the custom 500 page ("couldn't render") within the timeout — a terminated response, not the historical infinite hang (issue NIM-5); the un-flagged load renders the island fine. Relies on `experimentalDisableStreaming` (astro.config.mjs) buffering the render so the throw surfaces before headers. Runs after GROC-12 because the 500 logs a browser console error.
Last pass: 2026-06-06 · Status: pass

### GROC-M1 — real cart build end-to-end (live agent)
Steps: manual, on the live instance — build carts with unknown items.
Expected: /build-carts agent matches products; progress streams in the UI.
Last pass: never · Status: manual
