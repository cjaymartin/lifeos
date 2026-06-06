import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// grocery.ts resolves its content dir from process.cwd() at import time —
// chdir into a sandbox BEFORE the dynamic import below.
const sandbox = mkdtempSync(join(tmpdir(), 'lifeos-grocery-'));
const DIR = join(sandbox, 'src/content/grocery');
mkdirSync(DIR, { recursive: true });
const realCwd = process.cwd();
process.chdir(sandbox);

const grocery = await import('@/features/grocery/ops');

afterAll(() => {
  process.chdir(realCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown) {
  writeFileSync(join(DIR, file), JSON.stringify(data, null, 2));
}
function readJson<T = any>(file: string): T {
  return JSON.parse(readFileSync(join(DIR, file), 'utf-8'));
}
function rm(file: string) {
  rmSync(join(DIR, file), { force: true });
}

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, category: 'Pantry', categoryConfirmed: true, staple: false,
  checked: false, addedAt: '2026-06-01T00:00:00Z', source: 'manual', ...extra,
});

beforeEach(() => {
  rm('carts.json'); rm('cart-request.json'); rm('product-map.json');
  writeJson('staples.json', { staples: [] });
});

describe('assembleCarts', () => {
  it('resolves product-mapped items instantly into a cart with a rebuilt cartUrl', async () => {
    writeJson('grocery.json', { lastUpdated: '', items: [item('milk-1', 'Milk')] });
    writeJson('product-map.json', {
      milk: { retailer: 'walmart', productId: '111', productUrl: 'https://www.walmart.com/ip/111', product: 'Great Value Milk' },
    });

    const result = await grocery.assembleCarts();
    expect(result).toMatchObject({ instant: 1, queued: 0 });

    const carts = readJson('carts.json');
    expect(carts.carts).toHaveLength(1);
    expect(carts.carts[0].retailer).toBe('walmart');
    expect(carts.carts[0].items[0]).toMatchObject({ itemId: 'milk-1', productId: '111', qty: 1, source: 'reorder' });
    expect(carts.carts[0].cartUrl).toContain('111');
    expect(existsSync(join(DIR, 'cart-request.json'))).toBe(false); // no agent run queued
  });

  it('queues unknown items for the agent via cart-request.json', async () => {
    writeJson('grocery.json', { lastUpdated: '', items: [item('weird-1', 'Dragonfruit Paste')] });

    const result = await grocery.assembleCarts();
    expect(result).toMatchObject({ instant: 0, queued: 1 });
    expect(readJson('cart-request.json').itemIds).toEqual(['weird-1']);
    expect(existsSync(join(DIR, 'carts.json'))).toBe(false); // nothing instant — no write
  });

  it('never rebuilds lines already fully pushed to a retailer cart', async () => {
    writeJson('grocery.json', { lastUpdated: '', items: [item('milk-1', 'Milk')] });
    writeJson('product-map.json', {
      milk: { retailer: 'walmart', productId: '111', productUrl: 'u', product: 'p' },
    });
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [],
        items: [{ itemId: 'milk-1', name: 'Milk', productId: '111', qty: 1, addedQty: 1 }] }],
    });

    const result = await grocery.assembleCarts();
    expect(result).toMatchObject({ instant: 0, queued: 0 });
  });

  it('a buyFrom preference overrides a cached product at the other retailer', async () => {
    writeJson('grocery.json', { lastUpdated: '', items: [item('milk-1', 'Milk', { buyFrom: 'amazon' })] });
    writeJson('product-map.json', {
      milk: { retailer: 'walmart', productId: '111', productUrl: 'u', product: 'p' },
    });

    const result = await grocery.assembleCarts();
    expect(result).toMatchObject({ instant: 0, queued: 1 }); // goes to the agent instead
  });

  it('itemIds limits the build to a selection; checked items are always excluded', async () => {
    writeJson('grocery.json', {
      lastUpdated: '',
      items: [
        item('a', 'Milk'),
        item('b', 'Bread'),
        item('c', 'Eggs', { checked: true }),
      ],
    });

    const result = await grocery.assembleCarts(['b', 'c']);
    expect(result).toMatchObject({ instant: 0, queued: 1 });
    expect(readJson('cart-request.json').itemIds).toEqual(['b']);
  });

  it('bare-integer quantities become purchase counts; unit quantities do not', async () => {
    writeJson('grocery.json', {
      lastUpdated: '',
      items: [item('m', 'Milk', { quantity: '2' }), item('b', 'Beef', { quantity: '1 lb' })],
    });
    writeJson('product-map.json', {
      milk: { retailer: 'walmart', productId: '1', productUrl: 'u', product: 'p' },
      beef: { retailer: 'walmart', productId: '2', productUrl: 'u', product: 'p' },
    });

    await grocery.assembleCarts();
    const lines = readJson('carts.json').carts[0].items;
    expect(lines.find((l: any) => l.itemId === 'm').qty).toBe(2);
    expect(lines.find((l: any) => l.itemId === 'b').qty).toBe(1);
  });
});
