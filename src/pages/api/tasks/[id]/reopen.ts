import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getProvider, syncNow } from '@/features/tasks/ops/sync-loop';
import { json, taskInMirror, upstreamErrorStatus } from '@/features/tasks/ops/route-helpers';

/** POST /api/tasks/:id/reopen — uncomplete a task */
export const POST: APIRoute = async ({ cookies, params }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const provider = getProvider();
  if (!provider) return json({ error: 'No task provider configured' }, 503);

  const id = params.id!;
  if (!(await taskInMirror(id))) return json({ error: 'Task not found' }, 404);

  try {
    await provider.uncompleteTask(id);
    await syncNow();
    return json({ ok: true });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'reopen failed' },
      upstreamErrorStatus(err),
    );
  }
};
