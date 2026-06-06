# QA cases — tasks stack

Read-only cases automated by `tests/qa/scripts/tasks.qa.mjs`; mutation cases
(`TASK-M1/M2`) by `tests/qa/scripts/tasks-mutations.qa.mjs`.

> **Mutations now run against an in-memory fake provider, never real Todoist.**
> Runtime secrets are read from `process.env` only (not the baked
> `import.meta.env`), so the default sandbox shows Todoist as "Not connected"
> even on a dev machine (NIM-7). The opt-in `tasks-mutations` area sets
> `LIFEOS_FAKE_TASKS=1` to exercise add/complete/edit/delete safely:
> `node tests/qa/run.mjs --area tasks-mutations`.

### TASK-1 — page renders with view navigation and sync status
Steps: load `/tasks`.
Expected: Today/Upcoming/Completed/Stats nav, sync status line.
Last pass: 2026-06-06 · Status: pass

### TASK-2 — Today view shows overdue + due-today tasks only
Steps: compare mirror tasks.json against the rendered Today view.
Expected: due ≤ today visible; strictly-future tasks absent.
Last pass: 2026-06-06 · Status: pass

### TASK-3 — Upcoming view groups future tasks by day
Steps: switch to Upcoming.
Expected: tasks with future due dates appear.
Last pass: 2026-06-06 · Status: pass

### TASK-4 — Completed view renders the completed log
Steps: switch to Completed; cross-check completed.json.
Expected: most recent completed task visible.
Last pass: 2026-06-06 · Status: pass

### TASK-5 — Stats view renders without errors
Steps: switch to Stats.
Expected: no console errors.
Last pass: 2026-06-06 · Status: pass

### TASK-6 — project views render and counts match data
Steps: project nav lists mirror projects; click the first one.
Expected: its tasks render.
Last pass: 2026-06-06 · Status: pass

### TASK-7 — label views render used labels
Steps: click a label used by an open task.
Expected: tagged task renders.
Last pass: 2026-06-06 · Status: pass

### TASK-8 — SSE stream endpoint serves an event stream
Steps: GET `/api/tasks/stream`.
Expected: 200 / stream held open.
Last pass: 2026-06-06 · Status: pass

### TASK-9 — tasks dashboard widget shows live mirror tasks
Steps: load `/`; find a due-today task in the widget.
Expected: visible.
Last pass: 2026-06-06 · Status: pass

### TASK-10 — no console errors across tasks views
Steps: cycle all four views.
Expected: zero console errors.
Last pass: 2026-06-06 · Status: pass

### TASK-M1 — quick-add creates a task (fake provider)
Steps: POST `/api/tasks`, then load the project view. Requires the
`tasks-mutations` area (`LIFEOS_FAKE_TASKS=1`).
Expected: task persists to the sandbox mirror and renders in its project.
Last pass: 2026-06-06 · Status: pass

### TASK-M2 — complete / reopen / edit / delete round-trip (fake provider)
Steps: PATCH content+priority, complete, reopen, delete via the API; assert the
mirror after each. Requires the `tasks-mutations` area.
Expected: each mutation round-trips through the sync path into the mirror.
Last pass: 2026-06-06 · Status: pass
