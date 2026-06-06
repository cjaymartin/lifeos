import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { spawnPopulateDaily } from '@/features/daily/jobs';

export const POST: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const status = await spawnPopulateDaily();
  return new Response(JSON.stringify({ status }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};
