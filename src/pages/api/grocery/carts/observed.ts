import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { applyObservedCart } from '@/features/grocery/ops';
import type { Retailer } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/carts/observed — ingest the REAL retailer cart contents
 *  observed in the user's own logged-in browser session (the bookmarklet /
 *  extension reads the cart DOM and posts here). Body:
 *    { retailer, items: [{ productId, product?, qty?, price? }] }
 *  Reconciles per line: productId present in the observed cart ⇒ marked in-cart;
 *  absent ⇒ reset to pending. Session-guarded; LifeOS never sees the user's
 *  retailer credentials — only the resulting line items cross localhost. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let retailer: Retailer;
  let items: { productId: string; qty?: number }[];
  try {
    const body = await request.json() as { retailer: Retailer; items?: { productId: string; qty?: number }[] };
    retailer = body.retailer;
    items = Array.isArray(body.items) ? body.items.filter(i => i && typeof i.productId === 'string') : [];
    if (!retailer || !['walmart', 'amazon'].includes(retailer)) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { ok, inCart, unknown } = await applyObservedCart(retailer, items);
  if (!ok) return new Response('Not found', { status: 404 });
  return json({ ok: true, inCart, unknown });
};
