import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getProvider, syncNow } from '@/lib/tasks/sync-loop';

/** POST /api/tasks/:id/complete — recurring tasks advance to their next occurrence */
export const POST: APIRoute = async ({ cookies, params }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const provider = getProvider();
  if (!provider)
    return new Response(JSON.stringify({ error: 'No task provider configured' }), { status: 503 });

  try {
    await provider.completeTask(params.id!);
    await syncNow();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'complete failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
