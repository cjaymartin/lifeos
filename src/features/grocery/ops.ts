// Server-only helpers for the Grocery stack — do NOT import from client
// components; browser-safe types/constants are in src/lib/grocery-types.ts.
import { readFile, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { writeJson } from '@/lib/content-store';
import { readCollection, writeCollection, noteStem } from '@/lib/markdown-store';
import { contentPath, vaultPath } from '@/lib/content-paths';
import type {
  CartMatch, CartsData, GroceryData, GroceryItem, GroceryState, OrderHistory, OrderedProduct, ProductRef, PurchaseRecord, Retailer, Staple, WalmartCartLine,
} from '@/features/grocery/types';
import { buildAddToCartUrl, normalizeName, RETAILER_LABELS, DEFAULT_CATEGORIES } from '@/features/grocery/types';

export type * from '@/features/grocery/types';

const DIR = contentPath('grocery');
// The grocery list + staples are human content — one Markdown note per item in
// the vault. Everything else here (carts, purchases, product-map, category-map,
// order-history, dot-files) is machine/derived state and stays JSON in DIR.
export const GROCERY_DIR = vaultPath('grocery', 'list');
export const STAPLES_DIR = vaultPath('grocery', 'staples');
export const CARTS_FILE = join(DIR, 'carts.json');
export const PURCHASES_FILE = join(DIR, 'purchases.json');
export const PRODUCT_MAP_FILE = join(DIR, 'product-map.json');
// Learned category memory: normalized item name → category. Consulted before
// the keyword heuristic; written on user override and agent confirmation.
export const CATEGORY_MAP_FILE = join(DIR, 'category-map.json');
// Past-purchased products captured from Walmart order history by the browser
// extension. build-carts greps this locally to reorder exact products.
export const ORDER_HISTORY_FILE = join(DIR, 'order-history.json');
// One-shot marker so the "re-file existing Other staples" migration runs once.
const CATEGORIES_MIGRATED_FILE = join(DIR, '.categories-migrated');
// Last-observed REAL Walmart cart, persisted from the extension push
// (content-cart.js) and the on-demand get-cart sync. The live panel reads this
// on page load so the cart shows without a manual Sync. Dot-prefixed → machine
// state, hidden from the stack chat's content dump.
export const LIVE_CART_FILE = join(DIR, '.live-cart.json');
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

/** Newest note mtime in a collection dir as an ISO string ('' if empty). */
async function newestMtime(paths: string[]): Promise<string> {
  let newest = '';
  for (const p of paths) {
    try {
      const m = (await stat(p)).mtime.toISOString();
      if (m > newest) newest = m;
    } catch {}
  }
  return newest;
}

/** Turn a filename stem ("whole-milk") into a display name ("Whole Milk"). */
const titleizeSlug = (stem: string): string =>
  stem.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || 'Untitled';

/** Coerce a note (possibly hand-authored in Obsidian) into a complete GroceryItem.
 *  Missing id/name fall back to the filename so a note dropped into the vault by
 *  hand still loads; required flags get sane defaults. */
function normalizeGroceryNote(data: Partial<GroceryItem>, file: string): GroceryItem {
  const stem = noteStem(file);
  return {
    category: 'Other',
    checked: false,
    source: 'manual',
    addedAt: '',
    ...data,
    id: data.id || stem,
    name: (data.name ?? '').trim() || titleizeSlug(stem),
  } as GroceryItem;
}

/** Coerce a note into a complete Staple, filling id/name/defaults for hand notes. */
function normalizeStapleNote(data: Partial<Staple>, file: string): Staple {
  const stem = noteStem(file);
  return {
    category: 'Other',
    status: 'stocked',
    ...data,
    id: data.id || stem,
    name: (data.name ?? '').trim() || titleizeSlug(stem),
  } as Staple;
}

export async function loadGrocery(): Promise<GroceryData> {
  const notes = await readCollection<Partial<GroceryItem>>(GROCERY_DIR);
  const items = notes
    .map(n => normalizeGroceryNote(n.data, n.file))
    .sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? '') || (a.id ?? '').localeCompare(b.id ?? ''));
  const lastUpdated = await newestMtime(notes.map(n => n.path));
  return { lastUpdated, items };
}

export async function saveGrocery(data: GroceryData): Promise<void> {
  data.lastUpdated = new Date().toISOString();
  await writeCollection(GROCERY_DIR, data.items, i => i.name, { id: i => i.id });
}

export async function loadStaples(): Promise<Staple[]> {
  const notes = await readCollection<Partial<Staple>>(STAPLES_DIR);
  return notes
    .map(n => normalizeStapleNote(n.data, n.file))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || (a.id ?? '').localeCompare(b.id ?? ''));
}

export async function saveStaples(staples: Staple[]): Promise<void> {
  await writeCollection(STAPLES_DIR, staples, s => s.name, { id: s => s.id });
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

interface LiveCartStore {
  observedAt: string;
  items: WalmartCartLine[];
}

/** Last-observed real Walmart cart (null if never observed). */
export async function loadLiveCart(): Promise<WalmartCartLine[] | null> {
  const data = await readJson<LiveCartStore>(LIVE_CART_FILE);
  return data?.items ?? null;
}

/** Persist the real Walmart cart as last observed. Called whenever a live cart
 *  crosses the wire — the extension push (content-cart.js) or an on-demand
 *  get-cart sync — so the UI can show it on next load without a manual Sync. */
export async function saveLiveCart(items: WalmartCartLine[]): Promise<void> {
  await writeJson(LIVE_CART_FILE, { observedAt: new Date().toISOString(), items });
}

export async function loadProductMap(): Promise<Record<string, ProductRef>> {
  return (await readJson<Record<string, ProductRef>>(PRODUCT_MAP_FILE)) ?? {};
}

export async function saveProductMap(map: Record<string, ProductRef>): Promise<void> {
  await writeJson(PRODUCT_MAP_FILE, map);
}

/** Pin an exact product to an item name by id (authoritative — agents and
 *  learned writes never override a pin). Used by the one-click "Always use
 *  this" on a cart line and the paste-a-URL flow. */
export async function setPin(
  name: string,
  ref: { retailer: Retailer; productId: string; product?: string; productUrl?: string },
): Promise<ProductRef> {
  const map = await loadProductMap();
  const pin: ProductRef = {
    retailer: ref.retailer, productId: ref.productId,
    product: ref.product, productUrl: ref.productUrl, pinned: true,
  };
  map[normalizeName(name)] = pin;
  await saveProductMap(map);
  return pin;
}

export async function loadOrderHistory(): Promise<OrderHistory> {
  return (await readJson<OrderHistory>(ORDER_HISTORY_FILE)) ?? { syncedAt: '', products: [] };
}

export async function saveOrderHistory(history: OrderHistory): Promise<void> {
  await writeJson(ORDER_HISTORY_FILE, history);
}

/** Merge products captured from order history (extension) into the local
 *  catalog, deduped by productId — newest lastOrdered wins. The build-carts
 *  agent greps this instead of Gmail. */
export async function applyOrderHistory(
  retailer: Retailer,
  products: { productId: string; product: string; productUrl?: string; lastOrdered?: string }[],
): Promise<{ added: number; updated: number; total: number }> {
  const history = await loadOrderHistory();
  const byId = new Map(history.products.map(p => [p.productId, p]));
  let added = 0, updated = 0;
  for (const p of products) {
    const productId = String(p.productId ?? '').trim();
    const product = String(p.product ?? '').trim();
    if (!productId || !product) continue;
    const existing = byId.get(productId);
    if (existing) {
      existing.product = product || existing.product;
      if (p.productUrl) existing.productUrl = p.productUrl;
      if (p.lastOrdered && (!existing.lastOrdered || p.lastOrdered > existing.lastOrdered)) existing.lastOrdered = p.lastOrdered;
      updated++;
    } else {
      const np: OrderedProduct = { retailer, productId, product, productUrl: p.productUrl, lastOrdered: p.lastOrdered };
      byId.set(productId, np);
      history.products.push(np);
      added++;
    }
  }
  history.syncedAt = new Date().toISOString();
  await saveOrderHistory(history);
  return { added, updated, total: history.products.length };
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
  ['Household', ['paper towel', 'toilet paper', 'trash bag', 'garbage bag', 'dish soap', 'detergent', 'laundry', 'sponge', 'cleaner', 'bleach', 'wipes', 'foil', 'plastic wrap', 'ziploc', 'storage bag', 'batteries', 'light bulb', 'napkin', 'air freshener', 'swiffer', 'dishwasher', 'paper plate', 'paper bowl', 'plate', 'bowl', 'cup', 'cutlery', 'fork', 'spoon', 'knife', 'straw', 'utensil']],
  ['Personal Care', ['shampoo', 'conditioner', 'soap', 'body wash', 'toothpaste', 'toothbrush', 'deodorant', 'razor', 'shaving', 'lotion', 'sunscreen', 'floss', 'mouthwash', 'tylenol', 'advil', 'ibuprofen', 'ibuprofin', 'acetaminophen', 'aspirin', 'antacid', 'psyllium', 'fiber', 'supplement', 'probiotic', 'vitamin', 'band-aid', 'bandage', 'medicine', 'allergy', 'q-tip', 'tissue', 'kleenex']],
];

/** Returns [category, confirmed] — confirmed false means the micro-agent should look. */
export function categorizeHeuristic(name: string): [string, boolean] {
  const n = ` ${normalizeName(name)} `;
  for (const [category, keywords] of KEYWORD_CATEGORIES) {
    if (keywords.some(k => n.includes(k))) return [category, true];
  }
  return ['Other', false];
}

export async function loadCategoryMap(): Promise<Record<string, string>> {
  return (await readJson<Record<string, string>>(CATEGORY_MAP_FILE)) ?? {};
}

export async function saveCategoryMap(map: Record<string, string>): Promise<void> {
  await writeJson(CATEGORY_MAP_FILE, map);
}

/** Resolve a category: a learned override wins (confirmed), else the keyword
 *  heuristic, else ['Other', false] → the categorize micro-agent takes a pass. */
export function resolveCategory(name: string, categoryMap: Record<string, string>): [string, boolean] {
  const learned = categoryMap[normalizeName(name)];
  if (learned && (DEFAULT_CATEGORIES as readonly string[]).includes(learned)) return [learned, true];
  return categorizeHeuristic(name);
}

/** Persist a user/agent category decision so the same name is decided once. */
export async function learnCategory(name: string, category: string): Promise<void> {
  if (!(DEFAULT_CATEGORIES as readonly string[]).includes(category)) return;
  const map = await loadCategoryMap();
  const key = normalizeName(name);
  if (map[key] === category) return;
  map[key] = category;
  await saveCategoryMap(map);
}

/** One-time, idempotent: re-file staples sitting in "Other" that the resolver
 *  can now place (the root cause of milk/paper-plates/psyllium reading "Other").
 *  Guarded by a marker file so it never fights a deliberate later choice. */
async function migrateStapleCategories(): Promise<void> {
  if (await readJson<unknown>(CATEGORIES_MIGRATED_FILE) !== null) return;
  const [staples, categoryMap] = await Promise.all([loadStaples(), loadCategoryMap()]);
  let dirty = false;
  for (const s of staples) {
    if (s.category !== 'Other') continue;
    const [cat, confirmed] = resolveCategory(s.name, categoryMap);
    if (confirmed && cat !== 'Other') { s.category = cat; dirty = true; }
  }
  if (dirty) await saveStaples(staples);
  await writeJson(CATEGORIES_MIGRATED_FILE, { migratedAt: new Date().toISOString() });
}

/* ── Reconcile pending agent output ────────────────────────────────────────
   Micro-agents drop results into dot-files; every GET /api/grocery applies
   them here so user edits and agent output never race on the same file. */

interface ScanResults {
  purchases?: {
    name: string;
    retailer: 'walmart' | 'amazon';
    orderId?: string;
    date?: string;
    /** ids from grocery.json the agent matched this purchase to */
    matchedItemIds?: string[];
  }[];
  /** Items an order email says were unavailable/refunded/not fulfilled */
  unavailable?: {
    name: string;
    orderId?: string;
    date?: string;
    matchedItemIds?: string[];
  }[];
}

/** Mark purchase-log records refunded (matched by name, and orderId when given).
 *  Returns the dates of the records it flipped, so a falsely-set staple
 *  lastPurchased from that same order can be cleared. */
async function markPurchasesRefunded(items: { name: string; orderId?: string }[]): Promise<Set<string>> {
  const data = await readJson<{ purchases: PurchaseRecord[] }>(PURCHASES_FILE);
  const dates = new Set<string>();
  if (!data?.purchases?.length) return dates;
  let dirty = false;
  for (const it of items) {
    const norm = normalizeName(it.name);
    for (const rec of data.purchases) {
      if (rec.refunded) continue;
      if (normalizeName(rec.name) === norm && (!it.orderId || rec.orderId === it.orderId)) {
        rec.refunded = true;
        dates.add(rec.date);
        dirty = true;
      }
    }
  }
  if (dirty) await writeJson(PURCHASES_FILE, data);
  return dates;
}

export async function loadGroceryState(): Promise<GroceryState> {
  await migrateStapleCategories(); // one-time re-file of "Other" staples
  const [grocery, staples, carts, productMap, liveCart] = await Promise.all([
    loadGrocery(), loadStaples(), loadCarts(), loadProductMap(), loadLiveCart(),
  ]);
  let groceryDirty = false;
  let staplesDirty = false;

  // 1. Apply micro-agent category assignments (and remember them so each name
  //    is only ever decided once)
  const categorized = await readJson<Record<string, string>>(CATEGORIZED_FILE);
  if (categorized) {
    const categoryMap = await loadCategoryMap();
    let mapDirty = false;
    for (const item of grocery.items) {
      const cat = categorized[item.id];
      if (cat && !item.categoryConfirmed) {
        item.category = cat;
        item.categoryConfirmed = true;
        groceryDirty = true;
        if ((DEFAULT_CATEGORIES as readonly string[]).includes(cat) && categoryMap[normalizeName(item.name)] !== cat) {
          categoryMap[normalizeName(item.name)] = cat;
          mapDirty = true;
        }
      }
    }
    if (mapDirty) await saveCategoryMap(categoryMap);
    try { await unlink(CATEGORIZED_FILE); } catch {}
  }

  // 2. Apply Gmail purchase-scan results: confirmed buys remove items + restock
  //    staples; unavailable/refunded items get re-added so nothing falls through.
  const scan = await readJson<ScanResults>(SCAN_RESULTS_FILE);
  if (scan && (scan.purchases?.length || scan.unavailable?.length)) {
    const today = new Date().toISOString().slice(0, 10);
    const records: PurchaseRecord[] = [];
    // 2a. Confirmed purchases (apply first, so a same-scan refund nets correctly)
    for (const p of scan.purchases ?? []) {
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
    if (records.length) await appendPurchases(records);

    // 2b. Unavailable / refunded items
    if (scan.unavailable?.length) {
      const categoryMap = await loadCategoryMap();
      const refundDates = await markPurchasesRefunded(
        scan.unavailable.map(u => ({ name: u.name, orderId: u.orderId })),
      );
      for (const u of scan.unavailable) {
        const norm = normalizeName(u.name);
        // Re-add to the list if it isn't already there (unchecked)
        if (!grocery.items.some(i => normalizeName(i.name) === norm && !i.checked)) {
          const [cat, confirmed] = resolveCategory(u.name, categoryMap);
          grocery.items.push({
            id: makeItemId(u.name), name: u.name, category: cat, categoryConfirmed: confirmed,
            staple: staples.some(s => normalizeName(s.name) === norm),
            checked: false, addedAt: new Date().toISOString(), source: 'scan',
            note: 'Walmart: unavailable — reorder',
          });
          groceryDirty = true;
        }
        // Staple back to Out; drop a lastPurchased falsely set by this same order
        const staple = staples.find(s => normalizeName(s.name) === norm);
        if (staple) {
          staple.status = 'out';
          if (staple.lastPurchased && (refundDates.has(staple.lastPurchased) || u.date === staple.lastPurchased)) {
            staple.lastPurchased = undefined;
          }
          staplesDirty = true;
        }
      }
    }

    try { await unlink(SCAN_RESULTS_FILE); } catch {}
  }

  if (groceryDirty) await saveGrocery(grocery);
  if (staplesDirty) await saveStaples(staples);

  return { lastUpdated: grocery.lastUpdated, items: grocery.items, staples, carts, productMap, liveCart };
}

/* ── Cart assembly ─────────────────────────────────────────────────────────
   The build-carts entry point. Resolves what it can instantly from the
   product memory; queues only unknown items for the /build-carts agent via
   cart-request.json. The API route stays a thin seam over this. */

/** "2" → 2; "1 lb" / "2 dozen" → 1 (only bare integers are purchase counts) */
function countQty(quantity?: string): number {
  return quantity && /^\d+$/.test(quantity.trim()) ? Math.max(1, parseInt(quantity, 10)) : 1;
}

/** Purchase count for a build: an explicit defaultQty wins over the parsed
 *  free-form quantity ("I always buy 2 of these"). */
function buildQty(item: GroceryItem): number {
  return item.defaultQty && item.defaultQty > 0 ? Math.floor(item.defaultQty) : countQty(item.quantity);
}

/** Merge a learned product into the map under an item name, NEVER clobbering a
 *  user pin (pinned entries are authoritative). Returns whether it wrote. */
export function learnProduct(
  map: Record<string, ProductRef>,
  name: string,
  ref: { retailer: Retailer; productId: string; product?: string; productUrl?: string },
): boolean {
  const key = normalizeName(name);
  if (map[key]?.pinned) return false;
  map[key] = {
    retailer: ref.retailer, productId: ref.productId,
    product: ref.product, productUrl: ref.productUrl, pinned: false,
  };
  return true;
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
      qty: buildQty(item),
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

/** Reconcile from the REAL retailer cart, observed in the user's own browser
 *  session (bookmarklet/extension) and POSTed here — we never read it
 *  server-side (hard rule: no login). Match observed productIds to cart lines:
 *  present ⇒ addedQty = qty (it landed); absent ⇒ cleared (didn't). Returns the
 *  observed productIds that aren't on this list (info only). */
export async function applyObservedCart(
  retailer: Retailer,
  observed: { productId: string; qty?: number }[],
): Promise<{ ok: boolean; inCart: number; unknown: string[] }> {
  const carts = await loadCarts();
  const cart = carts?.carts.find(c => c.retailer === retailer);
  // No built cart for this retailer → nothing to reconcile. That's not an error
  // (a live-cart sync may run with no build present), so succeed as a no-op
  // rather than 404 — also stops the extension's cart sync flashing ERR.
  if (!carts || !cart) return { ok: true, inCart: 0, unknown: observed.map(o => String(o.productId)).filter(Boolean) };

  const obs = new Set(observed.map(o => String(o.productId)).filter(Boolean));
  const cartProductIds = new Set(cart.items.map(m => m.productId).filter(Boolean) as string[]);
  let inCart = 0;
  for (const m of cart.items) {
    if (!m.productId) continue;
    if (obs.has(m.productId)) { m.addedQty = m.qty ?? 1; inCart++; }
    else delete m.addedQty;
  }
  await saveCarts(carts);
  const unknown = [...obs].filter(pid => !cartProductIds.has(pid));
  return { ok: true, inCart, unknown };
}

/** Adopt a product seen in the live Walmart cart onto the grocery list as
 *  already-in-cart, in one shot: ensure a list item exists, pin the exact
 *  product (so reorders resolve to it), and add/update a Walmart cart line with
 *  addedQty satisfied. Optionally promote it to a staple. Lets the user capture
 *  "I already put this in my Walmart cart" with a single tap. */
export async function adoptWalmartCartLine(input: {
  productId: string;
  product: string;
  productUrl?: string;
  price?: string;
  qty?: number;
  asStaple?: boolean;
  category?: string;
}): Promise<{ ok: boolean; itemId: string; staple?: Staple }> {
  const name = String(input.product ?? '').trim();
  const productId = String(input.productId ?? '').trim();
  if (!name || !productId) return { ok: false, itemId: '' };
  const norm = normalizeName(name);
  const qty = input.qty && input.qty > 0 ? input.qty : 1;

  const [grocery, categoryMap] = await Promise.all([loadGrocery(), loadCategoryMap()]);

  // 1) Find or create the list item (reuse an existing unchecked match).
  let item = grocery.items.find(i => normalizeName(i.name) === norm && !i.checked);
  if (!item) {
    const explicit = input.category && (DEFAULT_CATEGORIES as readonly string[]).includes(input.category) ? input.category : null;
    const [cat, confirmed] = explicit ? [explicit, true] : resolveCategory(name, categoryMap);
    item = {
      id: makeItemId(name), name, category: cat, categoryConfirmed: confirmed,
      checked: false, addedAt: new Date().toISOString(), source: 'manual',
    };
    grocery.items.push(item);
  }
  if (input.asStaple) item.staple = true;
  await saveGrocery(grocery);

  // 2) Pin the exact product so a future build reorders this same item.
  await setPin(name, { retailer: 'walmart', productId, product: name, productUrl: input.productUrl });

  // 3) Upsert a Walmart cart line, marked already-in-cart (addedQty = qty).
  const carts: CartsData = (await loadCarts()) ?? { builtAt: new Date().toISOString(), carts: [] };
  let cart = carts.carts.find(c => c.retailer === 'walmart');
  if (!cart) { cart = { retailer: 'walmart', label: RETAILER_LABELS.walmart, items: [], unmatched: [] }; carts.carts.push(cart); }
  let line = cart.items.find(m => m.itemId === item!.id || m.productId === productId);
  if (!line) {
    line = { itemId: item.id, name, product: name, productId, productUrl: input.productUrl, price: input.price, qty, confidence: 'high', source: 'reorder', status: 'ok' };
    cart.items.push(line);
  } else {
    line.productId = productId; line.product = name;
    if (input.productUrl) line.productUrl = input.productUrl;
    if (input.price) line.price = input.price;
  }
  line.qty = line.qty ?? qty;
  line.addedQty = line.qty; // it's already in the real cart
  cart.cartUrl = rebuildCartUrl(cart);
  carts.builtAt = new Date().toISOString();
  await saveCarts(carts);

  // 4) Optionally make it a staple (stocked — it's en route).
  let staple: Staple | undefined;
  if (input.asStaple) {
    const staples = await loadStaples();
    if (!staples.some(s => normalizeName(s.name) === norm)) {
      const [cat] = resolveCategory(name, categoryMap);
      staple = { id: makeItemId(name), name, category: item.category || cat, status: 'stocked' };
      staples.push(staple);
      await saveStaples(staples);
    }
  }

  return { ok: true, itemId: item.id, staple };
}

/* ── Out-of-stock substitution ─────────────────────────────────────────────
   The user picks one of the agent's ranked alternatives for an out-of-stock
   line. We swap the line's product, mark it back to pending (it's a different
   product now), rebuild the cart link, and remember the choice as a learned
   product so the next build resolves it instantly (never overwriting a pin). */
export async function acceptSubstitute(
  retailer: Retailer,
  itemId: string,
  productId: string,
): Promise<{ ok: boolean }> {
  const carts = await loadCarts();
  const cart = carts?.carts.find(c => c.retailer === retailer);
  if (!carts || !cart) return { ok: false };
  const line = cart.items.find(m => m.itemId === itemId);
  if (!line) return { ok: false };
  const alt = (line.alternatives ?? []).find(a => a.productId === productId);
  if (!alt) return { ok: false };

  line.productId = alt.productId;
  line.product = alt.product;
  line.price = alt.price;
  line.productUrl = alt.productUrl;
  line.status = 'ok';
  line.substituted = true;
  line.source = 'new';
  line.confidence = 'medium';
  delete line.addedQty; // different product → pending again
  delete line.alternatives;
  cart.cartUrl = rebuildCartUrl(cart);
  await saveCarts(carts);

  const map = await loadProductMap();
  if (learnProduct(map, line.name, { retailer, productId: alt.productId, product: alt.product, productUrl: alt.productUrl })) {
    await saveProductMap(map);
  }
  return { ok: true };
}

/** Replace a cart line's product from a pasted product URL (the "wrong product?"
 *  fix) without remove+re-add. Swaps the line, rebuilds the cart link, marks it
 *  pending, and PINS the chosen product so the next build doesn't re-guess. */
export async function changeCartLineProduct(
  retailer: Retailer,
  itemId: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const ref = parseProductUrl(url);
  if (!ref) return { ok: false, error: 'unparseable' };
  if (ref.retailer !== retailer) return { ok: false, error: 'retailer-mismatch' };

  const carts = await loadCarts();
  const cart = carts?.carts.find(c => c.retailer === retailer);
  if (!carts || !cart) return { ok: false, error: 'no-cart' };
  const line = cart.items.find(m => m.itemId === itemId);
  if (!line) return { ok: false, error: 'no-line' };

  line.productId = ref.productId;
  line.productUrl = ref.productUrl;
  line.product = undefined; // title unknown from a bare URL; a later build/observe fills it
  line.price = undefined;
  line.status = 'ok';
  line.substituted = true;
  line.source = 'new';
  line.confidence = 'medium';
  delete line.addedQty;
  delete line.alternatives;
  cart.cartUrl = rebuildCartUrl(cart);
  await saveCarts(carts);

  // The user explicitly picked this product → pin it (authoritative).
  await setPin(line.name, { retailer: ref.retailer, productId: ref.productId, productUrl: ref.productUrl });
  return { ok: true };
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

  // Learn the exact product just bought (from the built cart line) so the next
  // reorder locks onto it instead of re-guessing — never overwriting a pin.
  const carts = await loadCarts();
  if (carts) {
    const lineByItem = new Map<string, { retailer: Retailer; productId: string; product?: string; productUrl?: string }>();
    for (const c of carts.carts)
      for (const m of c.items)
        if (m.productId) lineByItem.set(m.itemId, { retailer: c.retailer, productId: m.productId, product: m.product, productUrl: m.productUrl });
    let map: Record<string, ProductRef> | null = null;
    let mapDirty = false;
    for (const item of removed) {
      const line = lineByItem.get(item.id);
      if (!line) continue;
      if (!map) map = await loadProductMap();
      if (learnProduct(map, item.name, line)) mapDirty = true;
    }
    if (mapDirty && map) await saveProductMap(map);
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
      defaultQty: staple.defaultQty,
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
