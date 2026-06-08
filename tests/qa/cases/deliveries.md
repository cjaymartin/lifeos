# QA cases — deliveries stack

Automated by `tests/qa/scripts/deliveries.qa.mjs`.

### DEL-1 — renders deliveries from deliveries.json
Steps: load `/deliveries`.
Expected: h1 + first vendor visible.
Last pass: 2026-06-06 · Status: pass

### DEL-2 — dismiss and restore round-trips through dismissed.json
Steps: dismiss a visible delivery, expand Dismissed, restore it; poll the file (the store's write is now atomic — temp + rename, NIM-6 / issue #7; the poll keeps mid-write tolerance as belt-and-suspenders).
Expected: dismissed.json count goes +1 then back.
Last pass: 2026-06-06 · Status: pass

### DEL-3 — refresh trigger handles the shimmed agent without crashing
Steps: click Refresh; wait one job-watch cycle.
Expected: no console errors.
Last pass: 2026-06-06 · Status: pass

### DEL-4 — dashboard deliveries widget shows live deliveries
Steps: load `/`; cross-check undismissed deliveries.
Expected: first vendor visible in the card.
Last pass: 2026-06-06 · Status: pass

### DEL-5 — no console errors across deliveries flows
Expected: zero.
Last pass: 2026-06-06 · Status: pass

### DEL-M1 — real deliveries refresh (live Gmail agent)
Steps: manual, on the live instance — Refresh and let /populate-deliveries run.
Expected: deliveries.json rewritten from Gmail; UI updates.
Last pass: never · Status: manual
