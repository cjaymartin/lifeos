import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { stat } from 'fs/promises';
import { isPopulateDailyRunning } from '@/features/daily/jobs';
import { vaultPath } from '@/lib/content-paths';

const DATA = vaultPath('daily', 'today.md');

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
