import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { stat } from 'fs/promises';
import { GROCERY_FILE, CARTS_FILE } from '@/lib/grocery';
import { isJobRunning } from '@/lib/grocery-runner';

async function mtime(path: string): Promise<number | null> {
  try { return (await stat(path)).mtimeMs; } catch { return null; }
}

export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

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
