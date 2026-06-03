import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { spawn } from 'child_process';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';

const LOCK = join(process.cwd(), 'src/content/daily/.refresh-lock');
const STALE_MS = 5 * 60 * 1000; // 5 min timeout

export const POST: APIRoute = async ({ cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  // Reject if a non-stale run is already in progress
  try {
    const ts = Number(await readFile(LOCK, 'utf-8'));
    if (Date.now() - ts < STALE_MS)
      return new Response(JSON.stringify({ status: 'running' }), {
        status: 202, headers: { 'Content-Type': 'application/json' },
      });
  } catch {}

  await writeFile(LOCK, String(Date.now()));

  const proc = spawn('claude', [
    '-p', '/populate-daily',
    '--allowedTools',
    'mcp__claude_ai_Todoist__*,mcp__claude_ai_Google_Calendar__*,WebFetch,Bash,Read,Write',
  ], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  proc.on('exit', async () => { try { await unlink(LOCK); } catch {} });
  proc.unref();

  return new Response(JSON.stringify({ status: 'started' }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};
