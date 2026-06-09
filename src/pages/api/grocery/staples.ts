import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import {
  loadGrocery, saveGrocery, loadStaples, saveStaples, makeItemId, syncStapleToList, renameInProductMap,
} from '@/features/grocery/ops';
import { normalizeName, DEFAULT_CATEGORIES, STAPLE_STATUS_ORDER } from '@/features/grocery/types';
import type { RestockAt, Retailer, StapleStatus } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/staples — add a staple directly: { name, category? } */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let name: string, category: string | undefined;
  try {
    const body = await request.json() as { name: string; category?: string };
    name = String(body.name ?? '').trim();
    if (!name) throw new Error();
    category = body.category;
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const staples = await loadStaples();
  if (staples.some(s => normalizeName(s.name) === normalizeName(name)))
    return json({ ok: true, duplicate: true });

  const cat = category && (DEFAULT_CATEGORIES as readonly string[]).includes(category) ? category : 'Other';
  const staple = { id: makeItemId(name), name, category: cat, status: 'stocked' as StapleStatus };
  staples.push(staple);
  await saveStaples(staples);

  // Mark any matching list item as a staple
  const grocery = await loadGrocery();
  const item = grocery.items.find(i => normalizeName(i.name) === normalizeName(name));
  if (item && !item.staple) {
    item.staple = true;
    await saveGrocery(grocery);
  }

  return json({ staple }, 201);
};

/** PATCH /api/grocery/staples — { id, status?, category?, name?, buyFrom?, restockAt? }
 *  status/restockAt re-sync the list per the restock policy; category/name/
 *  buyFrom also propagate to any matching unchecked list item (and renames
 *  carry the product-map pin along). */
export const PATCH: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let body: { id: string; status?: StapleStatus; category?: string; name?: string; buyFrom?: Retailer | null; restockAt?: RestockAt; defaultQty?: number | null };
  try {
    body = await request.json();
    if (!body.id) throw new Error();
    if (body.status !== undefined && !STAPLE_STATUS_ORDER.includes(body.status)) throw new Error();
    if (body.category !== undefined && !(DEFAULT_CATEGORIES as readonly string[]).includes(body.category)) throw new Error();
    if (body.name !== undefined && !String(body.name).trim()) throw new Error();
    if (body.buyFrom !== undefined && body.buyFrom !== null && !['walmart', 'amazon'].includes(body.buyFrom)) throw new Error();
    if (body.restockAt !== undefined && !['low', 'out', 'never'].includes(body.restockAt)) throw new Error();
    if (body.defaultQty !== undefined && body.defaultQty !== null && !(typeof body.defaultQty === 'number' && body.defaultQty >= 1)) throw new Error();
    if ([body.status, body.category, body.name, body.buyFrom, body.restockAt, body.defaultQty].every(v => v === undefined)) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const staples = await loadStaples();
  const staple = staples.find(s => s.id === body.id);
  if (!staple) return new Response('Not found', { status: 404 });

  const oldName = staple.name;
  if (body.status) staple.status = body.status;
  if (body.category) staple.category = body.category;
  if (body.restockAt) staple.restockAt = body.restockAt;
  if (body.buyFrom !== undefined) staple.buyFrom = body.buyFrom ?? undefined;
  if (body.defaultQty !== undefined) staple.defaultQty = body.defaultQty === null ? undefined : Math.floor(body.defaultQty);
  if (body.name && body.name.trim() !== oldName) {
    await renameInProductMap(oldName, body.name.trim());
    staple.name = body.name.trim();
  }
  await saveStaples(staples);

  const grocery = await loadGrocery();
  let groceryDirty = false;
  // Propagate to matching unchecked list items (match by the OLD name)
  const oldNorm = normalizeName(oldName);
  for (const item of grocery.items) {
    if (item.checked || normalizeName(item.name) !== oldNorm) continue;
    if (body.name && item.name !== staple.name) { item.name = staple.name; groceryDirty = true; }
    if (body.category && item.category !== body.category) {
      item.category = body.category;
      item.categoryConfirmed = true;
      groceryDirty = true;
    }
    if (body.buyFrom !== undefined && item.buyFrom !== staple.buyFrom) { item.buyFrom = staple.buyFrom; groceryDirty = true; }
    if (body.defaultQty !== undefined && item.defaultQty !== staple.defaultQty) { item.defaultQty = staple.defaultQty; groceryDirty = true; }
  }
  // Status or policy changes can add/remove the auto-added list item
  if (body.status || body.restockAt) {
    groceryDirty = (await syncStapleToList(staple, grocery)) || groceryDirty;
  }
  if (groceryDirty) await saveGrocery(grocery);

  return json({ staple });
};

/** DELETE /api/grocery/staples — { id } */
export const DELETE: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let id: string;
  try { ({ id } = await request.json() as { id: string }); if (!id) throw new Error(); } catch {
    return new Response('Bad request', { status: 400 });
  }

  const staples = await loadStaples();
  const staple = staples.find(s => s.id === id);
  if (!staple) return new Response('Not found', { status: 404 });
  await saveStaples(staples.filter(s => s.id !== id));

  // Unstar any matching list item
  const grocery = await loadGrocery();
  const item = grocery.items.find(i => normalizeName(i.name) === normalizeName(staple.name));
  if (item?.staple) {
    item.staple = false;
    await saveGrocery(grocery);
  }

  return json({ ok: true });
};
