import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getCompleted } from '@/features/tasks/ops/store';

/** GET /api/tasks/completed — completed-task history from the local log (newest first) */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const completed = await getCompleted();
  return new Response(JSON.stringify({ completed }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
