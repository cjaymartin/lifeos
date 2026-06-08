# QA cases — API robustness

Automated by `tests/qa/scripts/api.qa.mjs`.

### API-1 — unknown page path returns 404
Expected: 404 status (see also MISC: the 404 page itself is the unbranded Astro default — issue #10).
Last pass: 2026-06-08 · Status: pass

### API-2 — malformed JSON bodies are 4xx, not 5xx
Steps: POST `{not json` to grocery/staples/dismiss/tasks endpoints.
Expected: 400-class responses.
Last pass: 2026-06-08 · Status: pass

### API-3 — unknown resource ids are 4xx, not 5xx
Steps: PATCH/DELETE/POST against nonexistent grocery, task, delivery ids.
Expected: 404-class. Fixed in NIM-8 (#5): the task-mutation routes (PATCH/DELETE/complete/reopen) now check the local mirror first and 404 ids it doesn't know, instead of forwarding them to the provider and mapping every error to 502. Genuine upstream failures still surface as 502.
Last pass: 2026-06-08 · Status: pass

### API-4 — empty-body POSTs to JSON endpoints are 4xx, not 5xx
Expected: 400-class.
Last pass: 2026-06-08 · Status: pass

### API-5 — grocery GET returns the full state shape
Expected: `items` + `staples` keys present.
Last pass: 2026-06-08 · Status: pass

### API-6 — job status endpoints respond with run state
Steps: GET refresh/deliveries/grocery status.
Expected: 200s.
Last pass: 2026-06-08 · Status: pass

### API-7 — tasks GET returns the mirror snapshot
Expected: `tasks` array.
Last pass: 2026-06-08 · Status: pass

### API-8 — completed tasks endpoint responds
Expected: 200.
Last pass: 2026-06-08 · Status: pass
