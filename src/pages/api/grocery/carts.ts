import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { loadCarts, saveCarts, rebuildCartUrl } from '@/features/grocery/ops';
import type { Retailer } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/carts — { retailer, action? }:
 *  - action 'mark-added' (default): record that the user pushed the pending
 *    items to the retailer cart (sets addedQty = qty per line, so the
 *    "Add to cart" button becomes "View cart" and never double-adds).
 *  - action 'reset-added': forget the added state (the add didn't actually
 *    go through — bot check, login wall, emptied cart) so the button offers
 *    the full add again. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let retailer: Retailer, action: string;
  try {
    const body = await request.json() as { retailer: Retailer; action?: string };
    retailer = body.retailer;
    action = body.action ?? 'mark-added';
    if (!retailer || !['mark-added', 'reset-added'].includes(action)) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const carts = await loadCarts();
  const cart = carts?.carts.find(c => c.retailer === retailer);
  if (!carts || !cart) return new Response('Not found', { status: 404 });

  for (const m of cart.items) {
    if (action === 'mark-added') { if (m.productId) m.addedQty = m.qty ?? 1; }
    else delete m.addedQty;
  }
  await saveCarts(carts);

  return json({ ok: true });
};

/** PATCH /api/grocery/carts — { retailer, itemId }: remove one matched item
 *  from a built cart and rebuild its add-to-cart link. */
export const PATCH: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let retailer: Retailer, itemId: string;
  try {
    ({ retailer, itemId } = await request.json() as { retailer: Retailer; itemId: string });
    if (!retailer || !itemId) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const carts = await loadCarts();
  const cart = carts?.carts.find(c => c.retailer === retailer);
  if (!carts || !cart) return new Response('Not found', { status: 404 });

  cart.items = cart.items.filter(m => m.itemId !== itemId);
  cart.cartUrl = rebuildCartUrl(cart);

  // Empty cart → drop it; no carts left → remove the file
  const remaining = carts.carts.filter(c => c.items.length > 0 || c.unmatched.length > 0);
  await saveCarts(remaining.length ? { ...carts, carts: remaining } : null);

  return json({ ok: true });
};

/** DELETE /api/grocery/carts — { retailer? }: dismiss one built cart, or all
 *  built carts when retailer is omitted. Does NOT touch the grocery list. */
export const DELETE: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let retailer: Retailer | undefined;
  try { ({ retailer } = await request.json() as { retailer?: Retailer }); } catch {}

  const carts = await loadCarts();
  if (!carts) return json({ ok: true });

  if (!retailer) {
    await saveCarts(null);
  } else {
    const remaining = carts.carts.filter(c => c.retailer !== retailer);
    await saveCarts(remaining.length ? { ...carts, carts: remaining } : null);
  }

  return json({ ok: true });
};
