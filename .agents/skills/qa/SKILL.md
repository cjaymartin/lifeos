---
name: qa
description: Run the LifeOS QA suite (tests/qa) against the sandboxed test server, triage failures against the documented cases, and stamp last-pass dates. Use when the user says "/qa", "run QA", "QA the app", "regression sweep", or before a release/merge.
---

# QA sweep

Run the persistent QA suite in `tests/qa/` — 11 areas, ~78 Playwright checks
against the **sandboxed test server** (copy of `src/content/`, `claude`
shimmed, real data untouched). The suite is the source of truth for what's
been tested and when: every case in `tests/qa/cases/*.md` carries a
`Last pass: <date> · Status:` line that the runner maintains.

## Step 1 — Run

```bash
node tests/qa/run.mjs            # full: build + all areas (~3 min)
node tests/qa/run.mjs --skip-build          # dist/ is already current
node tests/qa/run.mjs --area grocery,tasks  # targeted re-run
```

Requirements: `.env` with `SESSION_SECRET` (the runner mints the session
cookie through the auth module — no bypass), port 4499 free (`QA_PORT`
overrides). The runner stamps `cases/*.md` and rewrites `tests/qa/RESULTS.md`;
exit code ≠ 0 means failures.

## Step 2 — Triage failures

Read `tests/qa/RESULTS.md`, then for each FAIL:

1. **Known-fail?** The case in `tests/qa/cases/<area>.md` says `KNOWN FAIL …
   issue #N`. Expected — verify the issue is still open (`gh issue view N`);
   if it was closed, the regression is news: reopen or file a fresh issue.
   Current known-fails: `API-3` (#5), `THEME-2` (#4).
2. **New failure?** Reproduce with `--skip-build --area <area>`, look at the
   failure screenshot in `tests/qa/.artifacts/`, and decide: app bug → file a
   GitHub issue (label `bug`+`qa`+`needs-triage`, reference the case ID, add a
   `KNOWN FAIL … issue #N` note to the case) — or harness drift (selector/
   data) → fix the script in `tests/qa/scripts/` so it tests the same intent.
3. **Never delete a failing check to go green.** Known-fails stay red on
   purpose until their issue closes.

## Step 3 — Report

Summarize per-area pass counts, list failures with their disposition
(known #N / new issue #N / harness-fixed), and note any console errors the
areas surfaced even on passing checks (they're in
`tests/qa/.artifacts/results-<area>.json`).

## Extending the suite

New feature or flow → add checks to the area script (or a new
`scripts/<area>.qa.mjs` — the runner picks it up if listed in its ORDER) and
mirror them as cases in `cases/<area>.md` with `Last pass: never · Status:
untested`. Keep IDs stable (`AREA-N`); manual-only flows get `-M*` suffixes
and `Status: manual`. Conventions live in `tests/qa/README.md`.

## Hard limits

- **Never automate task mutations** until issue #6 (baked-secret isolation)
  is fixed — the local sandbox can reach real Todoist.
- **Never trigger `relogin`** (`SET-M1`) — it opens a real headed browser
  against a retailer.
- Manual cases (`*-M*`) are performed on the live instance by a human; update
  their `Last pass:` line by hand when done.
