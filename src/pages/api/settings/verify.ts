import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { spawnVerify } from '@/lib/settings/verify-runner';
import type { AccountId } from '@/lib/settings/settings-types';

export const POST: APIRoute = async ({ cookies, request }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  const { accountId } = (await request.json().catch(() => ({}))) as { accountId?: AccountId };
  if (!accountId) return new Response('accountId required', { status: 400 });

  const status = await spawnVerify(accountId);
  if (status === 'unknown') return new Response('Unknown account', { status: 404 });

  return new Response(JSON.stringify({ status }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
};
