// ── Walmart command queue ────────────────────────────────────────────────────
//
// The durable hand-off between the LifeOS server and the browser extension for
// on-demand Walmart cart operations (ADR 0001). The server enqueues a command;
// the extension long-polls, claims it, executes it in the user's logged-in
// Walmart tab, and posts the result back here. The front-door request waits on
// this queue for the result (and falls back to Playwright if it doesn't land).
//
// Storage is a single JSON dot-file in the grocery content dir. All mutations go
// through an in-process promise-chain mutex so the concurrent actors — the
// waiting front door, the extension poll, and the result POST — never interleave
// a read-modify-write. LifeOS runs as a single Node process, so an in-process
// lock is sufficient (and avoids lock-file churn on every poll).

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { WalmartOp, WalmartOpParams, WalmartCartLine, WalmartLiveDelivery } from '@/features/grocery/types';

// Resolved at import time from cwd (mirrors ops.ts) so tests can chdir into a
// sandbox before importing.
const QUEUE_FILE = join(process.cwd(), 'src/content/grocery', '.walmart-commands.json');

/** Commands older than this are pruned regardless of status (safety net against
 *  a stuck command wedging the file). */
const PRUNE_MS = 5 * 60 * 1000;

/** A command claimed but neither completed nor errored within this window is
 *  re-offered to the next poll — covers an extension whose worker died (or whose
 *  poll connection dropped) mid-flight. Longer than any single op (a two-hop
 *  add-item navigation is ~15s) so a live executor is never double-dispatched. */
const CLAIM_STALE_MS = 45 * 1000;

export type WalmartCommandStatus = 'pending' | 'claimed' | 'done' | 'error';

/** What an executor returns for a command — the populated field depends on op. */
export interface WalmartResultPayload {
  cart?: WalmartCartLine[];
  history?: { productId: string; product: string; productUrl?: string }[];
  deliveries?: WalmartLiveDelivery[];
}

export interface WalmartCommand {
  id: string;
  op: WalmartOp;
  params: WalmartOpParams;
  status: WalmartCommandStatus;
  result?: WalmartResultPayload;
  error?: string;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
}

interface WalmartQueue {
  commands: WalmartCommand[];
  /** Epoch ms of the extension's most recent poll — doubles as presence. */
  lastPolledAt?: number;
}

/* ── In-process mutex ───────────────────────────────────────────────────── */

let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {}); // keep the chain alive across rejections
  return run;
}

/* ── File I/O (unlocked internals) ──────────────────────────────────────── */

async function read(): Promise<WalmartQueue> {
  try {
    const q = JSON.parse(await readFile(QUEUE_FILE, 'utf-8')) as WalmartQueue;
    return { commands: q.commands ?? [], lastPolledAt: q.lastPolledAt };
  } catch {
    return { commands: [] };
  }
}

async function write(q: WalmartQueue): Promise<void> {
  await writeFile(QUEUE_FILE, JSON.stringify(q, null, 2) + '\n');
}

function prune(q: WalmartQueue): WalmartQueue {
  const cutoff = Date.now() - PRUNE_MS;
  q.commands = q.commands.filter((c) => c.createdAt >= cutoff);
  return q;
}

function newId(): string {
  return `wm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/** Enqueue a pending command and return it. */
export function enqueueCommand(op: WalmartOp, params: WalmartOpParams = {}): Promise<WalmartCommand> {
  return withLock(async () => {
    const q = prune(await read());
    const cmd: WalmartCommand = { id: newId(), op, params, status: 'pending', createdAt: Date.now() };
    q.commands.push(cmd);
    await write(q);
    return cmd;
  });
}

/** Extension poll: record presence and claim all dispatchable commands — those
 *  pending, plus any claimed-but-stale ones whose executor never reported back.
 *  Returns the claimed commands for the extension to execute. */
export function claimPending(): Promise<WalmartCommand[]> {
  return withLock(async () => {
    const q = prune(await read());
    q.lastPolledAt = Date.now();
    const staleBefore = Date.now() - CLAIM_STALE_MS;
    const claimed = q.commands.filter(
      (c) => c.status === 'pending' || (c.status === 'claimed' && (c.claimedAt ?? 0) < staleBefore),
    );
    for (const c of claimed) {
      c.status = 'claimed';
      c.claimedAt = Date.now();
    }
    await write(q);
    return claimed;
  });
}

/** Record an extension poll without claiming (used when a poll times out empty
 *  so presence stays fresh between commands). */
export function markPolled(): Promise<void> {
  return withLock(async () => {
    const q = prune(await read());
    q.lastPolledAt = Date.now();
    await write(q);
  });
}

/** Store a command's outcome (done with payload, or error). No-op if the id is
 *  unknown (e.g. already pruned). */
export function recordResult(
  id: string,
  outcome: { ok: true; result: WalmartResultPayload } | { ok: false; error: string },
): Promise<void> {
  return withLock(async () => {
    const q = await read();
    const cmd = q.commands.find((c) => c.id === id);
    if (!cmd) return;
    cmd.completedAt = Date.now();
    if (outcome.ok) {
      cmd.status = 'done';
      cmd.result = outcome.result;
    } else {
      cmd.status = 'error';
      cmd.error = outcome.error;
    }
    await write(q);
  });
}

/** Look up a single command (for the front door's wait loop). */
export async function getCommand(id: string): Promise<WalmartCommand | null> {
  const q = await read();
  return q.commands.find((c) => c.id === id) ?? null;
}

/** Has the extension polled within maxAgeMs? Used to decide whether the front
 *  door waits for the extension at all before falling back to Playwright. */
export async function extensionFresh(maxAgeMs: number): Promise<boolean> {
  const q = await read();
  return q.lastPolledAt != null && Date.now() - q.lastPolledAt < maxAgeMs;
}
