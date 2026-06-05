import { spawn } from 'child_process';
import { openSync } from 'fs';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';

const LOCK = join(process.cwd(), 'src/content/daily/.refresh-lock');
// claude output lands here (bind-mounted) so failed runs are debuggable from the host
const LOG = join(process.cwd(), 'src/content/daily/.refresh-log');
const STALE_MS = 5 * 60 * 1000;

const ALLOWED_TOOLS = [
  // Tasks come from the local mirror (src/content/tasks/tasks.json) via Read —
  // no Todoist MCP tools needed anymore; the Tasks stack syncs it continuously.
  'mcp__claude_ai_Google_Calendar__list_events',
  // Deliveries step (5.5) — delegated to the populate-deliveries skill
  'mcp__claude_ai_Gmail__search_threads',
  'mcp__claude_ai_Gmail__get_thread',
  'WebFetch',
  'Bash(curl *)',
  'Read(src/content/*)',
  'Read(.claude/skills/*)',
  'Write(src/content/daily/today.json)',
  'Write(src/content/deliveries/deliveries.json)',
].join(' ');

// acceptEdits auto-approves file writes; --allowedTools covers the MCP/read
// tools (verified working headless in the container, which runs as uid 1000).
const CLAUDE_ARGS = [
  '-p', '/populate-daily',
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
export async function spawnPopulateDaily(): Promise<'started' | 'running'> {
  if (!(await acquireLock())) return 'running';

  let out: number | 'ignore' = 'ignore';
  try { out = openSync(LOG, 'w'); } catch {}

  const proc = spawn('claude', CLAUDE_ARGS, {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
  });

  proc.on('exit', releaseLock);
  proc.on('error', async (err) => {
    console.error('[populate-daily] spawn error:', err.message);
    await releaseLock();
  });
  proc.unref();

  return 'started';
}

/** Blocking run — for the CLI script / cron. Resolves when claude exits. */
export async function runPopulateDaily(): Promise<void> {
  if (!(await acquireLock())) {
    console.error('[populate-daily] already running — skipping');
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', CLAUDE_ARGS, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env },
    });

    proc.on('exit', async (code) => {
      await releaseLock();
      code === 0 ? resolve() : reject(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', async (err) => {
      await releaseLock();
      reject(err);
    });
  });
}
