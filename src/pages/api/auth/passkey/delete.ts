import type { APIRoute } from 'astro';
import { deleteCredential } from '@/lib/webauthn';
import { verifySession } from '@/lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? '')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const { id } = await request.json().catch(() => ({ id: '' }));
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });
  await deleteCredential(id);
  return new Response(JSON.stringify({ ok: true }));
};
