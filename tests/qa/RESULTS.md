# QA results — 2026-06-06T15:13:19.697Z

| Area | Passed | Failed | Console errors |
|---|---|---|---|
| auth | 10 | 0 | 0 |
| dashboard | 8 | 0 | 0 |
| tasks | 10 | 0 | 0 |
| grocery | 12 | 0 | 0 |
| deliveries | 5 | 0 | 0 |
| recipes | 6 | 0 | 0 |
| settings | 7 | 0 | 0 |
| chat | 4 | 0 | 0 |
| api | 7 | 1 | 1 |
| misc | 5 | 0 | 0 |
| theme | 2 | 1 | 6 |

**Total: 76 passed, 2 failed.**

- FAIL `API-3` unknown resource ids are 4xx, not 5xx — PATCH /api/tasks/does-not-exist → 502
- FAIL `THEME-2` light mode: no hydration/page errors across pages — 5 errors, first: pageerror: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use
