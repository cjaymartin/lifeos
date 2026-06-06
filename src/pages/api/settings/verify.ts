import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { spawnVerify } from '@/features/settings/ops/verify-runner';
import type { AccountId } from '@/features/settings/ops/settings-types';

export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const { accountId } = (await request.json().catch(() => ({}))) as { accountId?: AccountId };
  if (!accountId) return new Response('accountId required', { status: 400 });

  const status = await spawnVerify(accountId);
  if (status === 'unknown') return new Response('Unknown account', { status: 404 });

  return new Response(JSON.stringify({ status }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
};
