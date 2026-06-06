# QA cases — cross-cutting

Automated by `tests/qa/scripts/misc.qa.mjs`.

### MISC-1 — every page has a LifeOS title
Steps: sweep all pages; check `<title>`.
Expected: all contain "LifeOS".
Last pass: 2026-06-06 · Status: pass

### MISC-2 — no horizontal overflow on any page at 390px
Steps: mobile-viewport sweep.
Expected: scrollWidth ≤ clientWidth (+2px tolerance).
Last pass: 2026-06-06 · Status: pass

### MISC-3 — no console/page errors on a full page sweep
Expected: zero.
Last pass: 2026-06-06 · Status: pass

### MISC-4 — static assets and favicon resolve
Steps: load `/`; watch non-API responses.
Expected: no 4xx/5xx assets.
Last pass: 2026-06-06 · Status: pass

### MISC-5 — every page renders a sidebar
Expected: home link present on every stack page.
Last pass: 2026-06-06 · Status: pass

### MISC-M1 — 404 page is branded
Steps: visit an unknown path while authed.
Expected: a LifeOS-styled 404 with a link home. KNOWN GAP: currently Astro's default dev-style 404 — issue #10.
Last pass: never · Status: manual
