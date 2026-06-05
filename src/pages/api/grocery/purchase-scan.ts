import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { spawnGroceryJob } from '@/lib/grocery-runner';

export const POST: APIRoute = async ({ cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  const status = await spawnGroceryJob('purchase-scan');
  return new Response(JSON.stringify({ status }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};
