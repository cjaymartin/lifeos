import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiCall, makeOptimistic } from '@/lib/client/stack-client';
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
  // Transport (CSRF body rule, error extraction) lives in the stack client.

  const mutate = useMemo(
    () =>
      makeOptimistic<TasksData>({
        apply: (updater) => setData((d) => (d ? updater(d) : d)),
        refetch,
        onError: setError,
      }),
    [refetch],
  );

  const completeTask = useCallback(
    (id: string) =>
      mutate(
        (d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }),
        () => apiCall(`/api/tasks/${id}/complete`, { method: 'POST' }),
      ),
    [mutate],
  );

  const reopenTask = useCallback(
    (id: string) => mutate((d) => d, () => apiCall(`/api/tasks/${id}/reopen`, { method: 'POST' })),
    [mutate],
  );

  const deleteTask = useCallback(
    (id: string) =>
      mutate(
        (d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id && t.parentId !== id) }),
        () => apiCall(`/api/tasks/${id}`, { method: 'DELETE' }),
      ),
    [mutate],
  );

  const updateTask = useCallback(
    (id: string, body: Record<string, unknown>) =>
      // Optimistically apply the simple fields we can mirror locally
      mutate(
        (d) => ({
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
        }),
        () => apiCall(`/api/tasks/${id}`, { method: 'PATCH', body }),
      ),
    [mutate],
  );

  // Throws on failure — QuickAdd keeps the typed input when the add fails.
  const addTask = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        await apiCall('/api/tasks', { method: 'POST', body });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'request failed');
        void refetch();
        throw e;
      }
    },
    [refetch],
  );

  const forceSync = useCallback(
    () => mutate((d) => d, () => apiCall('/api/tasks/sync', { method: 'POST' })),
    [mutate],
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
