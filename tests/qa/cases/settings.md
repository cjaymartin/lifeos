# QA cases — settings stack

Automated by `tests/qa/scripts/settings.qa.mjs`.

> `relogin` launches a real headed Chrome against the retailer site —
> manual-only, never triggered by automation.

### SET-1 — /settings redirects to the logins tab
Expected: `/settings` → `/settings/logins`, Settings h1.
Last pass: 2026-06-06 · Status: pass

### SET-2 — account cards render with status from status.json
Steps: load `/settings/logins`.
Expected: walmart/amazon/todoist cards; failed accounts show a failure cue.
Last pass: 2026-06-06 · Status: pass

### SET-3 — verify trigger accepts and resolves (shimmed probe)
Steps: POST `/api/settings/verify {accountId}`; wait.
Expected: 200/202; status.json not stuck in a running state.
Last pass: 2026-06-06 · Status: pass

### SET-4 — invalid todoist token is rejected with 422
Steps: POST `/api/settings/token` with a junk token.
Expected: 422; stored secret untouched.
Last pass: 2026-06-06 · Status: pass

### SET-5 — cookie import endpoint validates its payload
Steps: POST without a cookies array.
Expected: 4xx, never 5xx.
Last pass: 2026-06-06 · Status: pass

### SET-6 — credentials endpoint stores and deletes secrets
Steps: POST then DELETE credentials for a browser-session account.
Expected: 2xx; secrets encrypted into the sandbox store.
Last pass: 2026-06-06 · Status: pass

### SET-7 — no console errors on settings page
Expected: zero.
Last pass: 2026-06-06 · Status: pass

### SET-M1 — relogin opens a real retailer session
Steps: manual, on the live instance — Relogin on walmart/amazon, complete the sign-in.
Expected: persistent profile saved; status flips to ok after verify.
Last pass: never · Status: manual

### SET-M2 — verify against real providers
Steps: manual, on the live instance — Verify each account.
Expected: probes run real MCP/browser checks; status.json reflects reality.
Last pass: never · Status: manual
