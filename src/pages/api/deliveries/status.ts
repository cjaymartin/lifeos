import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { stat } from 'fs/promises';
import { DELIVERIES_FILE } from '@/lib/deliveries';
import { isPopulateDeliveriesRunning } from '@/lib/populate-deliveries-runner';

export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const running = await isPopulateDeliveriesRunning();

  let lastUpdated: number | null = null;
  try {
    lastUpdated = (await stat(DELIVERIES_FILE)).mtimeMs;
  } catch {}

  return new Response(JSON.stringify({ running, lastUpdated }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
