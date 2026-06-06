import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';

const LOCK = join(process.cwd(), 'src/content/daily/.refresh-lock');
const DATA = join(process.cwd(), 'src/content/daily/today.json');
const STALE_MS = 5 * 60 * 1000;

export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let running = false;
  try {
    const ts = Number(await readFile(LOCK, 'utf-8'));
    running = Date.now() - ts < STALE_MS;
  } catch {}

  let lastUpdated: number | null = null;
  try {
    lastUpdated = (await stat(DATA)).mtimeMs;
  } catch {}

  return new Response(JSON.stringify({ running, lastUpdated }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
