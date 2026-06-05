// Fire-and-forget claude runners for the Grocery stack — mirrors
// src/lib/populate-deliveries-runner.ts (lock + log per job, detached spawn).
import { spawn } from 'child_process';
import { openSync } from 'fs';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';

const DIR = join(process.cwd(), 'src/content/grocery');
const STALE_MS = 5 * 60 * 1000;

// build-carts streams JSONL events here (--output-format stream-json) so the
// UI can show live progress; parsed by /api/grocery/build-progress
export const BUILD_LOG = join(DIR, '.build-log');

export type GroceryJob = 'build-carts' | 'purchase-scan' | 'categorize';

interface JobConfig {
  lock: string;
  log: string;
  args: string[];
}

// acceptEdits auto-approves file writes; --allowedTools covers the MCP/web/read
// tools (same headless setup verified working for /populate-deliveries).
const JOBS: Record<GroceryJob, JobConfig> = {
  'build-carts': {
    lock: join(DIR, '.build-lock'),
    log: BUILD_LOG,
    args: [
      '-p', '/build-carts',
      // stream-json (requires --verbose in -p mode) emits each tool call as a
      // JSONL line in realtime — the modal's progress feed reads these
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', [
        'WebSearch',
        'WebFetch',
        // Past Walmart order emails → reorder exact products instead of guessing
        'mcp__claude_ai_Gmail__search_threads',
        'mcp__claude_ai_Gmail__get_thread',
        'Read(src/content/grocery/*)',
        'Write(src/content/grocery/carts.json)',
        'Write(src/content/grocery/product-map.json)',
      ].join(' '),
    ],
  },
  'purchase-scan': {
    lock: join(DIR, '.scan-lock'),
    log: join(DIR, '.scan-log'),
    args: [
      '-p', '/grocery-purchase-scan',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', [
        'mcp__claude_ai_Gmail__search_threads',
        'mcp__claude_ai_Gmail__get_thread',
        'Read(src/content/grocery/*)',
        'Write(src/content/grocery/.scan-results.json)',
      ].join(' '),
    ],
  },
  categorize: {
    lock: join(DIR, '.categorize-lock'),
    log: join(DIR, '.categorize-log'),
    args: [
      '-p', '/grocery-categorize',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', [
        'Read(src/content/grocery/*)',
        'Write(src/content/grocery/.categorized.json)',
      ].join(' '),
    ],
  },
};

async function acquireLock(lock: string): Promise<boolean> {
  try {
    const ts = Number(await readFile(lock, 'utf-8'));
    if (Date.now() - ts < STALE_MS) return false;
  } catch {}
  await writeFile(lock, String(Date.now()));
  return true;
}

export async function isJobRunning(job: GroceryJob): Promise<boolean> {
  try {
    const ts = Number(await readFile(JOBS[job].lock, 'utf-8'));
    return Date.now() - ts < STALE_MS;
  } catch {
    return false;
  }
}

/** Fire-and-forget spawn — for the API routes. Returns immediately. */
export async function spawnGroceryJob(job: GroceryJob): Promise<'started' | 'running'> {
  const cfg = JOBS[job];
  if (!(await acquireLock(cfg.lock))) return 'running';

  const releaseLock = async () => { try { await unlink(cfg.lock); } catch {} };

  let out: number | 'ignore' = 'ignore';
  try { out = openSync(cfg.log, 'w'); } catch {}

  const proc = spawn('claude', cfg.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
  });

  proc.on('exit', releaseLock);
  proc.on('error', async (err) => {
    console.error(`[grocery:${job}] spawn error:`, err.message);
    await releaseLock();
  });
  proc.unref();

  return 'started';
}
