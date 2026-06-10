import type { APIRoute } from 'astro';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { requireSession } from '@/lib/auth';

/** GET /api/extension/info — the version currently packaged on the server, so
 *  the settings UI can tell "installed & up to date" from "update available". */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let version: string | null = null;
  try {
    const manifest = JSON.parse(await readFile(join(process.cwd(), 'extension/lifeos/manifest.json'), 'utf-8'));
    version = manifest.version ?? null;
  } catch { /* extension dir absent (e.g. sandbox) → null */ }

  return new Response(JSON.stringify({ version }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
