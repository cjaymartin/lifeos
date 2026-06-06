import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { loadProductMap, saveProductMap, parseProductUrl } from '@/lib/grocery';
import { normalizeName } from '@/lib/grocery-types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/product-map — { name, url }: pin an exact retailer
 *  product to an item/staple name. build-carts treats pinned entries as
 *  authoritative. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let name: string, url: string;
  try {
    const body = await request.json() as { name: string; url: string };
    name = String(body.name ?? '').trim();
    url = String(body.url ?? '').trim();
    if (!name || !url) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

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
