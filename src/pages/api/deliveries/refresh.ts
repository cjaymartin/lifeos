import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { spawnPopulateDeliveries } from '@/lib/populate-deliveries-runner';

export const POST: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const status = await spawnPopulateDeliveries();
  return new Response(JSON.stringify({ status }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};
