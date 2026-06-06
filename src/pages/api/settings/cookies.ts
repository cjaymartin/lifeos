import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getAccount } from '@/features/settings/ops/accounts';
import { importCookies } from '@/features/settings/ops/browser-session';
import { setAccountStatus } from '@/features/settings/ops/status';
import type { AccountId } from '@/features/settings/ops/settings-types';

/**
 * Tier-3 fallback: import pasted cookies into the retailer's persistent
 * Chrome profile, then verify the session. Synchronous on purpose — the
 * whole round trip is ~15-30s and the UI awaits the verdict.
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const { accountId, cookies: cookieJson } = (await request.json().catch(() => ({}))) as {
    accountId?: AccountId;
    cookies?: string;
  };
  const account = accountId && getAccount(accountId);
  if (!account || account.kind !== 'browser-session')
    return new Response('Not a browser-session account', { status: 400 });
  if (!cookieJson?.trim()) return new Response('cookies required', { status: 400 });

  try {
    const result = await importCookies(account, cookieJson);
    const status = await setAccountStatus(
      account.id,
      result.loggedIn ? 'ok' : result.challenged ? 'needs-attention' : 'failed',
      result.detail,
    );
    return new Response(JSON.stringify({ ...result, status }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const detail = `Cookie import error: ${(err as Error).message}`;
    await setAccountStatus(account.id, 'failed', detail);
    return new Response(JSON.stringify({ loggedIn: false, detail }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
