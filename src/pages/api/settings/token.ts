import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getAccount } from '@/features/settings/ops/accounts';
import { setAccountSecrets } from '@/features/settings/ops/secrets';
import { setAccountStatus } from '@/features/settings/ops/status';
import { verifyTodoistToken } from '@/features/settings/ops/verify-runner';
import type { AccountId } from '@/features/settings/ops/settings-types';

/** Verify-then-save an API token. Rejects tokens that fail live verification. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const { accountId, token } = (await request.json().catch(() => ({}))) as {
    accountId?: AccountId;
    token?: string;
  };
  const account = accountId && getAccount(accountId);
  if (!account || account.kind !== 'api-token')
    return new Response('Not an api-token account', { status: 400 });
  if (!token?.trim()) return new Response('token required', { status: 400 });

  const { ok, detail } = await verifyTodoistToken(token.trim());
  if (!ok) {
    return new Response(JSON.stringify({ saved: false, detail }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    setAccountSecrets(account.id, { token: token.trim() });
  } catch (err) {
    return new Response(JSON.stringify({ saved: false, detail: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const status = await setAccountStatus(account.id, 'ok', detail);

  return new Response(JSON.stringify({ saved: true, detail, status }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
