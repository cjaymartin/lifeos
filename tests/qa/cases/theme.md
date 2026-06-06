# QA cases — theme & visual hygiene

Automated by `tests/qa/scripts/theme.qa.mjs`. Restores dark mode when done.

### THEME-1 — theme toggle switches and persists across pages
Steps: toggle Light mode on `/`; navigate to `/tasks`.
Expected: `.light` on `<html>` survives navigation (localStorage).
Last pass: 2026-06-06 · Status: pass

### THEME-2 — light mode: no hydration/page errors across pages
Steps: sweep `/tasks`, `/grocery`, `/deliveries`, `/recipes` in light mode.
Expected: zero errors. KNOWN FAIL: Sidebar seeds `useState` from localStorage, so SSR (dark) mismatches the client (light) → React #418 on every page load in light mode — issue filed (#4).
Last pass: never · Status: FAIL

### THEME-3 — toggle back to dark restores cleanly
Expected: `.dark` back on `<html>`.
Last pass: 2026-06-06 · Status: pass

### THEME-M1 — visual review of screenshots
Steps: review `tests/qa/.artifacts/` and shot scripts' output for both themes.
Expected: no layout breakage, contrast issues, or unstyled regions.
Last pass: 2026-06-06 · Status: manual
