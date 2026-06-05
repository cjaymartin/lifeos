import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import {
  loadGrocery, saveGrocery, loadStaples, loadGroceryState,
  categorizeHeuristic, makeItemId,
} from '@/lib/grocery';
import type { GroceryItem } from '@/lib/grocery-types';
import { normalizeName, DEFAULT_CATEGORIES } from '@/lib/grocery-types';
import { spawnGroceryJob } from '@/lib/grocery-runner';

function unauthorized(cookies: import('astro').AstroCookies): Response | null {
  return verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? '')
    ? null
    : new Response('Unauthorized', { status: 401 });
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** GET /api/grocery — full state (applies any pending micro-agent output) */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = unauthorized(cookies);
  if (denied) return denied;
  return json(await loadGroceryState());
};

/** Parse "2 milk" / "2x paper towels" / "1 lb ground beef" into qty + name */
function parseQuickAdd(raw: string): { name: string; quantity?: string } {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?\s*(?:x|lbs?|oz|kg|g|dozen|pack|cans?|bottles?|boxes?|bags?)?)\s+(.+)$/i);
  if (m && m[2].length > 1) {
    const qty = m[1].replace(/x$/i, '').trim();
    return { name: m[2].trim(), quantity: qty === '1' ? undefined : qty };
  }
  return { name: raw.trim() };
}

/** POST /api/grocery — add one or more items: { names: string[] } or { name } */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = unauthorized(cookies);
  if (denied) return denied;

  let names: string[];
  let source: GroceryItem['source'] = 'manual';
  let category: string | undefined;
  try {
    const body = await request.json() as { name?: string; names?: string[]; source?: GroceryItem['source']; category?: string };
    names = (body.names ?? (body.name ? [body.name] : [])).map(n => String(n).trim()).filter(Boolean);
    if (names.length === 0) throw new Error();
    if (body.source) source = body.source;
    if (body.category && (DEFAULT_CATEGORIES as readonly string[]).includes(body.category)) category = body.category;
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const [grocery, staples] = await Promise.all([loadGrocery(), loadStaples()]);
  const added: GroceryItem[] = [];

  for (const raw of names) {
    const { name, quantity } = parseQuickAdd(raw);
    const norm = normalizeName(name);
    // Don't add exact duplicates of an unchecked item
    if (grocery.items.some(i => normalizeName(i.name) === norm && !i.checked)) continue;

    const [heurCat, confirmed] = category ? [category, true] : categorizeHeuristic(name);
    const staple = staples.find(s => normalizeName(s.name) === norm);
    added.push({
      id: makeItemId(name),
      name,
      quantity,
      category: staple?.category ?? heurCat,
      categoryConfirmed: staple ? true : confirmed,
      staple: !!staple,
      checked: false,
      addedAt: new Date().toISOString(),
      source,
    });
  }

  let categorizing = false;
  if (added.length > 0) {
    grocery.items.push(...added);
    await saveGrocery(grocery);
    // Anything the keyword map couldn't place → wake the categorize micro-agent
    if (added.some(i => !i.categoryConfirmed)) {
      categorizing = (await spawnGroceryJob('categorize')) === 'started' || true;
    }
  }

  return json({ added, categorizing }, 201);
};
