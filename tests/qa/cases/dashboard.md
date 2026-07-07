# QA cases — dashboard

Automated by `tests/qa/scripts/dashboard.qa.mjs`.

### DASH-1 — renders title, greeting, and refresh button
Steps: load `/`.
Expected: title `Dashboard — LifeOS`, non-empty greeting h1, Refresh button.
Last pass: 2026-06-06 · Status: pass

### DASH-2 — sidebar links to every stack and settings
Steps: load `/`; check anchors for `/tasks`, `/deliveries`, `/recipes`, `/grocery`, `/settings/logins`.
Expected: all present.
Last pass: 2026-06-06 · Status: pass

### DASH-3 — sidebar navigation actually navigates
Steps: click each stack link from `/`.
Expected: URL and page title change accordingly.
Last pass: 2026-06-06 · Status: pass

### DASH-4 — enabled has-data widgets render their data
Steps: cross-check `widgets/registry.json` + the `daily/today.md` vault note against the rendered cards (weather condition, briefing text, tasks widget).
Expected: enabled widgets with data render it.
Last pass: 2026-06-06 · Status: pass

### DASH-5 — conditional widgets respect displayCondition
Steps: calendar (has-events) absent when today.md has no events; deliveries card present when undismissed deliveries exist.
Expected: conditions honored.
Last pass: 2026-06-06 · Status: pass

### DASH-6 — no console or page errors on dashboard load
Steps: load `/`, settle 2s (networkidle never fires — tasks SSE stays open).
Expected: zero console/page errors.
Last pass: 2026-06-06 · Status: pass

### DASH-7 — refresh button walks the shimmed job to Failed
Steps: click Refresh; the claude shim exits without rewriting today.json.
Expected: Refreshing… → Failed (job-watch "exited but file unchanged" rule).
Last pass: 2026-06-06 · Status: pass

### DASH-8 — mobile viewport: dashboard usable at 390px
Steps: 390×844 viewport, load `/`.
Expected: greeting renders, no horizontal overflow.
Last pass: 2026-06-06 · Status: pass

### DASH-M1 — Stacks strip renders feature widgets
Steps: manual/design — no feature sets `dashboardWidget: true`, so the strip never renders anything today.
Expected: decide — wire features into the strip or remove the dead path. See issue #11.
Last pass: never · Status: manual
