import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getAccount } from '@/lib/settings/accounts';
import { setAccountSecrets } from '@/lib/settings/secrets';
import type { AccountId } from '@/lib/settings/settings-types';

/** Save (or clear) retailer credentials for tier-1 auto re-login. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const { accountId, username, password } = (await request.json().catch(() => ({}))) as {
    accountId?: AccountId;
    username?: string;
    password?: string;
  };
  const account = accountId && getAccount(accountId);
  if (!account || account.kind !== 'browser-session')
    return new Response('Not a browser-session account', { status: 400 });
  if (!username?.trim() || !password)
    return new Response('username and password required', { status: 400 });

  try {
    setAccountSecrets(account.id, { username: username.trim(), password });
  } catch (err) {
    return new Response(JSON.stringify({ saved: false, detail: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ saved: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const { accountId } = (await request.json().catch(() => ({}))) as { accountId?: AccountId };
  const account = accountId && getAccount(accountId);
  if (!account) return new Response('Unknown account', { status: 404 });

  try {
    setAccountSecrets(account.id, { username: undefined, password: undefined });
  } catch (err) {
    return new Response((err as Error).message, { status: 500 });
  }
  return new Response(JSON.stringify({ cleared: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
