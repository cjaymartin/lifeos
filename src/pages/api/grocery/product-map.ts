import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { loadProductMap, saveProductMap, parseProductUrl, setPin } from '@/features/grocery/ops';
import { normalizeName } from '@/features/grocery/types';
import type { Retailer } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/product-map — pin an exact retailer product to an
 *  item/staple name. Two forms (build-carts treats pinned entries as
 *  authoritative):
 *   - { name, url }: paste a walmart.com/ip/… or amazon.com/dp/… link
 *   - { name, retailer, productId, product?, productUrl? }: one-click "Always
 *     use this" from a built cart line. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let name: string;
  let body: { name?: string; url?: string; retailer?: Retailer; productId?: string; product?: string; productUrl?: string };
  try {
    body = await request.json();
    name = String(body.name ?? '').trim();
    if (!name) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  // Form A: pin by exact productId (from a cart line)
  if (body.retailer && body.productId) {
    if (!['walmart', 'amazon'].includes(body.retailer)) return new Response('Bad request', { status: 400 });
    const pin = await setPin(name, {
      retailer: body.retailer, productId: String(body.productId),
      product: body.product, productUrl: body.productUrl,
    });
    return json({ name: normalizeName(name), ref: pin }, 201);
  }

  // Form B: pin by pasted URL
  const url = String(body.url ?? '').trim();
  if (!url) return new Response('Bad request', { status: 400 });
  const ref = parseProductUrl(url);
  if (!ref) {
    return json({ error: 'Could not parse that link — paste a walmart.com/ip/… or amazon.com/dp/… product URL.' }, 422);
  }

  const map = await loadProductMap();
  map[normalizeName(name)] = { ...ref, pinned: true };
  await saveProductMap(map);

  return json({ name: normalizeName(name), ref: map[normalizeName(name)] }, 201);
};

/** DELETE /api/grocery/product-map — { name }: remove a pinned/learned product */
export const DELETE: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let name: string;
  try {
    ({ name } = await request.json() as { name: string });
    if (!name) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const map = await loadProductMap();
  delete map[normalizeName(name)];
  await saveProductMap(map);

  return json({ ok: true });
};
