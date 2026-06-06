# LifeOS

A local-first personal dashboard: Astro UI, Markdown/JSON files in `src/content/` as the database, headless Claude agents as the data populators.

## Language

### Composition

**Feature**:
LifeOS's unit of composition — one folder under `src/features/<id>/` bundling everything a capability owns: an optional Stack, optional Widgets, an optional adapter (Ops + Agent Jobs + Client), and an optional Chat Guide. The registry is `src/features/index.ts`.
_Avoid_: component (taken by React), module (architecture term), unit

**Stack**:
A feature's sidebar entry, page, and chat mount — declared as the `stack` field of a feature manifest. Not every feature has one (Daily is widgets-only).
_Avoid_: section, view, app

**Widget**:
A dashboard card or full-width block. Its *config* (enabled/order/size/conditions) lives in `src/content/widgets/registry.json`; its *renderer* is a per-type adapter under `src/features/<id>/widgets/`, mapped on the dashboard. Adding a widget type = one adapter + one map entry.

**Ops**:
A feature's server operations — content-store access and domain logic (`src/features/<id>/ops.ts` or `ops/`). The only code that knows the feature's file shapes. API routes are thin seams over Ops.
_Avoid_: service, lib, helpers

**Client**:
A feature's typed browser client (`src/features/<id>/client.ts`) — the only place that knows the feature's API route URLs and payload shapes. Built on the Stack Client transport.

**Chat Guide**:
`src/features/<id>/chat.md` — extra instructions appended to the feature's chat-assistant system prompt: data schemas, cross-feature reads, hard rules (e.g. grocery's "never purchase").
_Avoid_: chatGuidance (the retired stacks.ts field)

### Agents & jobs

**Agent Job**:
A headless Claude run a feature owns: lock file + detached spawn + log dot-file, defined with `defineAgentJob` and executed by the agent-job runner (`src/lib/jobs/runner.ts`). Locks go stale after 5 minutes.
_Avoid_: runner (that's the shared module), task (taken by the Tasks feature)

**Job Watch**:
The client-side protocol for following an Agent Job: trigger → poll a status route → verdict (`src/lib/client/job-watch.ts`). Two packaged protocols: the mtime watch (file rewritten = done; agent exited without rewriting = error) and the flag watch (boolean clears = done).
_Avoid_: poll loop, refresh loop

**Captured Run**:
A request/response-style headless Claude run (chat replies, MCP probes) — `runAgentCapture`: stdout captured, optional log tee, timeout, no lock.

**Locked Task**:
An in-process async job guarded by the same lock convention as Agent Jobs (`startLockedTask`) — e.g. per-account verify/re-login in Settings.

### Data

**Content Store**:
A feature's user-facing data: `src/content/<id>/` Markdown/JSON. Dot-prefixed files are job plumbing (locks, logs, pending agent output) and are hidden from chat dumps — the rule lives in `src/lib/content-store.ts`.

**Stack Client (transport)**:
The shared client transport (`src/lib/client/stack-client.ts`): mutations always send a JSON body (Astro CSRF behind the TLS proxy rejects bodyless mutations), errors carry the server's message, and `makeOptimistic` packages apply-locally → call → refetch-on-failure (rollback).

**Product Memory**:
`src/content/grocery/product-map.json` — cached retailer productIds per normalized item name. Cart assembly resolves from it instantly; only unknown items go to the build-carts agent.
