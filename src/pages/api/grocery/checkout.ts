import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { checkoutItems, loadCarts, saveCarts } from '@/features/grocery/ops';
import type { Retailer } from '@/features/grocery/types';

/**
 * POST /api/grocery/checkout
 * - { retailer: 'walmart' | 'amazon' } — "I checked out this cart": removes the
 *   cart's matched items from the list, restocks staples, logs purchases, and
 *   drops that cart from carts.json.
 * - { itemIds: string[] } — in-store "Clear checked": same, source 'in-store'.
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let retailer: Retailer | undefined;
  let itemIds: string[] | undefined;
  try {
    const body = await request.json() as { retailer?: Retailer; itemIds?: string[] };
    retailer = body.retailer;
    itemIds = body.itemIds;
    if (!retailer && !Array.isArray(itemIds)) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  let removed = 0;
  if (retailer) {
    const carts = await loadCarts();
    const cart = carts?.carts.find(c => c.retailer === retailer);
    if (!cart) return new Response('No cart for that retailer', { status: 404 });
    ({ removed } = await checkoutItems(cart.items.map(m => m.itemId), retailer));
    // Drop the checked-out cart; remove the file once both are done
    const remaining = carts!.carts.filter(c => c.retailer !== retailer);
    await saveCarts(remaining.length ? { ...carts!, carts: remaining } : null);
  } else {
    ({ removed } = await checkoutItems(itemIds!, 'in-store'));
  }

  return new Response(JSON.stringify({ ok: true, removed }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
