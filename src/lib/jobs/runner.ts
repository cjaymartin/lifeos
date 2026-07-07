// ── Agent-job runner ─────────────────────────────────────────────────────────
//
// The one place that knows how LifeOS runs headless claude agents:
//   - lock files (timestamp, stale after STALE_MS) so a job runs once at a time
//   - detached spawn + unref so the agent survives the request and its
//     exit-time signals can never reach the server process
//   - log redirect to a dot-file in the feature's content dir (bind-mounted,
//     so failed runs are debuggable from the host)
//   - arg construction for `claude -p` (acceptEdits, space-joined allowedTools
//     — verified working headless in the container, which runs as uid 1000)
//   - stream-json parsing for live progress feeds
//
// Callers describe a job (defineAgentJob) or a lock-scoped in-process task
// (startLockedTask) and never touch any of the conventions above.

import { spawn } from 'child_process';
import { openSync, createWriteStream } from 'fs';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';

const STALE_MS = 5 * 60 * 1000;

/* ── Locks ──────────────────────────────────────────────────────────────── */

export interface JobLock {
  path: string;
  staleMs: number;
}

export function defineJobLock(path: string, staleMs = STALE_MS): JobLock {
  return { path, staleMs };
}

/** A lock is fresh while its timestamp is younger than staleMs. */
export async function isLockFresh(lock: JobLock): Promise<boolean> {
  try {
    const ts = Number(await readFile(lock.path, 'utf-8'));
    return Date.now() - ts < lock.staleMs;
  } catch {
    return false;
  }
}

async function acquireLock(lock: JobLock): Promise<boolean> {
  if (await isLockFresh(lock)) return false;
  await writeFile(lock.path, String(Date.now()));
  return true;
}

async function releaseLock(lock: JobLock): Promise<void> {
  try {
    await unlink(lock.path);
  } catch {}
}

/**
 * Run an in-process async task behind a lock (fire-and-forget). The lock is
 * released when the task settles — including when it throws; failures are the
 * task's own to report (e.g. via a status file).
 */
export async function startLockedTask(
  lock: JobLock,
  task: () => Promise<unknown> | unknown,
): Promise<'started' | 'running'> {
  if (!(await acquireLock(lock))) return 'running';
  void Promise.resolve()
    .then(task)
    .catch(() => {})
    .finally(() => releaseLock(lock));
  return 'started';
}

/* ── Agent jobs (detached headless claude) ──────────────────────────────── */

export interface AgentJob {
  name: string;
  lock: JobLock;
  logPath: string;
  args: string[];
}

export function defineAgentJob(cfg: {
  name: string;
  /** Directory the lock + log dot-files live in (the feature's content dir). */
  dir: string;
  lockFile: string;
  logFile: string;
  /** The `-p` payload — a skill invocation like '/populate-daily'. */
  prompt: string;
  allowedTools: string[];
  /** Extra directories claude may read/write outside its working dir. The vault
   *  lives outside the repo (/app), and claude confines file access to the cwd
   *  unless a path is added here — without it, vault Read/Write is silently
   *  refused even when allowedTools permits the exact path. */
  addDirs?: string[];
  /** stream-json (requires --verbose in -p mode) emits each tool call as a
   *  realtime JSONL line — for jobs with a live progress feed. */
  stream?: boolean;
  staleMs?: number;
}): AgentJob {
  return {
    name: cfg.name,
    lock: defineJobLock(join(cfg.dir, cfg.lockFile), cfg.staleMs),
    logPath: join(cfg.dir, cfg.logFile),
    args: [
      '-p', cfg.prompt,
      ...(cfg.stream ? ['--output-format', 'stream-json', '--verbose'] : []),
      '--permission-mode', 'acceptEdits',
      ...(cfg.addDirs ?? []).flatMap((d) => ['--add-dir', d]),
      '--allowedTools', cfg.allowedTools.join(' '),
    ],
  };
}

export function isAgentJobRunning(job: AgentJob): Promise<boolean> {
  return isLockFresh(job.lock);
}

/** The job's log so far ('' when it hasn't written one). */
export async function readAgentJobLog(job: AgentJob): Promise<string> {
  try {
    return await readFile(job.logPath, 'utf-8');
  } catch {
    return '';
  }
}

/** Fire-and-forget spawn — for API routes. Returns immediately. */
export async function startAgentJob(job: AgentJob): Promise<'started' | 'running'> {
  if (!(await acquireLock(job.lock))) return 'running';

  let out: number | 'ignore' = 'ignore';
  try {
    out = openSync(job.logPath, 'w');
  } catch {}

  // detached → own process group: claude's exit-time cleanup signals can
  // never reach the server (an attached claude SIGTERM'd the whole app)
  const proc = spawn('claude', job.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
  });

  proc.on('exit', () => releaseLock(job.lock));
  proc.on('error', async (err) => {
    console.error(`[${job.name}] spawn error:`, err.message);
    await releaseLock(job.lock);
  });
  proc.unref();

  return 'started';
}

/** Blocking run — for CLI scripts / cron. Resolves when claude exits cleanly. */
export async function runAgentJobBlocking(job: AgentJob): Promise<'completed' | 'running'> {
  if (!(await acquireLock(job.lock))) return 'running';

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', job.args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env },
    });

    proc.on('exit', async (code) => {
      await releaseLock(job.lock);
      code === 0
        ? resolve('completed')
        : reject(new Error(`[${job.name}] claude exited with code ${code}`));
    });
    proc.on('error', async (err) => {
      await releaseLock(job.lock);
      reject(err);
    });
  });
}

/* ── Captured runs (request/response style, e.g. chat) ──────────────────── */

/**
 * Spawn headless claude and capture stdout. Detached (see above) but not
 * lock-guarded — concurrency is the caller's concern. Optionally tees output
 * to a log file for debuggability.
 */
export function runAgentCapture(opts: {
  prompt: string;
  allowedTools: string[];
  timeoutMs?: number;
  logPath?: string;
  /** Extra dirs claude may read/write outside its cwd — same vault-outside-/app
   *  reason as defineAgentJob's addDirs; without it, vault Read/Write is silently
   *  refused even when allowedTools permits the exact path. */
  addDirs?: string[];
  /** Extra claude args appended verbatim (e.g. ['--permission-mode', 'acceptEdits']). */
  extraArgs?: string[];
}): Promise<string> {
  const { prompt, allowedTools, timeoutMs = 300_000, logPath, addDirs = [], extraArgs = [] } = opts;
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const proc = spawn(
      'claude',
      [
        '-p', prompt,
        '--allowedTools', allowedTools.join(' '),
        '--output-format', 'text',
        ...addDirs.flatMap((d) => ['--add-dir', d]),
        ...extraArgs,
      ],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env }, detached: true },
    );
    if (logPath) {
      const log = createWriteStream(logPath);
      proc.stdout.pipe(log);
      proc.stderr.pipe(log);
    }
    proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || chunks.length > 0) resolve(chunks.join('').trim());
      else reject(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/* ── Stream-json progress parsing ───────────────────────────────────────── */

export interface ProgressEvent {
  t: 'tool' | 'note' | 'result';
  label: string;
}

const trunc = (s: unknown, n: number) => {
  const str = String(s ?? '').trim();
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function defaultToolLabel(name: string, _input: any): string {
  return name.replace(/^mcp__\w+__/, '').replace(/_/g, ' ');
}

/** Parse a claude stream-json log into a friendly event feed. */
export function parseStreamEvents(
  raw: string,
  opts: {
    toolLabel?: (name: string, input: any) => string;
    resultLabels?: { ok: string; fail: string };
  } = {},
): { events: ProgressEvent[]; done: boolean; ok: boolean | null } {
  const toolLabel = opts.toolLabel ?? defaultToolLabel;
  const resultLabels = opts.resultLabels ?? { ok: 'Done', fail: 'Failed' };

  const events: ProgressEvent[] = [];
  let done = false;
  let ok: boolean | null = null;

  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let j: any;
    try {
      j = JSON.parse(s);
    } catch {
      continue;
    }

    if (j.type === 'assistant') {
      for (const block of j.message?.content ?? []) {
        if (block.type === 'tool_use') {
          events.push({ t: 'tool', label: toolLabel(block.name, block.input) });
        } else if (block.type === 'text' && block.text?.trim()) {
          // The agent narrating its plan — first line only, kept short
          events.push({ t: 'note', label: trunc(block.text.split('\n')[0], 90) });
        }
      }
    } else if (j.type === 'result') {
      done = true;
      ok = j.subtype === 'success' && !j.is_error;
      events.push({ t: 'result', label: ok ? resultLabels.ok : resultLabels.fail });
    }
  }

  return { events: events.slice(-60), done, ok };
}
