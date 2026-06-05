import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import {
  loadGrocery, saveGrocery, loadStaples, saveStaples, makeItemId, renameInProductMap,
} from '@/lib/grocery';
import { normalizeName, DEFAULT_CATEGORIES } from '@/lib/grocery-types';
import type { Retailer } from '@/lib/grocery-types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** PATCH /api/grocery/items/:id — { checked?, name?, quantity?, note?, category?, staple?, buyFrom? }
 *  Renames carry the product-map pin and any matching staple along; buyFrom
 *  syncs to the staple too so the preference survives checkouts. */
export const PATCH: APIRoute = async ({ cookies, request, params }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  let body: {
    checked?: boolean; name?: string; quantity?: string; note?: string;
    category?: string; staple?: boolean; buyFrom?: Retailer | null;
  };
  try { body = await request.json(); } catch {
    return new Response('Bad request', { status: 400 });
  }

  const grocery = await loadGrocery();
  const item = grocery.items.find(i => i.id === params.id);
  if (!item) return new Response('Not found', { status: 404 });

  if (typeof body.checked === 'boolean') item.checked = body.checked;
  if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== item.name) {
    const newName = body.name.trim();
    await renameInProductMap(item.name, newName);
    const staples = await loadStaples();
    const staple = staples.find(s => normalizeName(s.name) === normalizeName(item.name));
    if (staple) {
      staple.name = newName;
      await saveStaples(staples);
    }
    item.name = newName;
  }
  if (body.buyFrom !== undefined) {
    if (body.buyFrom !== null && !['walmart', 'amazon'].includes(body.buyFrom))
      return new Response('Bad request', { status: 400 });
    item.buyFrom = body.buyFrom ?? undefined;
    const staples = await loadStaples();
    const staple = staples.find(s => normalizeName(s.name) === normalizeName(item.name));
    if (staple && staple.buyFrom !== item.buyFrom) {
      staple.buyFrom = item.buyFrom;
      await saveStaples(staples);
    }
  }
  if (typeof body.quantity === 'string') item.quantity = body.quantity.trim() || undefined;
  if (typeof body.note === 'string') item.note = body.note.trim() || undefined;
  if (typeof body.category === 'string' && (DEFAULT_CATEGORIES as readonly string[]).includes(body.category)) {
    item.category = body.category;
    item.categoryConfirmed = true; // user said so
  }

  // Toggling the star keeps staples.json in sync
  if (typeof body.staple === 'boolean' && body.staple !== !!item.staple) {
    item.staple = body.staple;
    const staples = await loadStaples();
    const norm = normalizeName(item.name);
    if (body.staple && !staples.some(s => normalizeName(s.name) === norm)) {
      staples.push({ id: makeItemId(item.name), name: item.name, category: item.category, status: 'out' });
      await saveStaples(staples);
    } else if (!body.staple) {
      await saveStaples(staples.filter(s => normalizeName(s.name) !== norm));
    }
  }

  await saveGrocery(grocery);
  return json({ item });
};

/** DELETE /api/grocery/items/:id */
export const DELETE: APIRoute = async ({ cookies, params }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  const grocery = await loadGrocery();
  const before = grocery.items.length;
  grocery.items = grocery.items.filter(i => i.id !== params.id);
  if (grocery.items.length === before) return new Response('Not found', { status: 404 });

  await saveGrocery(grocery);
  return json({ ok: true });
};
