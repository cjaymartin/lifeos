import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import type { DueSpec, TaskPatch } from '@/features/tasks/ops/provider';
import { getSnapshot } from '@/features/tasks/ops/store';
import { getProvider, syncNow } from '@/features/tasks/ops/sync-loop';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * PATCH /api/tasks/:id — update fields and/or move.
 * Body: TaskPatch fields, plus optional { dueString | dueDate | clearDue } sugar
 * and { projectId | sectionId | parentId } for moves.
 *
 * Rescheduling with dueDate preserves a recurring task's recurrence pattern
 * by carrying the existing natural-language string along.
 */
export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;
  const provider = getProvider();
  if (!provider) return json({ error: 'No task provider configured — set TODOIST_API_TOKEN' }, 503);

  const id = params.id!;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);

  try {
    const patch: TaskPatch = {};
    if (typeof body.content === 'string') patch.content = body.content;
    if (typeof body.description === 'string') patch.description = body.description;
    if ([1, 2, 3, 4].includes(body.priority)) patch.priority = body.priority;
    if (Array.isArray(body.labels)) patch.labels = body.labels;
    if (body.deadline !== undefined) patch.deadline = body.deadline;
    if (body.duration !== undefined) patch.duration = body.duration;

    // Due-date sugar
    if (body.clearDue) {
      patch.due = null;
    } else if (typeof body.dueString === 'string') {
      patch.due = { string: body.dueString };
    } else if (typeof body.dueDate === 'string') {
      const snapshot = await getSnapshot();
      const task = snapshot.tasks.find((t) => t.id === id);
      const due: DueSpec = { date: body.dueDate };
      if (task?.due?.recurring && task.due.string) due.string = task.due.string;
      patch.due = due;
    } else if (body.due !== undefined) {
      patch.due = body.due;
    }

    if (Object.keys(patch).length > 0) await provider.updateTask(id, patch);

    if (body.projectId || body.sectionId || body.parentId) {
      await provider.moveTask(id, {
        projectId: body.projectId,
        sectionId: body.sectionId,
        parentId: body.parentId,
      });
    }

    await syncNow();
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'update failed' }, 502);
  }
};

/** DELETE /api/tasks/:id */
export const DELETE: APIRoute = async ({ cookies, params }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;
  const provider = getProvider();
  if (!provider) return json({ error: 'No task provider configured — set TODOIST_API_TOKEN' }, 503);

  try {
    await provider.deleteTask(params.id!);
    await syncNow();
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'delete failed' }, 502);
  }
};
