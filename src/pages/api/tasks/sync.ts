import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { getSnapshot } from '@/lib/tasks/store';
import { ensureSyncLoop, getSyncStatus, syncNow } from '@/lib/tasks/sync-loop';

/** POST /api/tasks/sync — force an immediate sync pass */
export const POST: APIRoute = async ({ cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  ensureSyncLoop();
  await syncNow();
  const snapshot = await getSnapshot();
  return new Response(
    JSON.stringify({ ok: true, version: snapshot.version, sync: getSyncStatus() }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
