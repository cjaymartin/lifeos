import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { spawnRelogin } from '@/features/settings/ops/verify-runner';
import type { AccountId } from '@/features/settings/ops/settings-types';

export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const { accountId } = (await request.json().catch(() => ({}))) as { accountId?: AccountId };
  if (!accountId) return new Response('accountId required', { status: 400 });

  const status = await spawnRelogin(accountId);
  if (status === 'unknown') return new Response('Not a browser-session account', { status: 400 });

  return new Response(JSON.stringify({ status }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
};
