import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getSnapshot } from '@/lib/tasks/store';
import { ensureSyncLoop, getSyncStatus, syncNow } from '@/lib/tasks/sync-loop';

/** POST /api/tasks/sync — force an immediate sync pass */
export const POST: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  ensureSyncLoop();
  await syncNow();
  const snapshot = await getSnapshot();
  return new Response(
    JSON.stringify({ ok: true, version: snapshot.version, sync: getSyncStatus() }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
