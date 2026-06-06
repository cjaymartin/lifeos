# QA cases — tasks stack

Automated by `tests/qa/scripts/tasks.qa.mjs`.

> **Mutations are NOT exercised.** The local build bakes the real
> `TODOIST_API_TOKEN` via `import.meta.env`, so add/complete/edit/delete from
> the sandbox would write to the real Todoist account. See the e2e-isolation
> issue (#6). Until that's fixed, mutation coverage is manual-only.

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

### TASK-M1 — quick-add creates a task (real Todoist)
Steps: manual, on the live instance — add a task via quick-add.
Expected: appears in Todoist and in the mirror after sync.
Last pass: never · Status: manual

### TASK-M2 — complete / reopen / edit / delete round-trip (real Todoist)
Steps: manual, on the live instance.
Expected: mutations propagate to Todoist and back through sync.
Last pass: never · Status: manual
