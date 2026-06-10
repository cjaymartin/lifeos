import type { APIRoute } from 'astro';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { requireSession } from '@/lib/auth';
import { makeStoredZip } from '@/lib/zip';

const EXT_DIR = join(process.cwd(), 'extension/lifeos');

/** GET /api/extension/download — packages the LifeOS browser extension folder
 *  into a zip (under a top-level lifeos-extension/ dir) for the user to load
 *  unpacked. Session-guarded (top-level GET sends the lax cookie). */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let names: string[];
  try {
    names = (await readdir(EXT_DIR)).filter(n => !n.startsWith('.'));
  } catch {
    return new Response('Extension files not found on the server.', { status: 404 });
  }

  const entries = await Promise.all(
    names.map(async (n) => ({ name: `lifeos-extension/${n}`, data: await readFile(join(EXT_DIR, n)) })),
  );
  const zip = makeStoredZip(entries);

  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="lifeos-extension.zip"',
      'Content-Length': String(zip.length),
      'Cache-Control': 'no-store',
    },
  });
};
