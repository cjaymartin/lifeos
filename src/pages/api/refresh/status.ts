import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { stat } from 'fs/promises';
import { join } from 'path';
import { isPopulateDailyRunning } from '@/lib/populate-daily-runner';

const DATA = join(process.cwd(), 'src/content/daily/today.json');

export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const running = await isPopulateDailyRunning();

  let lastUpdated: number | null = null;
  try {
    lastUpdated = (await stat(DATA)).mtimeMs;
  } catch {}

  return new Response(JSON.stringify({ running, lastUpdated }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
