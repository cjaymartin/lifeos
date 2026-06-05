import type { APIRoute } from 'astro';
import { writeFile, unlink } from 'fs/promises';
import { verifySession } from '@/lib/auth';
import {
  CART_REQUEST_FILE, loadGrocery, loadCarts, saveCarts, loadProductMap, rebuildCartUrl,
} from '@/lib/grocery';
import { normalizeName, RETAILER_LABELS } from '@/lib/grocery-types';
import type { CartMatch, CartsData, GroceryItem } from '@/lib/grocery-types';
import { spawnGroceryJob } from '@/lib/grocery-runner';

/** "2" → 2; "1 lb" / "2 dozen" → 1 (only bare integers are purchase counts) */
function countQty(quantity?: string): number {
  return quantity && /^\d+$/.test(quantity.trim()) ? Math.max(1, parseInt(quantity, 10)) : 1;
}

/**
 * POST /api/grocery/build-carts — optional { itemIds: string[] } limits the
 * build to a selection.
 *
 * - Items already fully pushed to a retailer cart (addedQty >= qty) are
 *   always excluded — building never re-adds what's in the cart.
 * - Items with a product-map entry (pinned or learned) are resolved INSTANTLY
 *   here, no agent involved — the map caches productIds exactly for this.
 * - Only unknown items are handed to the /build-carts agent.
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  let itemIds: string[] | undefined;
  try {
    const body = await request.json() as { itemIds?: string[] };
    if (Array.isArray(body.itemIds) && body.itemIds.length > 0) itemIds = body.itemIds.map(String);
  } catch {} // empty body → full build

  const [grocery, prevCarts, productMap] = await Promise.all([
    loadGrocery(), loadCarts(), loadProductMap(),
  ]);

  // Never rebuild lines that are already in the real retailer cart
  const inCart = new Set<string>();
  for (const c of prevCarts?.carts ?? [])
    for (const m of c.items)
      if (m.productId && (m.addedQty ?? 0) >= (m.qty ?? 1)) inCart.add(m.itemId);

  let targets = grocery.items.filter(i => !i.checked && !inCart.has(i.id));
  if (itemIds) {
    const sel = new Set(itemIds);
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

  let status = 'done';
  if (agentItems.length > 0) {
    // Stale selections must never leak into a later run — always rewritten
    await writeFile(CART_REQUEST_FILE, JSON.stringify({ itemIds: agentItems.map(i => i.id) }, null, 2) + '\n');
    status = await spawnGroceryJob('build-carts');
  } else {
    try { await unlink(CART_REQUEST_FILE); } catch {}
  }

  return new Response(JSON.stringify({ status, instant, queued: agentItems.length }), {
    status: 202, headers: { 'Content-Type': 'application/json' },
  });
};
