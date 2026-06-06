# LifeOS QA suite

Exhaustive, repeatable QA against the **sandboxed test server** (the same
harness the e2e suite uses): a built app served from a copy of `src/content/`,
with the `claude` binary shimmed so no agent ever really spawns. Real data is
never touched; real providers are never *intentionally* reached (see the
isolation caveat below).

## Running

```bash
node tests/qa/run.mjs                 # build + full sweep (~3 min)
node tests/qa/run.mjs --skip-build    # reuse the existing dist/
node tests/qa/run.mjs --area grocery,tasks
```

The runner starts/stops the server itself (port `QA_PORT`, default 4499),
executes every `tests/qa/scripts/*.qa.mjs`, stamps **Last pass** dates into
`tests/qa/cases/*.md` for passing checks, and rewrites `tests/qa/RESULTS.md`.
Exit code is non-zero when anything fails. Or use the `/qa` skill.

## Layout

- `cases/<area>.md` — human-readable test cases. Each automated case carries a
  `Last pass: <date> · Status: pass|FAIL` line maintained by the runner;
  `Status: manual` cases (suffix `-M*`) are live-instance-only and updated by
  hand when performed.
- `scripts/<area>.qa.mjs` — the Playwright automation for that area.
- `scripts/qa-lib.mjs` — shared harness (session cookie, console-error
  capture, screenshots on failure, API helper with CSRF-correct Origin).
- `run.mjs` — orchestrator.
- `.artifacts/` — per-area JSON results + failure screenshots (gitignored).
- `RESULTS.md` — last run's summary.

## Known constraints

- **Builds bake `.env` secrets** (`import.meta.env`), so a locally-built test
  server can still reach real Todoist despite `test-server.mjs`'s env scrub.
  Task mutations are therefore excluded from automation (manual cases
  `TASK-M1/M2`). Tracked in issue #6.
- **`relogin` is never automated** — it opens a real headed Chrome against the
  retailer (`SET-M1`).
- The sandbox is rebuilt when the server starts, so area scripts within one
  run share state; scripts are written to tolerate that (self-seeding where
  it matters).

## History

- **2026-06-06** — initial exhaustive sweep (Claude): 78 automated checks
  across 11 areas, 76 passing, 2 known-fails kept red on purpose (`API-3`
  tasks-502, `THEME-2` light-mode hydration) until their issues close.
