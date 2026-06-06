# QA cases — stack chat sidebar

Automated by `tests/qa/scripts/chat.qa.mjs`. The chat agent is the claude
shim — these verify graceful failure, not answer quality.

### CHAT-1 — chat mount is present on stack pages
Steps: load `/grocery`; find the chat toggle/input.
Expected: chat affordance exists.
Last pass: 2026-06-06 · Status: pass

### CHAT-2 — shimmed agent yields an error state, not a hang
Steps: send a message; wait 10s.
Expected: spinner resolves or an error is shown; input re-enabled.
Last pass: 2026-06-06 · Status: pass

### CHAT-3 — /api/chat rejects an unknown stack id
Steps: POST with `stackId: not-a-real-stack`.
Expected: 4xx or explicit error payload, never 5xx or silent accept.
Last pass: 2026-06-06 · Status: pass

### CHAT-4 — no page errors from the chat sidebar
Expected: zero pageerror entries.
Last pass: 2026-06-06 · Status: pass

### CHAT-M1 — two-phase write approval (live agent)
Steps: manual, on the live instance — ask grocery chat to modify the list; approve the proposal.
Expected: phase-1 proposes (no Write/Edit), approval applies the write to src/content/grocery/ only.
Last pass: never · Status: manual
