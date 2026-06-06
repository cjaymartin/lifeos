# QA cases — authentication & access control

Automated by `tests/qa/scripts/auth.qa.mjs`. Run via `node tests/qa/run.mjs --area auth`.

### AUTH-1 — unauthenticated page request redirects to /login
Steps: GET `/` with no session cookie.
Expected: 302 → `/login`.
Last pass: 2026-06-06 · Status: pass

### AUTH-2 — every stack page is gated
Steps: GET `/tasks`, `/grocery`, `/deliveries`, `/recipes`, `/settings/logins`, `/setup/passkey` anonymously.
Expected: all redirect to `/login`.
Last pass: 2026-06-06 · Status: pass

### AUTH-3 — unauthenticated API requests are rejected
Steps: GET `/api/grocery`, `/api/tasks`, `/api/settings/accounts`, `/api/refresh/status` anonymously.
Expected: 3xx redirect or 401 — never data.
Last pass: 2026-06-06 · Status: pass

### AUTH-4 — login page renders passkey and TOTP options
Steps: load `/login`.
Expected: "Sign in with passkey" button, `#totp-input`, "Verify code" button.
Last pass: 2026-06-06 · Status: pass

### AUTH-5 — wrong TOTP code is rejected without a session
Steps: fill `000000`, submit.
Expected: stay on `/login`, no `lifeos_session` cookie set.
Last pass: 2026-06-06 · Status: pass

### AUTH-6 — authed visit to /login redirects to dashboard
Steps: load `/login` with a valid session.
Expected: redirected off `/login`.
Last pass: 2026-06-06 · Status: pass

### AUTH-7 — passkey setup page renders for an authed session
Steps: load `/setup/passkey`.
Expected: passkey registration UI renders.
Last pass: 2026-06-06 · Status: pass

### AUTH-8 — todoist webhook is dormant without its secret (501)
Steps: POST junk to `/api/webhooks/todoist` (public route).
Expected: 501 — payload never applied without `TODOIST_WEBHOOK_SECRET`.
Last pass: 2026-06-06 · Status: pass

### AUTH-9 — sidebar logout form clears the session
Steps: click the sidebar Sign out form, then revisit `/tasks`.
Expected: redirected to `/login`; session cookie gone.
Last pass: 2026-06-06 · Status: pass

### AUTH-10 — API POST without Origin header is CSRF-rejected (403)
Steps: POST `/api/auth/logout` with no Origin header and no JSON body.
Expected: 403 from Astro's checkOrigin guard.
Last pass: 2026-06-06 · Status: pass

### AUTH-M1 — real passkey assertion login
Steps: manual — sign in with a registered passkey from a real device.
Expected: WebAuthn ceremony completes, session established.
Last pass: never · Status: manual

### AUTH-M2 — real TOTP login
Steps: manual — sign in with a current authenticator code.
Expected: session established, redirected to dashboard.
Last pass: never · Status: manual
