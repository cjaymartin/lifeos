import type { APIRoute } from 'astro';
import { verifyTOTP } from '@/lib/totp';
import { setSession, getSessionSecret } from '@/lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const { token } = await request.json().catch(() => ({ token: '' }));

  if (!await verifyTOTP(token)) {
    return new Response(JSON.stringify({ error: 'Invalid code' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  setSession(cookies, getSessionSecret());
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
