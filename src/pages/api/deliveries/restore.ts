import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { readFile } from 'fs/promises';
import { DISMISSED_FILE, saveDismissed, type Dismissal } from '@/features/deliveries/ops';

export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let id: string;
  try {
    ({ id } = await request.json() as { id: string });
    if (!id || typeof id !== 'string') throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  let dismissed: Dismissal[] = [];
  try {
    dismissed = (JSON.parse(await readFile(DISMISSED_FILE, 'utf-8')).dismissed ?? []) as Dismissal[];
  } catch {}

  dismissed = dismissed.filter(d => d.id !== id);

  await saveDismissed(dismissed);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
