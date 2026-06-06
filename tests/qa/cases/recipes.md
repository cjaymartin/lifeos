# QA cases — recipes stack

Automated by `tests/qa/scripts/recipes.qa.mjs`.

### REC-1 — lists every saved recipe
Steps: load `/recipes`; cross-check titles from each content .md frontmatter.
Expected: every recipe card renders.
Last pass: 2026-06-06 · Status: pass

### REC-2 — search filters the list
Steps: type "chocolate" in search.
Expected: matching card visible, non-matching hidden (display:none).
Last pass: 2026-06-06 · Status: pass

### REC-3 — every recipe detail page renders
Steps: visit `/recipes/<slug>` for each content file.
Expected: detail page with h1; no redirect.
Last pass: 2026-06-06 · Status: pass

### REC-4 — missing slug redirects back to /recipes
Steps: visit a nonexistent slug.
Expected: land on `/recipes`.
Last pass: 2026-06-06 · Status: pass

### REC-5 — recipe chat surfaces shimmed-agent failure gracefully
Steps: send a chat message (agent is the shim).
Expected: no console errors; no infinite spinner.
Last pass: 2026-06-06 · Status: pass

### REC-6 — no console errors across recipes pages
Expected: zero.
Last pass: 2026-06-06 · Status: pass

### REC-M1 — recipe chat saves a real recipe (live agent)
Steps: manual, on the live instance — paste a recipe URL/text into recipe chat.
Expected: clean markdown file created under src/content/recipes/.
Last pass: never · Status: manual
