import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { readFile } from 'fs/promises';
import { DISMISSED_FILE, saveDismissed, type Dismissal } from '@/features/deliveries/ops';

const KEEP_MS = 45 * 24 * 60 * 60 * 1000; // prune dismissals older than 45 days

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

  const now = Date.now();
  dismissed = dismissed.filter(d =>
    d.id !== id && now - new Date(d.dismissedAt).getTime() < KEEP_MS
  );
  dismissed.push({ id, dismissedAt: new Date(now).toISOString() });

  await saveDismissed(dismissed);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
