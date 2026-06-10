import type { APIRoute } from 'astro';
import { requireSessionOrToken } from '@/lib/auth';
import { applyOrderHistory } from '@/features/grocery/ops';
import type { Retailer } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/order-history — ingest past-purchased products captured
 *  from Walmart order history by the browser extension (in the user's own
 *  session). Body: { retailer, products: [{ productId, product, productUrl?, lastOrdered? }] }.
 *  Auth: session cookie OR `Authorization: Bearer <session token>` (the
 *  extension can't send the httpOnly/SameSite-lax cookie cross-site). */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSessionOrToken(cookies, request);
  if (denied) return denied;

  let retailer: Retailer;
  let products: { productId: string; product: string; productUrl?: string; lastOrdered?: string }[];
  try {
    const body = await request.json() as { retailer?: Retailer; products?: any[] };
    retailer = body.retailer ?? 'walmart';
    if (!['walmart', 'amazon'].includes(retailer)) throw new Error();
    products = Array.isArray(body.products)
      ? body.products.filter(p => p && typeof p.productId === 'string' && typeof p.product === 'string')
      : [];
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const result = await applyOrderHistory(retailer, products);
  return json({ ok: true, ...result });
};
