import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { assembleCarts } from '@/lib/grocery';
import { spawnGroceryJob } from '@/lib/grocery-runner';

/**
 * POST /api/grocery/build-carts — optional { itemIds: string[] } limits the
 * build to a selection. Assembly logic lives in the grocery store
 * (assembleCarts); this route only parses the request and wakes the agent
 * when items couldn't be resolved instantly.
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

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
