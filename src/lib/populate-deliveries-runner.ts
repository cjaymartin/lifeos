import { spawn } from 'child_process';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';

const LOCK = join(process.cwd(), 'src/content/deliveries/.refresh-lock');
const STALE_MS = 5 * 60 * 1000;

const ALLOWED_TOOLS = [
  'mcp__claude_ai_Gmail__search_threads',
  'mcp__claude_ai_Gmail__get_thread',
  'Read(src/content/*)',
  'Write(src/content/deliveries/deliveries.json)',
].join(' ');

// No bypassPermissions: the container runs claude as root, which rejects
// bypass mode. acceptEdits auto-approves file writes; --allowedTools covers
// the MCP/read tools (verified working headless in the container).
const CLAUDE_ARGS = [
  '-p', '/populate-deliveries',
  '--permission-mode', 'acceptEdits',
  '--allowedTools', ALLOWED_TOOLS,
];

async function acquireLock(): Promise<boolean> {
  try {
    const ts = Number(await readFile(LOCK, 'utf-8'));
    if (Date.now() - ts < STALE_MS) return false;
  } catch {}
  await writeFile(LOCK, String(Date.now()));
  return true;
}

async function releaseLock() {
  try { await unlink(LOCK); } catch {}
}

/** Fire-and-forget spawn — for the API route. Returns immediately. */
export async function spawnPopulateDeliveries(): Promise<'started' | 'running'> {
  if (!(await acquireLock())) return 'running';

  const proc = spawn('claude', CLAUDE_ARGS, {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  proc.on('exit', releaseLock);
  proc.on('error', async (err) => {
    console.error('[populate-deliveries] spawn error:', err.message);
    await releaseLock();
  });
  proc.unref();

  return 'started';
}
