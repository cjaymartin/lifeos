import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Short front-door windows so timeout paths resolve in a test, not 22s.
process.env.LIFEOS_WM_WAIT_MS = '500';
process.env.LIFEOS_WM_PRESENCE_MS = '45000';

// walmart-service resolves the queue file from cwd at import time — chdir into a
// sandbox before the dynamic imports below (mirrors walmart-queue.test.ts).
const sandbox = mkdtempSync(join(tmpdir(), 'lifeos-wmsvc-'));
mkdirSync(join(sandbox, 'src/content/grocery'), { recursive: true });
const QUEUE = join(sandbox, 'src/content/grocery/.walmart-commands.json');
const realCwd = process.cwd();
process.chdir(sandbox);

// The Playwright fallback and Gmail feed are the slow/real-IO collaborators —
// stub them so we can characterize the routing logic in isolation.
vi.mock('@/features/grocery/walmart-session', () => ({
  sessionGetCart: vi.fn(async () => ({ cart: [{ productId: 'FB1', product: 'Fallback Milk', productUrl: 'u' }] })),
  sessionGetHistory: vi.fn(async () => ({ history: [{ productId: 'FBH', product: 'Fallback History', productUrl: 'u' }] })),
  sessionGetDeliveries: vi.fn(async () => ({ deliveries: [] })),
  sessionAddItems: vi.fn(async () => ({ cart: [{ productId: 'ADD', product: 'Added', productUrl: 'u' }] })),
  sessionRemoveItem: vi.fn(async () => ({ cart: [] })),
}));
vi.mock('@/features/deliveries/ops', () => ({
  loadDeliveries: vi.fn(async () => null),
}));

const q = await import('@/features/grocery/walmart-queue');
const session = await import('@/features/grocery/walmart-session');
const deliveries = await import('@/features/deliveries/ops');
const svc = await import('@/features/grocery/walmart-service');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type ExtOutcome =
  | { ok: true; result: { cart?: unknown[]; history?: unknown[]; deliveries?: unknown[] } }
  | { ok: false; error: string };

/** Stand in for the browser extension: wait for the front door to enqueue a
 *  command of `op`, optionally stall `delayMs`, then post an outcome — exactly
 *  what the real extension's poll→execute→result cycle does. */
async function simulateExtension(op: string, outcome: ExtOutcome, delayMs = 0): Promise<string> {
  let id: string | undefined;
  for (let i = 0; i < 100 && !id; i++) {
    await sleep(15);
    try {
      const cmds = JSON.parse(readFileSync(QUEUE, 'utf-8')).commands as { id: string; op: string; status: string }[];
      id = cmds.find((c) => c.op === op && c.status !== 'done' && c.status !== 'error')?.id;
    } catch { /* queue not written yet */ }
  }
  if (!id) throw new Error(`extension never saw an enqueued ${op}`);
  if (delayMs) await sleep(delayMs);
  await q.recordResult(id, outcome);
  return id;
}

afterAll(() => {
  process.chdir(realCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(QUEUE, { force: true });
  vi.clearAllMocks();
});

describe('walmart-service routing — fallback path', () => {
  it('falls back to the local session when the extension has never polled', async () => {
    const res = await svc.runWalmartOp('get-cart');
    expect(res.ok).toBe(true);
    expect(res.executor).toBe('fallback');
    expect(res.cart?.[0].productId).toBe('FB1');
    expect(session.sessionGetCart).toHaveBeenCalledOnce();
  });
});

describe('walmart-service routing — extension path', () => {
  it('routes get-cart to the extension when present and does not touch the fallback', async () => {
    await q.claimPending(); // extension polled → present
    const run = svc.runWalmartOp('get-cart');
    await simulateExtension('get-cart', { ok: true, result: { cart: [{ productId: '42', product: 'Eggs' }] } });
    const res = await run;
    expect(res.executor).toBe('extension');
    expect(res.cart?.[0].productId).toBe('42');
    expect(session.sessionGetCart).not.toHaveBeenCalled();
  });

  it('routes add-item to the extension when present', async () => {
    await q.claimPending();
    const run = svc.runWalmartOp('add-item', { productId: '999', qty: 2 });
    await simulateExtension('add-item', { ok: true, result: { cart: [{ productId: '999', product: 'Added' }] } });
    const res = await run;
    expect(res.executor).toBe('extension');
    expect(res.cart?.[0].productId).toBe('999');
    expect(session.sessionAddItems).not.toHaveBeenCalled();
  });

  it('routes remove-item to the extension when present', async () => {
    await q.claimPending();
    const run = svc.runWalmartOp('remove-item', { productId: '999' });
    await simulateExtension('remove-item', { ok: true, result: { cart: [] } });
    const res = await run;
    expect(res.executor).toBe('extension');
    expect(session.sessionRemoveItem).not.toHaveBeenCalled();
  });
});

describe('walmart-service routing — extension failure handling', () => {
  it('reads fall back to Playwright when the extension times out (idempotent)', async () => {
    await q.claimPending(); // present, but the extension never records a result
    const res = await svc.runWalmartOp('get-cart');
    expect(res.ok).toBe(true);
    expect(res.executor).toBe('fallback');
    expect(session.sessionGetCart).toHaveBeenCalledOnce();
  });

  it('mutations surface ok:false on a definitive extension error (no Playwright double-add)', async () => {
    // The extension's post-op cart scrape knows the add didn't land (out of
    // stock, needs options, or the click no-opped). Retrying via Playwright would
    // risk a duplicate add, so the front door surfaces the failure instead.
    await q.claimPending();
    const run = svc.runWalmartOp('add-item', { productId: '999', qty: 1 });
    await simulateExtension('add-item', { ok: false, error: 'add did not land in cart: 999' });
    const res = await run;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/did not land/);
    expect(session.sessionAddItems).not.toHaveBeenCalled();
  });

  it('mutations do NOT double-execute when the extension only TIMED OUT (unknown outcome)', async () => {
    await q.claimPending();
    // Extension is slow — it records AFTER the front door's wait window elapses.
    const slow = simulateExtension('add-item', { ok: true, result: { cart: [{ productId: '999' }] } }, 900);
    const res = await svc.runWalmartOp('add-item', { productId: '999', qty: 1 });
    // Must NOT have blindly run the Playwright add on top of an in-flight extension add.
    expect(session.sessionAddItems).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    await slow; // let the simulated extension finish before teardown
  });

  it('fallback add-item reports ok:false when the requested item is absent from the resulting cart', async () => {
    // Extension not present → Playwright fallback. Its affiliate deep link can
    // silently no-op (out of stock / needs options) while still landing on a
    // cart page, so a returned cart missing the requested id is a failed add.
    const res = await svc.runWalmartOp('add-item', { productId: '999', qty: 1 });
    expect(session.sessionAddItems).toHaveBeenCalledOnce();
    expect(res.executor).toBeUndefined();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/did not land/);
  });

  it('fallback add-item reports ok:true when the requested item IS in the resulting cart', async () => {
    // The sessionAddItems mock returns a cart containing productId 'ADD'.
    const res = await svc.runWalmartOp('add-item', { productId: 'ADD', qty: 1 });
    expect(res.ok).toBe(true);
    expect(res.executor).toBe('fallback');
    expect(res.cart?.some((c) => c.productId === 'ADD')).toBe(true);
  });

  it('fallback remove-item reports ok:true when the item is absent from the resulting cart', async () => {
    // sessionRemoveItem mock returns an empty cart → the id is gone → success.
    const res = await svc.runWalmartOp('remove-item', { productId: '999' });
    expect(res.ok).toBe(true);
    expect(res.executor).toBe('fallback');
  });

  it('fallback remove-item reports ok:false when the item survives in the resulting cart', async () => {
    // Simulate a Remove click that no-opped: the returned cart still has the id.
    vi.mocked(session.sessionRemoveItem).mockResolvedValueOnce({
      cart: [{ productId: '999', product: 'Survivor', productUrl: 'u' }],
    });
    const res = await svc.runWalmartOp('remove-item', { productId: '999' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/still in cart/);
  });
});

describe('walmart-service routing — deliveries fallback chain', () => {
  it('serves the Gmail feed when the local session scrapes no live deliveries', async () => {
    vi.mocked(session.sessionGetDeliveries).mockResolvedValueOnce({ deliveries: [] });
    vi.mocked(deliveries.loadDeliveries).mockResolvedValueOnce({
      deliveries: [
        { id: 'o1', vendor: 'Walmart', item: 'Milk', status: 'arriving', eta: 'today', etaWindow: '5-6pm' },
      ],
    } as any);
    const res = await svc.runWalmartOp('get-deliveries');
    expect(res.ok).toBe(true);
    expect(res.source).toBe('gmail');
    expect(res.deliveries?.[0].orderId).toBe('o1');
  });

  it('falls back to Gmail deliveries when the local session throws', async () => {
    vi.mocked(session.sessionGetDeliveries).mockRejectedValueOnce(new Error('bot wall'));
    vi.mocked(deliveries.loadDeliveries).mockResolvedValueOnce({
      deliveries: [{ id: 'o2', vendor: 'walmart', item: 'Eggs', status: 'shipped' }],
    } as any);
    const res = await svc.runWalmartOp('get-deliveries');
    expect(res.ok).toBe(true);
    expect(res.source).toBe('gmail');
    expect(res.deliveries?.[0].orderId).toBe('o2');
  });

  it('returns ok:false when a read fallback throws and there is no Gmail feed', async () => {
    vi.mocked(session.sessionGetCart).mockRejectedValueOnce(new Error('signed out'));
    const res = await svc.runWalmartOp('get-cart');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/signed out/);
  });

  it('consults Gmail when the EXTENSION returns no live deliveries (last resort applies to any executor)', async () => {
    await q.claimPending(); // extension present
    const run = svc.runWalmartOp('get-deliveries');
    await simulateExtension('get-deliveries', { ok: true, result: { deliveries: [] } });
    vi.mocked(deliveries.loadDeliveries).mockResolvedValueOnce({
      deliveries: [{ id: 'o3', vendor: 'Walmart', item: 'Bread', status: 'preparing' }],
    } as any);
    const res = await run;
    expect(res.ok).toBe(true);
    expect(res.source).toBe('gmail');
    expect(res.deliveries?.[0].orderId).toBe('o3');
    expect(session.sessionGetDeliveries).not.toHaveBeenCalled(); // extension was present; no Playwright
  });
});
