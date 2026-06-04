// Background polling loop — keeps the local mirror in near-real-time sync
// with the provider. Started lazily from middleware on the first request.
//
// Webhook-ready: when a Todoist webhook is registered later (requires an app
// in the Todoist App Console), /api/webhooks/todoist calls syncNow() on each
// delivery and this loop simply becomes the fallback.

import type { TaskProvider } from './provider';
import { ProviderError } from './provider';
import { applySync, getSnapshot, mergeCompleted } from './store';
import { getTodoistToken, TodoistProvider } from './todoist';

const POLL_MS = 30_000;
const COMPLETED_REFRESH_MS = 60 * 60 * 1000; // hourly
const COMPLETED_WINDOW_DAYS = 90; // < Todoist's 92-day per-query cap

const g = globalThis as any;
const state: {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  backoffUntil: number;
  lastCompletedRefresh: number;
  lastError: string | null;
} = (g.__lifeosTaskSync ??= {
  timer: null,
  inFlight: null,
  backoffUntil: 0,
  lastCompletedRefresh: 0,
  lastError: null,
});

export function getProvider(): TaskProvider | null {
  const token = getTodoistToken();
  return token ? new TodoistProvider(token) : null;
}

export function getSyncStatus(): { configured: boolean; polling: boolean; lastError: string | null } {
  return { configured: !!getTodoistToken(), polling: !!state.timer, lastError: state.lastError };
}

/** Run one sync pass now. Serialized — concurrent callers share the in-flight pass. */
export function syncNow(): Promise<void> {
  if (state.inFlight) return state.inFlight;
  state.inFlight = doSync().finally(() => {
    state.inFlight = null;
  });
  return state.inFlight;
}

async function doSync(): Promise<void> {
  const provider = getProvider();
  if (!provider) return;
  if (Date.now() < state.backoffUntil) return;

  try {
    const snapshot = await getSnapshot();
    const result = await provider.sync(snapshot.syncToken);
    await applySync(provider.id, result);
    state.lastError = null;

    // Periodically refresh the completed-task history (for the stack's
    // Completed view + stats). Incremental completions arrive via sync;
    // this backfills anything missed (e.g. completions while server was down).
    if (Date.now() - state.lastCompletedRefresh > COMPLETED_REFRESH_MS) {
      state.lastCompletedRefresh = Date.now();
      const until = new Date();
      const since = new Date(until.getTime() - COMPLETED_WINDOW_DAYS * 86_400_000);
      const completed = await provider.fetchCompleted(since.toISOString(), until.toISOString());
      await mergeCompleted(completed, false);
    }
  } catch (err) {
    if (err instanceof ProviderError && err.status === 429) {
      state.backoffUntil = Date.now() + (err.retryAfterSeconds ?? 60) * 1000;
    }
    state.lastError = err instanceof Error ? err.message : String(err);
    console.error('[tasks-sync]', state.lastError);
  }
}

/** Idempotent: starts the polling loop if configured and not already running. */
export function ensureSyncLoop(): void {
  if (state.timer || !getTodoistToken()) return;
  state.timer = setInterval(() => void syncNow(), POLL_MS);
  // Don't hold the process open just for polling
  (state.timer as any).unref?.();
  void syncNow();
}
