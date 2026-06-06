import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { spawnGroceryJob } from '@/features/grocery/jobs';

export const POST: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const status = await spawnGroceryJob('purchase-scan');
  return new Response(JSON.stringify({ status }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};
