import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { readFile, writeFile } from 'fs/promises';
import { DISMISSED_FILE } from '@/lib/deliveries';

interface Dismissal { id: string; dismissedAt: string }

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

  await writeFile(DISMISSED_FILE, JSON.stringify({ dismissed }, null, 2) + '\n');

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
