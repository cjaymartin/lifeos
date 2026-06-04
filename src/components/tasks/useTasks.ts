import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompletedTask, TasksSnapshot } from '@/lib/tasks/types';

export interface SyncStatus {
  configured: boolean;
  polling: boolean;
  lastError: string | null;
}

export interface TasksData extends TasksSnapshot {
  sync: SyncStatus;
}

/**
 * Live task data: fetches /api/tasks, subscribes to the SSE stream, refetches
 * on every change event, and exposes optimistic write actions.
 */
export function useTasks(initial?: TasksData) {
  const [data, setData] = useState<TasksData | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef<number>(initial?.version ?? -1);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as TasksData;
      versionRef.current = d.version;
      setData(d);
      setError(d.sync?.lastError ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    }
  }, []);

  useEffect(() => {
    if (!initial) void refetch();

    const es = new EventSource('/api/tasks/stream');
    const onEvent = (e: MessageEvent) => {
      try {
        const { version } = JSON.parse(e.data) as { version: number };
        if (version !== versionRef.current) void refetch();
      } catch {}
    };
    es.addEventListener('hello', onEvent);
    es.addEventListener('change', onEvent);
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Optimistic mutations ──
  // Apply locally first, hit the API, refetch on failure to resync truth.

  const mutate = useCallback(
    (apply: (d: TasksData) => TasksData) => {
      setData((d) => (d ? apply(d) : d));
    },
    [],
  );

  const call = useCallback(
    async (input: string, init: RequestInit) => {
      try {
        // Always send a JSON content-type (with a body to match): Astro's CSRF
        // protection rejects bodyless/no-content-type mutations behind a
        // TLS-terminating proxy, where the forwarded origin appears to mismatch.
        const res = await fetch(input, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
          body: init.body ?? '{}',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'request failed');
        void refetch(); // roll back optimistic state to server truth
        throw e;
      }
    },
    [refetch],
  );

  const completeTask = useCallback(
    (id: string) => {
      mutate((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
      return call(`/api/tasks/${id}/complete`, { method: 'POST' }).catch(() => {});
    },
    [mutate, call],
  );

  const reopenTask = useCallback(
    (id: string) => call(`/api/tasks/${id}/reopen`, { method: 'POST' }).catch(() => {}),
    [call],
  );

  const deleteTask = useCallback(
    (id: string) => {
      mutate((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id && t.parentId !== id) }));
      return call(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {});
    },
    [mutate, call],
  );

  const updateTask = useCallback(
    (id: string, body: Record<string, unknown>) => {
      // Optimistically apply the simple fields we can mirror locally
      mutate((d) => ({
        ...d,
        tasks: d.tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                ...(typeof body.content === 'string' ? { content: body.content } : {}),
                ...(typeof body.description === 'string' ? { description: body.description } : {}),
                ...(typeof body.priority === 'number' ? { priority: body.priority as 1 | 2 | 3 | 4 } : {}),
                ...(body.clearDue ? { due: null } : {}),
              }
            : t,
        ),
      }));
      return call(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [mutate, call],
  );

  const addTask = useCallback(
    (body: Record<string, unknown>) =>
      call('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    [call],
  );

  const forceSync = useCallback(
    () => call('/api/tasks/sync', { method: 'POST' }).catch(() => {}),
    [call],
  );

  return {
    data,
    error,
    refetch,
    completeTask,
    reopenTask,
    deleteTask,
    updateTask,
    addTask,
    forceSync,
  };
}

/** Completed history — refetched whenever the snapshot version changes */
export function useCompleted(version: number | undefined) {
  const [completed, setCompleted] = useState<CompletedTask[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/tasks/completed')
      .then((r) => (r.ok ? r.json() : { completed: [] }))
      .then((d) => alive && setCompleted(d.completed ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);
  return completed;
}
