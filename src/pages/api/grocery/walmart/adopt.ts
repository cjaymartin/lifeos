import type { APIRoute } from 'astro';
import { requireSessionOrToken } from '@/lib/auth';
import { adoptWalmartCartLine } from '@/features/grocery/ops';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/walmart/adopt — capture a product seen in the live Walmart
 *  cart onto the grocery list as already-in-cart (and optionally as a staple).
 *  Body: { productId, product, productUrl?, price?, qty?, asStaple?, category? }. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSessionOrToken(cookies, request);
  if (denied) return denied;

  let body: {
    productId?: unknown; product?: unknown; productUrl?: unknown;
    price?: unknown; qty?: unknown; asStaple?: unknown; category?: unknown;
  };
  try {
    body = await request.json();
    if (!body.productId) throw new Error('productId required');
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const res = await adoptWalmartCartLine({
    productId: String(body.productId),
    product: String(body.product ?? '').trim() || `Item ${String(body.productId)}`,
    productUrl: body.productUrl != null ? String(body.productUrl) : undefined,
    price: body.price != null ? String(body.price) : undefined,
    qty: body.qty != null ? Number(body.qty) : undefined,
    asStaple: !!body.asStaple,
    category: body.category != null ? String(body.category) : undefined,
  });

  return json(res, res.ok ? 200 : 400);
};
