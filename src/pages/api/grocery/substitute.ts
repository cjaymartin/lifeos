import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { acceptSubstitute } from '@/features/grocery/ops';
import type { Retailer } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/substitute — { retailer, itemId, productId }: swap an
 *  out-of-stock cart line to one of the agent's ranked alternatives and learn
 *  the choice for next time. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let retailer: Retailer, itemId: string, productId: string;
  try {
    ({ retailer, itemId, productId } = await request.json() as { retailer: Retailer; itemId: string; productId: string });
    if (!retailer || !itemId || !productId) throw new Error();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { ok } = await acceptSubstitute(retailer, itemId, productId);
  if (!ok) return new Response('Not found', { status: 404 });
  return json({ ok: true });
};
