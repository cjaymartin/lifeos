import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { stat } from 'fs/promises';
import { GROCERY_FILE, CARTS_FILE } from '@/lib/grocery';
import { isJobRunning } from '@/lib/grocery-runner';

async function mtime(path: string): Promise<number | null> {
  try { return (await stat(path)).mtimeMs; } catch { return null; }
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  const [building, scanning, categorizing, groceryUpdated, cartsUpdated] = await Promise.all([
    isJobRunning('build-carts'),
    isJobRunning('purchase-scan'),
    isJobRunning('categorize'),
    mtime(GROCERY_FILE),
    mtime(CARTS_FILE),
  ]);

  return new Response(JSON.stringify({ building, scanning, categorizing, groceryUpdated, cartsUpdated }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
