import type { APIRoute } from 'astro';
import { deleteCredential } from '@/lib/webauthn';
import { requireSession } from '@/lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;
  const { id } = await request.json().catch(() => ({ id: '' }));
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });
  await deleteCredential(id);
  return new Response(JSON.stringify({ ok: true }));
};
