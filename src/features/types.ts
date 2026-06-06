// ── The Feature concept ──────────────────────────────────────────────────────
//
// A Feature is LifeOS's unit of composition: one folder under src/features/
// bundling everything a capability owns:
//
//   src/features/<id>/
//     feature.ts    — the manifest (this shape)
//     ops.ts|ops/   — server operations (content store access, domain logic)
//     jobs.ts       — agent-job definitions (claude skills the feature runs)
//     client.ts     — typed browser client for the feature's API routes
//     widgets/      — dashboard widget render adapters (.astro)
//     chat.md       — guidance for the feature's chat assistant
//
// Everything is optional except the id: a feature can be widgets-only
// (daily), stack-only, or anything between. Shared deep modules (agent-job
// runner, job-watch, stack-client, auth, content-store) stay in src/lib/.

import type { AgentJob } from '@/lib/jobs/runner';

/** A stack: the feature's sidebar entry + page + chat mount. */
export interface FeatureStack {
  label: string;
  /** lucide icon name rendered by the Sidebar */
  icon: string;
  href: string;
  description?: string;
  /** Show a card in the dashboard's Stacks strip. */
  dashboardWidget?: boolean;
  /** Tools the stack's chat assistant may use beyond CHAT_BASE_TOOLS. */
  chatTools?: string[];
}

export interface Feature {
  id: string;
  /** Sidebar + chat config — omit for widgets-only features. */
  stack?: FeatureStack;
  /** Agent jobs the feature owns, by job name. */
  jobs?: Record<string, AgentJob>;
  /** True when src/features/<id>/chat.md exists to guide the chat. */
  hasChatGuide?: boolean;
}
