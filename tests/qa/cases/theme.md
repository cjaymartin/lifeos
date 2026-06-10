# QA cases — theme & visual hygiene

Automated by `tests/qa/scripts/theme.qa.mjs`. Restores dark mode when done.

### THEME-1 — theme toggle switches and persists across pages
Steps: toggle Light mode on `/`; navigate to `/tasks`.
Expected: `.light` on `<html>` survives navigation (localStorage).
Last pass: 2026-06-08 · Status: pass

### THEME-2 — light mode: no hydration/page errors across pages
Steps: sweep `/tasks`, `/grocery`, `/deliveries`, `/recipes` in light mode.
Expected: zero errors. FIXED (NIM-9 / #4): Sidebar now seeds `useState('dark')` to match SSR and adopts the stored theme in a post-mount effect, so the first client render agrees with the SSR markup — no React #418. Covered by `tests/unit/sidebar-theme-hydration.test.tsx`.
Last pass: 2026-06-08 · Status: pass

### THEME-3 — toggle back to dark restores cleanly
Expected: `.dark` back on `<html>`.
Last pass: 2026-06-08 · Status: pass

### THEME-4 — collapsed sidebar stored: no hydration/page errors across pages
Steps: persist `sidebar-collapsed=true`, then sweep `/tasks`, `/grocery`, `/deliveries`, `/recipes`.
Expected: zero errors. FIXED (#20, sibling of NIM-9 / #4): Sidebar now seeds `useState(false)` (expanded, matching SSR `w-56`) and adopts the stored collapsed value in a post-mount effect, so the first client render agrees with the SSR markup — no React #418 reflow on collapsed-stored clients. Covered by `tests/unit/sidebar-collapsed-hydration.test.tsx`.
Last pass: 2026-06-08 · Status: pass

### THEME-M1 — visual review of screenshots
Steps: review `tests/qa/.artifacts/` and shot scripts' output for both themes.
Expected: no layout breakage, contrast issues, or unstyled regions.
Last pass: 2026-06-06 · Status: manual
