import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { changeCartLineProduct } from '@/features/grocery/ops';
import type { Retailer } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/carts/change — { retailer, itemId, url }: replace a cart
 *  line's product from a pasted product URL (the "wrong product?" fix) and pin
 *  the chosen product. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let retailer: Retailer, itemId: string, url: string;
  try {
    ({ retailer, itemId, url } = await request.json() as { retailer: Retailer; itemId: string; url: string });
    if (!retailer || !itemId || !url) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { ok, error } = await changeCartLineProduct(retailer, itemId, url);
  if (!ok) {
    if (error === 'unparseable' || error === 'retailer-mismatch') {
      return json({ error: `Paste a ${retailer === 'amazon' ? 'amazon.com/dp/…' : 'walmart.com/ip/…'} product link.` }, 422);
    }
    return new Response('Not found', { status: 404 });
  }
  return json({ ok: true });
};
