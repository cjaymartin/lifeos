// Shared HTTP helpers for the task-mutation routes (PATCH/DELETE/complete/reopen).
//
// NIM-8: a mutation against an id that isn't in the local mirror is a *client*
// error (404), not an upstream fault (502). Checking the mirror first also skips
// a pointless round-trip to the provider for an id it would only reject anyway.

import { getCompleted, getSnapshot } from './store';
import { ProviderError } from './provider';

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * True when `id` is known to the local mirror — either as an active task or in
 * the completed-task log (so reopen/delete of a completed task is not falsely
 * 404'd). The mirror is the same set of ids the UI can surface, so an id absent
 * from both is genuinely unknown.
 */
export async function taskInMirror(id: string): Promise<boolean> {
  const [snapshot, completed] = await Promise.all([getSnapshot(), getCompleted()]);
  return snapshot.tasks.some((t) => t.id === id) || completed.some((c) => c.id === id);
}

/**
 * Map a provider write failure to an HTTP status. A provider *client* error
 * (4xx — e.g. a 404 for an id deleted upstream in the gap between sync and
 * write) is surfaced as-is; everything else is a genuine upstream fault → 502.
 */
export function upstreamErrorStatus(err: unknown): number {
  if (err instanceof ProviderError && err.status && err.status >= 400 && err.status < 500) {
    return err.status;
  }
  return 502;
}
