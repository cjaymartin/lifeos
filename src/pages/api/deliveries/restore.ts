import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { readFile, writeFile } from 'fs/promises';
import { DISMISSED_FILE } from '@/lib/deliveries';

interface Dismissal { id: string; dismissedAt: string }

export const POST: APIRoute = async ({ cookies, request }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

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
