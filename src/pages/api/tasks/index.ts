import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { getSnapshot } from '@/lib/tasks/store';
import { ensureSyncLoop, getProvider, getSyncStatus, syncNow } from '@/lib/tasks/sync-loop';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const authorized = (cookies: any) =>
  verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? '');

/** GET /api/tasks — the full mirror + sync status */
export const GET: APIRoute = async ({ cookies }) => {
  if (!authorized(cookies)) return new Response('Unauthorized', { status: 401 });
  ensureSyncLoop();
  const snapshot = await getSnapshot();
  return json({ ...snapshot, sync: getSyncStatus() });
};

/** POST /api/tasks — create a task. Body: TaskDraft, or { quickAdd: "text" } */
export const POST: APIRoute = async ({ cookies, request }) => {
  if (!authorized(cookies)) return new Response('Unauthorized', { status: 401 });

  const provider = getProvider();
  if (!provider) return json({ error: 'No task provider configured — set TODOIST_API_TOKEN' }, 503);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);

  try {
    if (typeof body.quickAdd === 'string' && body.quickAdd.trim()) {
      // Natural-language create; fall back to a plain create if unsupported/rejected.
      if (provider.quickAdd) {
        try {
          await provider.quickAdd(body.quickAdd.trim());
        } catch {
          await provider.createTask({ content: body.quickAdd.trim() });
        }
      } else {
        await provider.createTask({ content: body.quickAdd.trim() });
      }
      await syncNow();
      return json({ ok: true }, 201);
    }

    if (typeof body.content !== 'string' || !body.content.trim()) {
      return json({ error: 'content is required' }, 400);
    }
    const id = await provider.createTask({
      content: body.content.trim(),
      description: body.description,
      projectId: body.projectId,
      sectionId: body.sectionId,
      parentId: body.parentId,
      priority: body.priority,
      labels: body.labels,
      due: body.due,
      deadline: body.deadline,
      duration: body.duration,
    });
    await syncNow();
    return json({ ok: true, id }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'create failed' }, 502);
  }
};
