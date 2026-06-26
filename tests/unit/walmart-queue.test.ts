import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// walmart-queue resolves its file path from process.cwd() at import time —
// chdir into a sandbox BEFORE the dynamic imports below (mirrors grocery tests).
const sandbox = mkdtempSync(join(tmpdir(), 'lifeos-walmart-'));
const DIR = join(sandbox, 'src/content/grocery');
mkdirSync(DIR, { recursive: true });
const QUEUE = join(DIR, '.walmart-commands.json');
const realCwd = process.cwd();
process.chdir(sandbox);

const q = await import('@/features/grocery/walmart-queue');
const svc = await import('@/features/grocery/walmart-service');

afterAll(() => {
  process.chdir(realCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

const readQueue = () => JSON.parse(readFileSync(QUEUE, 'utf-8'));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  rmSync(QUEUE, { force: true });
});

describe('walmart command queue', () => {
  it('enqueues a pending command with an id', async () => {
    const cmd = await q.enqueueCommand('get-cart');
    expect(cmd.id).toMatch(/^wm_/);
    expect(cmd.status).toBe('pending');
    expect(readQueue().commands).toHaveLength(1);
  });

  it('reports the extension absent until it polls, then fresh', async () => {
    expect(await q.extensionFresh(45_000)).toBe(false);
    await q.claimPending(); // a poll
    expect(await q.extensionFresh(45_000)).toBe(true);
    expect(await q.extensionFresh(0)).toBe(false); // zero window = never fresh
  });

  it('claimPending moves pending → claimed and returns them', async () => {
    await q.enqueueCommand('get-cart');
    await q.enqueueCommand('add-item', { productId: '123', qty: 2 });
    const claimed = await q.claimPending();
    expect(claimed).toHaveLength(2);
    expect(claimed.every((c) => c.status === 'claimed')).toBe(true);
    // a second poll finds nothing new to claim
    expect(await q.claimPending()).toHaveLength(0);
  });

  it('records a successful result', async () => {
    const cmd = await q.enqueueCommand('get-cart');
    await q.claimPending();
    await q.recordResult(cmd.id, { ok: true, result: { cart: [{ productId: '777', product: 'Milk' }] } });
    const stored = await q.getCommand(cmd.id);
    expect(stored?.status).toBe('done');
    expect(stored?.result?.cart?.[0].productId).toBe('777');
  });

  it('records an error result', async () => {
    const cmd = await q.enqueueCommand('remove-item', { productId: '5' });
    await q.recordResult(cmd.id, { ok: false, error: 'not found' });
    const stored = await q.getCommand(cmd.id);
    expect(stored?.status).toBe('error');
    expect(stored?.error).toBe('not found');
  });

  it('recordResult is a no-op for an unknown id', async () => {
    await expect(q.recordResult('nope', { ok: false, error: 'x' })).resolves.toBeUndefined();
  });

  it('prunes commands older than the retention window', async () => {
    // Write a stale command directly, then enqueue a fresh one — the stale one
    // should be dropped on the next mutation.
    writeFileSync(QUEUE, JSON.stringify({
      commands: [{ id: 'wm_old', op: 'get-cart', params: {}, status: 'done', createdAt: Date.now() - 10 * 60 * 1000 }],
    }));
    await q.enqueueCommand('get-cart');
    const ids = readQueue().commands.map((c: { id: string }) => c.id);
    expect(ids).not.toContain('wm_old');
    expect(ids).toHaveLength(1);
  });
});

describe('walmart service — extension path', () => {
  it('routes to the extension when present and returns its result', async () => {
    await q.claimPending(); // mark the extension present

    const run = svc.runWalmartOp('get-cart');

    // Simulate the extension: wait for the command to land, then post a result.
    let id: string | undefined;
    for (let i = 0; i < 40 && !id; i++) {
      await sleep(25);
      if (!existsSync(QUEUE)) continue;
      id = readQueue().commands.find((c: { op: string }) => c.op === 'get-cart')?.id;
    }
    expect(id).toBeTruthy();
    await q.recordResult(id!, { ok: true, result: { cart: [{ productId: '42', product: 'Eggs' }] } });

    const result = await run;
    expect(result.ok).toBe(true);
    expect(result.executor).toBe('extension');
    expect(result.cart?.[0].productId).toBe('42');
  });
});
