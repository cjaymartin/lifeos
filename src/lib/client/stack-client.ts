// ── Stack client transport ───────────────────────────────────────────────────
//
// The one place the client knows how to talk to LifeOS API routes:
//   - mutations ALWAYS send a JSON content-type with a body to match. Astro's
//     CSRF protection rejects bodyless/no-content-type mutations behind a
//     TLS-terminating proxy, where the forwarded origin appears to mismatch.
//     (Discovered once in useTasks; now every stack inherits the fix.)
//   - failures throw the server-supplied error message when there is one
//   - responses parse to JSON (null when there's no body)
//
// makeOptimistic packages the apply-locally → call → refetch-on-failure cycle
// so every stack gets the rollback safety tasks already had.

export interface ApiCallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function apiCall<T = unknown>(url: string, opts: ApiCallOptions = {}): Promise<T | null> {
  const method = opts.method ?? 'GET';
  const init: RequestInit =
    method === 'GET'
      ? {}
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : '{}',
        };

  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json().catch(() => null) as Promise<T | null>;
}

/* ── Optimistic mutation cycle ──────────────────────────────────────────── */

export type OptimisticMutate<S> = (
  local: (s: S) => S,
  remote?: () => Promise<unknown>,
  opts?: {
    /** When to resync from the server: 'on-failure' (default — rollback only)
     *  or 'always' (server-side ripple effects need picking up). */
    sync?: 'on-failure' | 'always';
  },
) => Promise<void>;

export function makeOptimistic<S>(cfg: {
  /** State applier — pass your setState wrapped to ignore null state. */
  apply: (updater: (s: S) => S) => void;
  /** Resync from server truth — doubles as the rollback mechanism. */
  refetch: () => Promise<unknown>;
  onError?: (message: string) => void;
}): OptimisticMutate<S> {
  return async (local, remote, opts = {}) => {
    cfg.apply(local);
    if (!remote) return;
    try {
      await remote();
      if (opts.sync === 'always') await cfg.refetch();
    } catch (e) {
      cfg.onError?.(e instanceof Error ? e.message : 'request failed');
      await cfg.refetch(); // roll back optimistic state to server truth
    }
  };
}
