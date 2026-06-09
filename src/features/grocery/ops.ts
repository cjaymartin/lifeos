// Server-only helpers for the Grocery stack — do NOT import from client
// components; browser-safe types/constants are in src/lib/grocery-types.ts.
import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type {
  CartMatch, CartsData, GroceryData, GroceryItem, GroceryState, ProductRef, PurchaseRecord, Retailer, Staple,
} from '@/features/grocery/types';
import { buildAddToCartUrl, normalizeName, RETAILER_LABELS } from '@/features/grocery/types';

export type * from '@/features/grocery/types';

const DIR = join(process.cwd(), 'src/content/grocery');
export const GROCERY_FILE = join(DIR, 'grocery.json');
export const STAPLES_FILE = join(DIR, 'staples.json');
export const CARTS_FILE = join(DIR, 'carts.json');
export const PURCHASES_FILE = join(DIR, 'purchases.json');
export const PRODUCT_MAP_FILE = join(DIR, 'product-map.json');
// Optional per-build item selection, written by the build-carts API and read
// by the /build-carts skill (absent → build for all unchecked items)
export const CART_REQUEST_FILE = join(DIR, 'cart-request.json');
// Agent output files (dot-prefixed → hidden from the stack chat's content dump).
// The micro-agents write these instead of the main files so all merging of
// concurrent user edits happens here, in one place.
export const CATEGORIZED_FILE = join(DIR, '.categorized.json');
export const SCAN_RESULTS_FILE = join(DIR, '.scan-results.json');

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf-8')) as T; } catch { return null; }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

export async function loadGrocery(): Promise<GroceryData> {
  return (await readJson<GroceryData>(GROCERY_FILE)) ?? { lastUpdated: '', items: [] };
}

export async function saveGrocery(data: GroceryData): Promise<void> {
  data.lastUpdated = new Date().toISOString();
  await writeJson(GROCERY_FILE, data);
}

export async function loadStaples(): Promise<Staple[]> {
  return (await readJson<{ staples: Staple[] }>(STAPLES_FILE))?.staples ?? [];
}

export async function saveStaples(staples: Staple[]): Promise<void> {
  await writeJson(STAPLES_FILE, { staples });
}

export async function loadCarts(): Promise<CartsData | null> {
  const data = await readJson<CartsData>(CARTS_FILE);
  if (!data) return null;
  // carts.json is also written by the /build-carts agent, which may omit
  // arrays it has nothing for — normalize so consumers can index them safely.
  data.carts = (data.carts ?? []).map(c => ({ ...c, items: c.items ?? [], unmatched: c.unmatched ?? [] }));
  return data;
}

export async function saveCarts(carts: CartsData | null): Promise<void> {
  if (carts) await writeJson(CARTS_FILE, carts);
  else { try { await unlink(CARTS_FILE); } catch {} }
}

export async function loadProductMap(): Promise<Record<string, ProductRef>> {
  return (await readJson<Record<string, ProductRef>>(PRODUCT_MAP_FILE)) ?? {};
}

export async function saveProductMap(map: Record<string, ProductRef>): Promise<void> {
  await writeJson(PRODUCT_MAP_FILE, map);
}

/** Parse a Walmart/Amazon product URL into a ProductRef (null if unrecognized). */
export function parseProductUrl(url: string): Omit<ProductRef, 'pinned'> | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host.endsWith('walmart.com')) {
    const m = u.pathname.match(/\/ip\/(?:.*\/)?(\d{5,})(?:$|\/)/);
    if (m) return { retailer: 'walmart' as Retailer, productId: m[1], productUrl: `https://www.walmart.com/ip/${m[1]}` };
  }
  if (host.endsWith('amazon.com')) {
    const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:$|\/)/i);
    if (m) {
      const asin = m[1].toUpperCase();
      return { retailer: 'amazon' as Retailer, productId: asin, productUrl: `https://www.amazon.com/dp/${asin}` };
    }
  }
  return null;
}

/** Rebuild a retailer's full bulk add-to-cart URL from its matched productIds. */
export function rebuildCartUrl(cart: { retailer: string; items: { productId?: string; qty?: number }[] }): string | undefined {
  return buildAddToCartUrl(
    cart.retailer as Retailer,
    cart.items.filter((m): m is { productId: string; qty?: number } => !!m.productId),
  );
}

export async function appendPurchases(records: PurchaseRecord[]): Promise<void> {
  if (records.length === 0) return;
  const data = (await readJson<{ purchases: PurchaseRecord[] }>(PURCHASES_FILE)) ?? { purchases: [] };
  data.purchases.push(...records);
  await writeJson(PURCHASES_FILE, data);
}

export function makeItemId(name: string): string {
  const slug = normalizeName(name).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'item';
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ── Heuristic categorizer ─────────────────────────────────────────────────
   Instant keyword match on add; anything that lands in "Other" gets
   categoryConfirmed: false and the categorize micro-agent takes a pass. */

const KEYWORD_CATEGORIES: [string, string[]][] = [
  ['Produce', ['apple', 'banana', 'orange', 'lemon', 'lime', 'grape', 'berr', 'strawberr', 'blueberr', 'melon', 'avocado', 'tomato', 'potato', 'onion', 'garlic', 'lettuce', 'spinach', 'kale', 'carrot', 'celery', 'cucumber', 'pepper', 'broccoli', 'cauliflower', 'zucchini', 'squash', 'mushroom', 'cilantro', 'parsley', 'basil', 'ginger', 'corn', 'peach', 'pear', 'plum', 'mango', 'pineapple', 'cabbage', 'asparagus', 'green bean', 'scallion', 'herb', 'salad', 'fruit']],
  ['Meat & Seafood', ['chicken', 'beef', 'steak', 'pork', 'bacon', 'sausage', 'turkey', 'ham', 'lamb', 'ground', 'salmon', 'tuna', 'shrimp', 'fish', 'cod', 'tilapia', 'scallop', 'crab', 'lobster', 'hot dog', 'brisket', 'ribs', 'meatball', 'deli', 'pepperoni', 'salami']],
  ['Dairy & Eggs', ['milk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'yogurt', 'butter', 'cream', 'egg', 'half and half', 'half-and-half', 'sour cream', 'cottage', 'cream cheese', 'oat milk', 'almond milk']],
  ['Bakery', ['bread', 'bagel', 'bun', 'roll', 'tortilla', 'pita', 'croissant', 'muffin', 'cake', 'donut', 'baguette', 'english muffin']],
  ['Pantry', ['rice', 'pasta', 'noodle', 'flour', 'sugar', 'salt', 'oil', 'olive oil', 'vinegar', 'sauce', 'salsa', 'ketchup', 'mustard', 'mayo', 'bean', 'lentil', 'soup', 'broth', 'stock', 'cereal', 'oat', 'peanut butter', 'jelly', 'jam', 'honey', 'syrup', 'spice', 'seasoning', 'can ', 'canned', 'tomato paste', 'tuna can', 'cracker', 'dressing', 'baking', 'vanilla', 'chocolate chip', 'taco shell', 'mac and cheese', 'ramen']],
  ['Frozen', ['frozen', 'ice cream', 'pizza', 'popsicle', 'waffles', 'fries', 'nugget', 'ice']],
  ['Beverages', ['water', 'soda', 'juice', 'coffee', 'tea', 'beer', 'wine', 'kombucha', 'sparkling', 'lemonade', 'gatorade', 'energy drink', 'cola', 'seltzer']],
  ['Snacks', ['chip', 'pretzel', 'popcorn', 'candy', 'cookie', 'granola bar', 'trail mix', 'nuts', 'almond', 'cashew', 'snack', 'gummy', 'fruit snack', 'goldfish']],
  ['Household', ['paper towel', 'toilet paper', 'trash bag', 'garbage bag', 'dish soap', 'detergent', 'laundry', 'sponge', 'cleaner', 'bleach', 'wipes', 'foil', 'plastic wrap', 'ziploc', 'storage bag', 'batteries', 'light bulb', 'napkin', 'air freshener', 'swiffer', 'dishwasher']],
  ['Personal Care', ['shampoo', 'conditioner', 'soap', 'body wash', 'toothpaste', 'toothbrush', 'deodorant', 'razor', 'shaving', 'lotion', 'sunscreen', 'floss', 'mouthwash', 'tylenol', 'advil', 'ibuprofen', 'vitamin', 'band-aid', 'medicine', 'allergy', 'q-tip', 'tissue', 'kleenex']],
];

/** Returns [category, confirmed] — confirmed false means the micro-agent should look. */
export function categorizeHeuristic(name: string): [string, boolean] {
  const n = ` ${normalizeName(name)} `;
  for (const [category, keywords] of KEYWORD_CATEGORIES) {
    if (keywords.some(k => n.includes(k))) return [category, true];
  }
  return ['Other', false];
}

/* ── Reconcile pending agent output ────────────────────────────────────────
   Micro-agents drop results into dot-files; every GET /api/grocery applies
   them here so user edits and agent output never race on the same file. */

interface ScanResults {
  purchases: {
    name: string;
    retailer: 'walmart' | 'amazon';
    orderId?: string;
    date?: string;
    /** ids from grocery.json the agent matched this purchase to */
    matchedItemIds?: string[];
  }[];
}

export async function loadGroceryState(): Promise<GroceryState> {
  const [grocery, staples, carts, productMap] = await Promise.all([
    loadGrocery(), loadStaples(), loadCarts(), loadProductMap(),
  ]);
  let groceryDirty = false;
  let staplesDirty = false;

  // 1. Apply micro-agent category assignments
  const categorized = await readJson<Record<string, string>>(CATEGORIZED_FILE);
  if (categorized) {
    for (const item of grocery.items) {
      const cat = categorized[item.id];
      if (cat && !item.categoryConfirmed) {
        item.category = cat;
        item.categoryConfirmed = true;
        groceryDirty = true;
      }
    }
    try { await unlink(CATEGORIZED_FILE); } catch {}
  }

  // 2. Apply Gmail purchase-scan results: remove purchased items, restock staples
  const scan = await readJson<ScanResults>(SCAN_RESULTS_FILE);
  if (scan?.purchases?.length) {
    const today = new Date().toISOString().slice(0, 10);
    const records: PurchaseRecord[] = [];
    for (const p of scan.purchases) {
      const ids = new Set(p.matchedItemIds ?? []);
      const matched = grocery.items.filter(i => ids.has(i.id) || normalizeName(i.name) === normalizeName(p.name));
      for (const item of matched) {
        grocery.items = grocery.items.filter(i => i.id !== item.id);
        groceryDirty = true;
        records.push({ date: p.date ?? today, name: item.name, quantity: item.quantity, source: p.retailer, orderId: p.orderId });
        const staple = staples.find(s => normalizeName(s.name) === normalizeName(item.name));
        if (staple) {
          staple.status = 'stocked';
          staple.lastPurchased = p.date ?? today;
          staplesDirty = true;
        }
      }
    }
    await appendPurchases(records);
    try { await unlink(SCAN_RESULTS_FILE); } catch {}
  }

  if (groceryDirty) await saveGrocery(grocery);
  if (staplesDirty) await saveStaples(staples);

  return { lastUpdated: grocery.lastUpdated, items: grocery.items, staples, carts, productMap };
}

/* ── Cart assembly ─────────────────────────────────────────────────────────
   The build-carts entry point. Resolves what it can instantly from the
   product memory; queues only unknown items for the /build-carts agent via
   cart-request.json. The API route stays a thin seam over this. */

/** "2" → 2; "1 lb" / "2 dozen" → 1 (only bare integers are purchase counts) */
function countQty(quantity?: string): number {
  return quantity && /^\d+$/.test(quantity.trim()) ? Math.max(1, parseInt(quantity, 10)) : 1;
}

export interface CartAssembly {
  /** Lines resolved instantly from the product memory (no agent). */
  instant: number;
  /** Items handed to the /build-carts agent via cart-request.json. */
  queued: number;
  /** The queued items' ids (already written to cart-request.json). */
  agentItemIds: string[];
}

/**
 * Assemble retailer carts for the unchecked list (optionally limited to
 * `itemIds`):
 * - Items already fully pushed to a retailer cart (addedQty >= qty) are
 *   always excluded — building never re-adds what's in the cart.
 * - Items with a product-map entry (pinned or learned) are resolved INSTANTLY
 *   — the map caches productIds exactly for this. A buyFrom preference
 *   overrides a cached product at the other retailer.
 * - Only unknown items are queued for the agent (cart-request.json is always
 *   rewritten so stale selections never leak into a later run).
 */
export async function assembleCarts(itemIds?: string[]): Promise<CartAssembly> {
  const [grocery, prevCarts, productMap] = await Promise.all([
    loadGrocery(), loadCarts(), loadProductMap(),
  ]);

  // Never rebuild lines that are already in the real retailer cart
  const inCart = new Set<string>();
  for (const c of prevCarts?.carts ?? [])
    for (const m of c.items)
      if (m.productId && (m.addedQty ?? 0) >= (m.qty ?? 1)) inCart.add(m.itemId);

  let targets = grocery.items.filter(i => !i.checked && !inCart.has(i.id));
  if (itemIds?.length) {
    const sel = new Set(itemIds.map(String));
    targets = targets.filter(i => sel.has(i.id));
  }

  // Instant resolution from the product memory
  const agentItems: GroceryItem[] = [];
  const carts: CartsData = prevCarts ?? { builtAt: '', carts: [] };
  let instant = 0;

  for (const item of targets) {
    const ref = productMap[normalizeName(item.name)];
    if (!ref) { agentItems.push(item); continue; }
    // A buyFrom preference overrides a cached product at the other retailer
    if (item.buyFrom && ref.retailer !== item.buyFrom) { agentItems.push(item); continue; }

    let cart = carts.carts.find(c => c.retailer === ref.retailer);
    if (!cart) {
      cart = { retailer: ref.retailer, label: RETAILER_LABELS[ref.retailer], items: [], unmatched: [] };
      carts.carts.push(cart);
    }
    const line: CartMatch = {
      itemId: item.id,
      name: item.name,
      product: ref.product,
      productUrl: ref.productUrl,
      productId: ref.productId,
      qty: countQty(item.quantity),
      confidence: 'high',
      source: 'reorder',
    };
    const idx = cart.items.findIndex(m => m.itemId === item.id);
    // Spread keeps addedQty on a partially-added line (line has no addedQty key)
    if (idx >= 0) cart.items[idx] = { ...cart.items[idx], ...line };
    else cart.items.push(line);
    instant++;
  }

  if (instant > 0) {
    for (const c of carts.carts) c.cartUrl = rebuildCartUrl(c);
    carts.builtAt = new Date().toISOString();
    await saveCarts(carts);
  }

  if (agentItems.length > 0) {
    // Stale selections must never leak into a later run — always rewritten
    await writeJson(CART_REQUEST_FILE, { itemIds: agentItems.map(i => i.id) });
  } else {
    try { await unlink(CART_REQUEST_FILE); } catch {}
  }

  return { instant, queued: agentItems.length, agentItemIds: agentItems.map(i => i.id) };
}

/* ── Reconcile what actually landed in the retailer cart ───────────────────
   We can't read the user's real cart (hard rule: no login), so after the
   add-to-cart handoff the user tells us which lines made it. `addedItemIds`
   is the authoritative set of lines now in the retailer cart: each gets
   addedQty = qty (so a later build excludes it → no duplicate re-adds); every
   other matched line in that cart is cleared back to pending. Replaces the old
   blanket all-or-nothing mark-added with per-line truth. */
export async function reconcileCartAdds(
  retailer: Retailer,
  addedItemIds: string[],
): Promise<{ ok: boolean; inCart: number }> {
  const carts = await loadCarts();
  const cart = carts?.carts.find(c => c.retailer === retailer);
  if (!carts || !cart) return { ok: false, inCart: 0 };

  const added = new Set(addedItemIds.map(String));
  let inCart = 0;
  for (const m of cart.items) {
    if (!m.productId) continue;
    if (added.has(m.itemId)) { m.addedQty = m.qty ?? 1; inCart++; }
    else delete m.addedQty;
  }
  await saveCarts(carts);
  return { ok: true, inCart };
}

/* ── Checkout ──────────────────────────────────────────────────────────────
   Remove purchased items from the list, restock matching staples, and log
   to purchases.json. Used by the cart "I checked out" buttons and the
   in-store "Clear checked" action. */

export async function checkoutItems(
  itemIds: string[],
  source: PurchaseRecord['source'],
): Promise<{ removed: number }> {
  const [grocery, staples] = await Promise.all([loadGrocery(), loadStaples()]);
  const ids = new Set(itemIds);
  const removed = grocery.items.filter(i => ids.has(i.id));
  if (removed.length === 0) return { removed: 0 };

  grocery.items = grocery.items.filter(i => !ids.has(i.id));
  const today = new Date().toISOString().slice(0, 10);
  let staplesDirty = false;
  for (const item of removed) {
    const staple = staples.find(s => normalizeName(s.name) === normalizeName(item.name));
    if (staple) {
      staple.status = 'stocked';
      staple.lastPurchased = today;
      staplesDirty = true;
    }
  }

  await saveGrocery(grocery);
  if (staplesDirty) await saveStaples(staples);
  await appendPurchases(removed.map(i => ({
    date: today, name: i.name, quantity: i.quantity, source,
  })));
  return { removed: removed.length };
}

/** Ensure a staple's list presence matches its status and restock policy
 *  ('low' = re-add at Low or Out, 'out' = only at Out, 'never' = never). */
export async function syncStapleToList(staple: Staple, grocery: GroceryData): Promise<boolean> {
  const norm = normalizeName(staple.name);
  const restock = staple.restockAt ?? 'low';
  const shouldBeOnList =
    staple.status === 'out' ? restock !== 'never'
    : staple.status === 'low' ? restock === 'low'
    : false;

  if (!shouldBeOnList) {
    // Remove only items the staple system itself auto-added
    const before = grocery.items.length;
    grocery.items = grocery.items.filter(i => !(normalizeName(i.name) === norm && i.source === 'staple' && !i.checked));
    return grocery.items.length !== before;
  }

  const existing = grocery.items.find(i => normalizeName(i.name) === norm && !i.checked);
  if (!existing) {
    grocery.items.push({
      id: makeItemId(staple.name),
      name: staple.name,
      category: staple.category,
      categoryConfirmed: true,
      staple: true,
      checked: false,
      addedAt: new Date().toISOString(),
      source: 'staple',
      note: staple.status === 'low' ? 'running low' : undefined,
      buyFrom: staple.buyFrom,
    } satisfies GroceryItem);
    return true;
  }
  return false;
}

/** Carry a product-map entry (pin) along when an item/staple is renamed. */
export async function renameInProductMap(oldName: string, newName: string): Promise<void> {
  const from = normalizeName(oldName);
  const to = normalizeName(newName);
  if (from === to) return;
  const map = await loadProductMap();
  if (!map[from] || map[to]) return; // nothing to move, or target already has its own pin
  map[to] = map[from];
  delete map[from];
  await saveProductMap(map);
}
