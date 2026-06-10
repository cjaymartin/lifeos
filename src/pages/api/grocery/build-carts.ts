import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { assembleCarts } from '@/features/grocery/ops';
import { spawnGroceryJob, isJobRunning } from '@/features/grocery/jobs';

/**
 * POST /api/grocery/build-carts — optional { itemIds: string[] } limits the
 * build to a selection. Assembly logic lives in the grocery store
 * (assembleCarts); this route only parses the request and wakes the agent
 * when items couldn't be resolved instantly.
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  // A build agent already running → don't reassemble or spawn a second one
  // (concurrent clicks would rewrite cart-request.json mid-run and clobber).
  if (await isJobRunning('build-carts')) {
    return new Response(JSON.stringify({ status: 'running', instant: 0, queued: 0 }), {
      status: 202, headers: { 'Content-Type': 'application/json' },
    });
  }

  let itemIds: string[] | undefined;
  try {
    const body = await request.json() as { itemIds?: string[] };
    if (Array.isArray(body.itemIds) && body.itemIds.length > 0) itemIds = body.itemIds.map(String);
  } catch {} // empty body → full build

  const { instant, queued } = await assembleCarts(itemIds);

  const status = queued > 0 ? await spawnGroceryJob('build-carts') : 'done';

  return new Response(JSON.stringify({ status, instant, queued }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};
