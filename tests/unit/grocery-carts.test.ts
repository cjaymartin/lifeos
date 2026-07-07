import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';

// grocery ops resolves its machine store from process.cwd() at import time —
// chdir into a sandbox BEFORE the dynamic import below. The grocery *list* and
// *staples* are human content that migrated into the vault, so also point
// LIFEOS_VAULT_DIR at a throwaway vault under the same sandbox.
const sandbox = mkdtempSync(join(tmpdir(), 'lifeos-grocery-'));
const DIR = join(sandbox, 'src/content/grocery');
mkdirSync(DIR, { recursive: true });
const VAULT = join(sandbox, 'vault');
const GROCERY_DIR = join(VAULT, 'grocery', 'list');
const STAPLES_DIR = join(VAULT, 'grocery', 'staples');
process.env.LIFEOS_VAULT_DIR = VAULT;
const realCwd = process.cwd();
process.chdir(sandbox);

const grocery = await import('@/features/grocery/ops');

afterAll(() => {
  process.chdir(realCwd);
  delete process.env.LIFEOS_VAULT_DIR;
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

// ── Vault helpers (grocery list + staples are one Markdown note per item) ─────
function writeNotes(dir: string, items: Array<Record<string, any>>) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const it of items) {
    writeFileSync(join(dir, `${it.id}.md`), `---\n${yamlDump(it)}---\n`);
  }
}
function readNotes<T = any>(dir: string): T[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    return (m ? yamlLoad(m[1]) : {}) as T;
  });
}
/** Seed the grocery list (vault). */
function writeGrocery(items: Array<Record<string, any>>) {
  writeNotes(GROCERY_DIR, items);
}
/** Read grocery list items back (vault). */
function readGrocery<T = any>(): T[] {
  return readNotes<T>(GROCERY_DIR);
}
/** Seed the staples (vault). */
function writeStaples(staples: Array<Record<string, any>>) {
  writeNotes(STAPLES_DIR, staples);
}
/** Read staples back (vault). */
function readStaples<T = any>(): T[] {
  return readNotes<T>(STAPLES_DIR);
}

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, category: 'Pantry', categoryConfirmed: true, staple: false,
  checked: false, addedAt: '2026-06-01T00:00:00Z', source: 'manual', ...extra,
});

beforeEach(() => {
  rm('carts.json'); rm('cart-request.json'); rm('product-map.json');
  writeGrocery([]); writeStaples([]);
});

describe('assembleCarts', () => {
  it('resolves product-mapped items instantly into a cart with a rebuilt cartUrl', async () => {
    writeGrocery([item('milk-1', 'Milk')]);
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
    writeGrocery([item('weird-1', 'Dragonfruit Paste')]);

    const result = await grocery.assembleCarts();
    expect(result).toMatchObject({ instant: 0, queued: 1 });
    expect(readJson('cart-request.json').itemIds).toEqual(['weird-1']);
    expect(existsSync(join(DIR, 'carts.json'))).toBe(false); // nothing instant — no write
  });

  it('never rebuilds lines already fully pushed to a retailer cart', async () => {
    writeGrocery([item('milk-1', 'Milk')]);
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
    writeGrocery([item('milk-1', 'Milk', { buyFrom: 'amazon' })]);
    writeJson('product-map.json', {
      milk: { retailer: 'walmart', productId: '111', productUrl: 'u', product: 'p' },
    });

    const result = await grocery.assembleCarts();
    expect(result).toMatchObject({ instant: 0, queued: 1 }); // goes to the agent instead
  });

  it('itemIds limits the build to a selection; checked items are always excluded', async () => {
    writeGrocery([
      item('a', 'Milk'),
      item('b', 'Bread'),
      item('c', 'Eggs', { checked: true }),
    ]);

    const result = await grocery.assembleCarts(['b', 'c']);
    expect(result).toMatchObject({ instant: 0, queued: 1 });
    expect(readJson('cart-request.json').itemIds).toEqual(['b']);
  });

  it('bare-integer quantities become purchase counts; unit quantities do not', async () => {
    writeGrocery([item('m', 'Milk', { quantity: '2' }), item('b', 'Beef', { quantity: '1 lb' })]);
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

describe('reconcileCartAdds', () => {
  const cartWith = (items: any[]) => ({
    builtAt: 'x',
    carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [], items }],
  });

  it('sets addedQty on confirmed lines and clears the rest', async () => {
    writeJson('carts.json', cartWith([
      { itemId: 'a', name: 'A', productId: '1', qty: 2 },
      { itemId: 'b', name: 'B', productId: '2', qty: 1 },
      { itemId: 'c', name: 'C', productId: '3', qty: 1, addedQty: 1 },
    ]));

    const res = await grocery.reconcileCartAdds('walmart', ['a']);
    expect(res).toMatchObject({ ok: true, inCart: 1 });

    const lines = readJson('carts.json').carts[0].items;
    expect(lines.find((l: any) => l.itemId === 'a').addedQty).toBe(2); // confirmed → qty
    expect(lines.find((l: any) => l.itemId === 'b').addedQty).toBeUndefined();
    expect(lines.find((l: any) => l.itemId === 'c').addedQty).toBeUndefined(); // previously added, now unconfirmed
  });

  it('a reconciled line is then excluded from a fresh build (no duplicate re-add)', async () => {
    writeGrocery([item('milk-1', 'Milk')]);
    writeJson('product-map.json', {
      milk: { retailer: 'walmart', productId: '111', productUrl: 'u', product: 'p' },
    });
    // First build resolves the line instantly
    await grocery.assembleCarts();
    // User confirms it landed in the real cart
    await grocery.reconcileCartAdds('walmart', ['milk-1']);
    // A subsequent build must not re-add it
    const again = await grocery.assembleCarts();
    expect(again).toMatchObject({ instant: 0, queued: 0 });
  });

  it('returns ok:false when the retailer cart does not exist', async () => {
    writeJson('carts.json', cartWith([{ itemId: 'a', name: 'A', productId: '1', qty: 1 }]));
    const res = await grocery.reconcileCartAdds('amazon', ['a']);
    expect(res.ok).toBe(false);
  });
});

describe('applyObservedCart', () => {
  it('marks observed lines in-cart, clears the rest, and reports unknowns', async () => {
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [], items: [
        { itemId: 'a', name: 'A', productId: '1', qty: 2 },
        { itemId: 'b', name: 'B', productId: '2', qty: 1, addedQty: 1 },
      ] }],
    });

    const res = await grocery.applyObservedCart('walmart', [{ productId: '1' }, { productId: '999' }]);
    expect(res).toMatchObject({ ok: true, inCart: 1, unknown: ['999'] });

    const lines = readJson('carts.json').carts[0].items;
    expect(lines.find((l: any) => l.itemId === 'a').addedQty).toBe(2); // observed → in cart
    expect(lines.find((l: any) => l.itemId === 'b').addedQty).toBeUndefined(); // absent → cleared
  });

  it('no-ops (ok, nothing in cart) when the retailer cart is missing — a live sync may run with no build', async () => {
    writeJson('carts.json', { builtAt: 'x', carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [], items: [] }] });
    const res = await grocery.applyObservedCart('amazon', [{ productId: '1' }]);
    expect(res).toMatchObject({ ok: true, inCart: 0, unknown: ['1'] });
  });
});

describe('adoptWalmartCartLine', () => {
  it('adds a list item already-in-cart, pins the product, and can make a staple', async () => {
    const res = await grocery.adoptWalmartCartLine({
      productId: '43984343', product: 'Fairlife 2% Milk', productUrl: 'https://www.walmart.com/ip/43984343',
      price: '$4.12', qty: 1, asStaple: true,
    });
    expect(res.ok).toBe(true);
    expect(res.itemId).toBeTruthy();

    // list item exists, flagged as a staple
    const item = readGrocery().find((i: any) => i.id === res.itemId);
    expect(item).toMatchObject({ name: 'Fairlife 2% Milk', staple: true, checked: false });

    // exact product pinned for future reorders
    expect(readJson('product-map.json')['fairlife 2% milk']).toMatchObject({
      retailer: 'walmart', productId: '43984343', pinned: true,
    });

    // a Walmart cart line, marked already-in-cart
    const cart = readJson('carts.json').carts.find((c: any) => c.retailer === 'walmart');
    const line = cart.items.find((m: any) => m.productId === '43984343');
    expect(line).toMatchObject({ itemId: res.itemId, addedQty: 1, qty: 1 });
    expect(cart.cartUrl).toContain('43984343');

    // staple created, stocked
    expect(readStaples().find((s: any) => s.name === 'Fairlife 2% Milk')).toMatchObject({ status: 'stocked' });
  });

  it('reuses an existing unchecked list item instead of duplicating', async () => {
    writeGrocery([
      { id: 'milk-1', name: 'milk', category: 'Dairy & Eggs', checked: false, addedAt: 'x', source: 'manual' },
    ]);
    const res = await grocery.adoptWalmartCartLine({ productId: '99', product: 'milk', qty: 2 });
    expect(res.itemId).toBe('milk-1');
    expect(readGrocery()).toHaveLength(1);
    const line = readJson('carts.json').carts[0].items.find((m: any) => m.productId === '99');
    expect(line).toMatchObject({ itemId: 'milk-1', addedQty: 2 });
  });
});

describe('defaultQty', () => {
  it('overrides the parsed free-form quantity at build time', async () => {
    writeGrocery([item('m', 'Milk', { quantity: '1 lb', defaultQty: 3 })]);
    writeJson('product-map.json', { milk: { retailer: 'walmart', productId: '1', productUrl: 'u', product: 'p' } });
    await grocery.assembleCarts();
    expect(readJson('carts.json').carts[0].items[0].qty).toBe(3);
  });
});

describe('learnProduct', () => {
  it('writes a learned (unpinned) entry but never overwrites a pin', () => {
    const map: any = { milk: { retailer: 'walmart', productId: 'PINNED', pinned: true } };
    expect(grocery.learnProduct(map, 'Milk', { retailer: 'walmart', productId: 'NEW' })).toBe(false);
    expect(map.milk.productId).toBe('PINNED');
    expect(grocery.learnProduct(map, 'Bread', { retailer: 'walmart', productId: 'B1', product: 'Loaf' })).toBe(true);
    expect(map.bread).toMatchObject({ productId: 'B1', pinned: false });
  });
});

describe('setPin', () => {
  it('pins a product by id (authoritative) — learning cannot overwrite it', async () => {
    await grocery.setPin('Milk', { retailer: 'walmart', productId: 'PIN1', product: 'Fairlife', productUrl: 'u' });
    expect(readJson('product-map.json').milk).toMatchObject({ productId: 'PIN1', pinned: true });
    // a later learned write is refused
    const map = readJson('product-map.json');
    expect(grocery.learnProduct(map, 'Milk', { retailer: 'walmart', productId: 'OTHER' })).toBe(false);
    expect(map.milk.productId).toBe('PIN1');
  });
});

describe('checkoutItems — confirmed-purchase learning', () => {
  it('learns the exact product from the built cart line', async () => {
    writeGrocery([item('milk-1', 'Milk')]);
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [],
        items: [{ itemId: 'milk-1', name: 'Milk', productId: '555', product: 'GV Milk', productUrl: 'u', qty: 1 }] }],
    });
    await grocery.checkoutItems(['milk-1'], 'walmart');
    expect(readJson('product-map.json').milk).toMatchObject({ productId: '555', pinned: false });
  });

  it('does not overwrite a pinned product on checkout', async () => {
    writeGrocery([item('milk-1', 'Milk')]);
    writeJson('product-map.json', { milk: { retailer: 'walmart', productId: 'PINNED', pinned: true } });
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [],
        items: [{ itemId: 'milk-1', name: 'Milk', productId: '555', qty: 1 }] }],
    });
    await grocery.checkoutItems(['milk-1'], 'walmart');
    expect(readJson('product-map.json').milk.productId).toBe('PINNED');
  });
});

describe('acceptSubstitute', () => {
  it('swaps an out-of-stock line to the chosen alternative and learns it', async () => {
    writeGrocery([item('df', 'Dragonfruit')]);
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [], items: [
        { itemId: 'df', name: 'Dragonfruit', productId: 'OOS1', product: 'Fresh Dragonfruit', qty: 1, status: 'out_of_stock',
          alternatives: [{ productId: 'ALT9', product: 'Dragonfruit (frozen)', price: '$6.00', productUrl: 'https://www.walmart.com/ip/ALT9' }] },
      ] }],
    });

    const res = await grocery.acceptSubstitute('walmart', 'df', 'ALT9');
    expect(res.ok).toBe(true);

    const line = readJson('carts.json').carts[0].items[0];
    expect(line.productId).toBe('ALT9');
    expect(line.status).toBe('ok');
    expect(line.substituted).toBe(true);
    expect(line.alternatives).toBeUndefined();
    expect(line.addedQty).toBeUndefined();
    // remembered for next time, as a learned (unpinned) product
    expect(readJson('product-map.json').dragonfruit).toMatchObject({ productId: 'ALT9', pinned: false });
  });

  it('returns ok:false for an unknown alternative', async () => {
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [], items: [
        { itemId: 'df', name: 'Dragonfruit', productId: 'OOS1', qty: 1, status: 'out_of_stock', alternatives: [] },
      ] }],
    });
    expect((await grocery.acceptSubstitute('walmart', 'df', 'NOPE')).ok).toBe(false);
  });
});

describe('changeCartLineProduct', () => {
  it('swaps a line to a pasted product URL and pins it', async () => {
    writeGrocery([item('milk-1', 'Milk')]);
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [], items: [
        { itemId: 'milk-1', name: 'Milk', productId: 'OLD', product: 'Wrong Milk', qty: 1, addedQty: 1 },
      ] }],
    });

    const res = await grocery.changeCartLineProduct('walmart', 'milk-1', 'https://www.walmart.com/ip/Some-Slug/998877');
    expect(res.ok).toBe(true);

    const line = readJson('carts.json').carts[0].items[0];
    expect(line.productId).toBe('998877');
    expect(line.substituted).toBe(true);
    expect(line.addedQty).toBeUndefined();
    expect(readJson('product-map.json').milk).toMatchObject({ productId: '998877', pinned: true });
  });

  it('rejects an unparseable or wrong-retailer URL', async () => {
    writeJson('carts.json', {
      builtAt: 'x',
      carts: [{ retailer: 'walmart', label: 'Walmart', unmatched: [], items: [{ itemId: 'm', name: 'M', productId: '1', qty: 1 }] }],
    });
    expect((await grocery.changeCartLineProduct('walmart', 'm', 'not a url')).error).toBe('unparseable');
    expect((await grocery.changeCartLineProduct('walmart', 'm', 'https://www.amazon.com/dp/B0ABCDEFGH')).error).toBe('retailer-mismatch');
  });
});

describe('loadGroceryState — unavailable/refunded scan', () => {
  it('re-adds an unavailable item, refunds its purchase, and resets the staple', async () => {
    writeGrocery([]);
    writeStaples([{ id: 'bb', name: 'blackberries', category: 'Produce', status: 'stocked', lastPurchased: '2026-06-04' }]);
    writeJson('purchases.json', { purchases: [{ date: '2026-06-04', name: 'blackberries', source: 'walmart', orderId: 'O1' }] });
    writeJson('.scan-results.json', { unavailable: [{ name: 'blackberries', orderId: 'O1', date: '2026-06-04' }] });

    const state = await grocery.loadGroceryState();
    expect(state.items.some(i => i.name === 'blackberries' && i.source === 'scan')).toBe(true);
    expect(readJson('purchases.json').purchases[0].refunded).toBe(true);
    const s = readStaples()[0];
    expect(s.status).toBe('out');
    expect(s.lastPurchased).toBeUndefined();
    expect(existsSync(join(DIR, '.scan-results.json'))).toBe(false);
  });

  it('a buy then refund in the same scan nets the item back on the list', async () => {
    writeGrocery([item('m', 'Milk')]);
    writeStaples([]);
    writeJson('purchases.json', { purchases: [] });
    writeJson('.scan-results.json', {
      purchases: [{ name: 'Milk', retailer: 'walmart', orderId: 'O2', date: '2026-06-05', matchedItemIds: ['m'] }],
      unavailable: [{ name: 'Milk', orderId: 'O2', date: '2026-06-05' }],
    });

    const state = await grocery.loadGroceryState();
    expect(state.items.some(i => i.name.toLowerCase() === 'milk')).toBe(true);
    const rec = readJson('purchases.json').purchases.find((r: any) => r.orderId === 'O2');
    expect(rec?.refunded).toBe(true);
  });
});

describe('applyOrderHistory', () => {
  it('adds new products, dedupes by productId, and keeps the newest lastOrdered', async () => {
    rm('order-history.json');
    let r = await grocery.applyOrderHistory('walmart', [
      { productId: '1', product: 'Fairlife 2% 52oz', productUrl: 'u1', lastOrdered: '2026-05-01' },
      { productId: '2', product: 'Paper Plates 200ct' },
    ]);
    expect(r).toMatchObject({ added: 2, updated: 0, total: 2 });

    r = await grocery.applyOrderHistory('walmart', [
      { productId: '1', product: 'Fairlife 2% 52oz', lastOrdered: '2026-06-01' }, // newer
    ]);
    expect(r).toMatchObject({ added: 0, updated: 1, total: 2 });
    expect(readJson('order-history.json').products.find((p: any) => p.productId === '1').lastOrdered).toBe('2026-06-01');
  });

  it('skips entries missing productId or product', async () => {
    rm('order-history.json');
    const r = await grocery.applyOrderHistory('walmart', [{ productId: '', product: 'x' }, { productId: '9' } as any]);
    expect(r.total).toBe(0);
  });
});

describe('loadCarts', () => {
  it('normalizes agent-written carts that omit items/unmatched arrays', async () => {
    // The /build-carts agent writes carts.json directly and may leave out
    // arrays it has nothing for — loadCarts must default them.
    writeJson('carts.json', {
      builtAt: '2026-06-06T14:27:30.000Z',
      carts: [{ retailer: 'walmart', label: 'Walmart', items: [{ itemId: 'x', name: 'X' }] }],
    });
    const data = await grocery.loadCarts();
    expect(data?.carts[0].unmatched).toEqual([]);
    expect(data?.carts[0].items).toHaveLength(1);
  });
});
