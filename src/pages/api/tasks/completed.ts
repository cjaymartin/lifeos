import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { getCompleted } from '@/lib/tasks/store';

/** GET /api/tasks/completed — completed-task history from the local log (newest first) */
export const GET: APIRoute = async ({ cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  const completed = await getCompleted();
  return new Response(JSON.stringify({ completed }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
